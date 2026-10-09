import { beforeAll, describe, expect, it } from "vitest";
import { createApnsTokenProvider } from "../apns-provider-token.ts";

let pem: string;
let otherPem: string;
let publicKey: CryptoKey;
beforeAll(async () => {
  const makeKey = async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    return { pem: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...raw))}\n-----END PRIVATE KEY-----`, publicKey: pair.publicKey };
  };
  const first = await makeKey();
  pem = first.pem;
  publicKey = first.publicKey;
  otherPem = (await makeKey()).pem;
});

function store() {
  let time = 1_800_000_000_000;
  const rows = new Map<string, { token?: string; issuedAt?: number; owner?: string }>();
  let reads = 0, writes = 0;
  let unavailable = false, rejectPublish = false, busy = false;
  const admin = { rpc: async (name: string, args: Record<string, unknown>) => {
    if (unavailable) return { data: null, error: { message: "SECRET MUST NOT REACH LOGS" } };
    const key = String(args._cache_key);
    const row = rows.get(key) ?? {};
    rows.set(key, row);
    if (name === "pp_apns_claim_token") {
      reads++;
      if (row.token && row.issuedAt !== undefined && row.issuedAt > time / 1000 - 2400) return { data: { token: row.token, issued_at: row.issuedAt }, error: null };
      if (row.owner || busy) return { data: { waiting: true }, error: null };
      row.owner = String(args._owner);
      return { data: { claimed: true, issued_at: Math.floor(time / 1000) }, error: null };
    }
    writes++;
    if (rejectPublish || row.owner !== args._owner) return { data: false, error: null };
    row.token = String(args._token); row.issuedAt = Number(args._issued_at); row.owner = undefined;
    return { data: true, error: null };
  } };
  const provider = () => createApnsTokenProvider({ now: () => time, sleep: () => new Promise((r) => setTimeout(r, 0)) });
  return { admin, provider, rows, stats: () => ({ reads, writes }), advance: (ms: number) => { time += ms; }, fail: () => { unavailable = true; }, reject: () => { rejectPublish = true; }, busy: () => { busy = true; } };
}

describe("server-only APNs provider token reuse", () => {
  it("signs a valid ES256 token and reuses it sequentially and concurrently", async () => {
    const db = store(), get = db.provider();
    const tokens = await Promise.all(Array.from({ length: 20 }, () => get(db.admin, "TEAM", "KEY", pem)));
    expect(new Set(tokens).size).toBe(1);
    db.advance(39 * 60_000);
    expect(await get(db.admin, "TEAM", "KEY", pem)).toBe(tokens[0]);
    expect(db.stats()).toEqual({ reads: 1, writes: 1 });
    const [header, claims, signature] = tokens[0].split(".");
    const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(decode(claims)))).toEqual({ iss: "TEAM", iat: 1_800_000_000 });
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, decode(signature), new TextEncoder().encode(`${header}.${claims}`))).toBe(true);
  });
  it("shares one token between independent concurrent workers and cold starts", async () => {
    const db = store();
    const tokens = await Promise.all(Array.from({ length: 8 }, () => db.provider()(db.admin, "TEAM", "KEY", pem)));
    expect(new Set(tokens).size).toBe(1);
    expect(db.stats().writes).toBe(1);
    expect(await db.provider()(db.admin, "TEAM", "KEY", pem)).toBe(tokens[0]);
    expect(db.stats().writes).toBe(1);
  });
  it("renews at 40 minutes, not for every push", async () => {
    const db = store(), get = db.provider();
    const first = await get(db.admin, "TEAM", "KEY", pem);
    db.advance(40 * 60_000);
    expect(await get(db.admin, "TEAM", "KEY", pem)).not.toBe(first);
    expect(db.stats().writes).toBe(2);
  });
  it("normalizes quoted escaped PEMs but separates team, key ID and private key rotation", async () => {
    const db = store(), get = db.provider();
    const first = await get(db.admin, "TEAM", "KEY", pem);
    expect(await get(db.admin, "TEAM", "KEY", JSON.stringify(pem))).toBe(first);
    expect(await get(db.admin, "TEAM", "OTHER", pem)).not.toBe(first);
    expect(await get(db.admin, "OTHER", "KEY", pem)).not.toBe(first);
    expect(await get(db.admin, "TEAM", "KEY", otherPem)).not.toBe(first);
    expect(db.stats().writes).toBe(4);
  });
  it("keeps a valid hot token during outages, fails closed on cold/expired cache, and masks errors", async () => {
    const db = store(), get = db.provider();
    const first = await get(db.admin, "TEAM", "KEY", pem);
    db.fail();
    expect(await get(db.admin, "TEAM", "KEY", pem)).toBe(first);
    await expect(db.provider()(db.admin, "TEAM", "KEY", pem)).rejects.toThrow("APNs cache unavailable");
    db.advance(60 * 60_000);
    await expect(get(db.admin, "TEAM", "KEY", pem)).rejects.toThrow("APNs cache unavailable");
    expect(db.stats().writes).toBe(1);
  });
  it("never returns an unpublished token after a lost lease", async () => {
    const db = store(); db.reject();
    await expect(db.provider()(db.admin, "TEAM", "KEY", pem)).rejects.toThrow("APNs cache renewal lost");
  });
  it("bounds waiting without fallback signing", async () => {
    const db = store(); db.busy();
    await expect(db.provider()(db.admin, "TEAM", "KEY", pem)).rejects.toThrow("APNs cache renewal busy");
    expect(db.stats()).toEqual({ reads: 12, writes: 0 });
  });
});