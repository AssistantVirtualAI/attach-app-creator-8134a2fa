// APNs credentials stay server-only. One persisted token is reused by all
// alert/background/VoIP workers, independent of topic and Apple environment.
const REUSE_SECONDS = 40 * 60;
type Entry = { token: string; issuedAt: number };
type Admin = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: unknown }> };

function b64url(input: ArrayBuffer | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function keyBytes(privateKeyPem: string) {
  let normalized = String(privateKeyPem ?? "").trim();
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    try { normalized = JSON.parse(normalized); } catch { /* validate below */ }
  }
  normalized = normalized.replace(/\\r\\n|\\n|\\r/g, "\n");
  const pem = normalized.replace(/-----BEGIN (?:EC )?PRIVATE KEY-----/g, "")
    .replace(/-----END (?:EC )?PRIVATE KEY-----/g, "").replace(/\s/g, "");
  if (!pem || !/^[A-Za-z0-9+/]+={0,2}$/.test(pem)) throw new Error("APNS_PRIVATE_KEY is not a valid PKCS#8 .p8 key");
  return Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
}

async function sign(teamId: string, keyId: string, raw: Uint8Array<ArrayBuffer>, issuedAt: number) {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: issuedAt }));
  const key = await crypto.subtle.importKey("pkcs8", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(signature)}`;
}

/** Factory also permits independent-worker regression tests without secrets. */
export function createApnsTokenProvider(options: {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
} = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const cache = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<string>>();
  const valid = (entry: Entry) => entry.issuedAt <= Math.floor(now() / 1000)
    && entry.issuedAt > Math.floor(now() / 1000) - REUSE_SECONDS;

  // Mask RPC errors: never let request arguments/bearer tokens enter push logs.
  async function rpc(admin: Admin, name: string, args: Record<string, unknown>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        Promise.resolve(admin.rpc(name, args)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("APNs cache unavailable")), 2000); }),
      ]);
      if (response.error) throw new Error("APNs cache unavailable");
      return response.data;
    } catch { throw new Error("APNs cache unavailable"); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }

  return async (admin: Admin, teamId: string, keyId: string, privateKeyPem: string): Promise<string> => {
    const raw = keyBytes(privateKeyPem);
    const fingerprint = b64url(await crypto.subtle.digest("SHA-256", raw));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([teamId, keyId, fingerprint])));
    const cacheKey = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    const local = cache.get(cacheKey);
    if (local && valid(local)) return local.token;
    const pending = inFlight.get(cacheKey);
    if (pending) return pending;
    // Bound memory under credential rotation; do not retain expired tokens.
    for (const [key, entry] of cache) if (!valid(entry)) cache.delete(key);
    const work = (async () => {
      const owner = crypto.randomUUID();
      for (let attempt = 0; attempt < 12; attempt++) {
        const data = await rpc(admin, "pp_apns_claim_token", { _cache_key: cacheKey, _owner: owner });
        if (typeof data?.token === "string" && Number.isSafeInteger(data.issued_at)) {
          const entry = { token: data.token, issuedAt: data.issued_at };
          if (!valid(entry)) throw new Error("APNs cache token expired");
          if (cache.size >= 8) cache.clear();
          cache.set(cacheKey, entry);
          return entry.token;
        }
        if (data?.claimed === true && Number.isSafeInteger(data.issued_at)) {
          // Only the atomic lease owner signs; no per-worker fallback signing.
          const token = await sign(teamId, keyId, raw, data.issued_at);
          const published = await rpc(admin, "pp_apns_publish_token", {
            _cache_key: cacheKey, _owner: owner, _token: token, _issued_at: data.issued_at,
          });
          if (published !== true) throw new Error("APNs cache renewal lost");
          const entry = { token, issuedAt: data.issued_at };
          if (!valid(entry)) throw new Error("APNs cache token expired");
          if (cache.size >= 8) cache.clear();
          cache.set(cacheKey, entry);
          return token;
        }
        if (data?.waiting !== true) throw new Error("APNs cache unavailable");
        await sleep(100);
      }
      throw new Error("APNs cache renewal busy");
    })();
    inFlight.set(cacheKey, work);
    try { return await work; } finally { inFlight.delete(cacheKey); }
  };
}

export const getApnsProviderToken = createApnsTokenProvider();