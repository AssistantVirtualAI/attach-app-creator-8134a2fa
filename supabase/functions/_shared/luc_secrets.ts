// Lemtel UC secret helpers — pure (no Deno/npm imports) so they are unit-testable.
// Fail closed: a missing, blank or weak secret is never used.

export class LucConfigError extends Error {
  constructor(public readonly setting: string) { super(`luc_config_missing:${setting}`); }
}

const WEAK = /^(changeme|default|secret|password|test|placeholder|x+|0+)$/i;

/** Returns the trimmed secret or throws LucConfigError (message never contains the value). */
export function requireSecret(name: string, value: string | undefined | null, minLength = 32): string {
  const v = (value ?? "").trim();
  if (v.length < minLength || WEAK.test(v)) throw new LucConfigError(name);
  return v;
}

export async function hmacHexWith(secret: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies x-luc-signature = hex(HMAC-SHA256(secret, body)). Throws LucConfigError if secret unusable. */
export async function verifyEdgeSignature(secret: string | undefined | null, body: string, signature: string | null): Promise<boolean> {
  const key = requireSecret("LUC_EDGE_SECRET", secret);
  const sig = (signature ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  return timingSafeEqualHex(sig, await hmacHexWith(key, body));
}
