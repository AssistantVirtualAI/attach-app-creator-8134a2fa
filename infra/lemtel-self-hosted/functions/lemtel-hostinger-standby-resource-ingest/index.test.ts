import assert from "node:assert/strict";
import { createHostingerStandbyResourceHandler, HOSTINGER_STANDBY_SIGNATURE_HEADER, validateHostingerStandbyResources } from "./index.ts";
const now = Date.UTC(2026, 9, 18, 16, 50, 30);
const sample = { observedAt: "2026-10-18T16:50:00Z", cpuPercent: 12, memoryPercent: 48, diskPercent: 33, load1Milli: 90, load5Milli: 80, load15Milli: 70 };
const hostingerSecret = "a".repeat(64), doWriterSecret = "b".repeat(64);
async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function setup(env: Record<string, string>) {
  const persisted: unknown[] = [];
  const handler = createHostingerStandbyResourceHandler({ env: (key) => env[key], now: () => now, persist: (_u, _k, value) => { persisted.push(value); return Promise.resolve(true); } });
  return { handler, persisted };
}
const request = (body: string, signature?: string, extra: Record<string, string> = {}) => new Request("https://example.invalid/functions/v1/lemtel-hostinger-standby-resource-ingest", { method: "POST", body, headers: { "Content-Type": "application/json", ...(signature ? { [HOSTINGER_STANDBY_SIGNATURE_HEADER]: signature } : {}), ...extra } });
const env = { LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET: hostingerSecret, LEMTEL_DO_WRITER_RESOURCE_SECRET: doWriterSecret, SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "service" };
Deno.test("Hostinger standby resource envelope is exact, bounded and canonical", () => {
  assert.deepEqual(validateHostingerStandbyResources(JSON.stringify(sample), now), sample);
  for (const invalid of [{ ...sample, nodeRole: "hostinger_standby" }, { ...sample, cpuPercent: 101 }, { ...sample, load15Milli: -1 }, { ...sample, observedAt: "2026-10-18T16:46:00Z" }]) assert.equal(validateHostingerStandbyResources(JSON.stringify(invalid), now), null);
  assert.equal(validateHostingerStandbyResources(" " + JSON.stringify(sample), now), null);
});
Deno.test("only the role-bound Hostinger secret is accepted; the DO writer secret is refused", async () => {
  const body = JSON.stringify(sample);
  const ok = setup(env); assert.equal((await ok.handler(request(body, await sign(hostingerSecret, body)))).status, 204); assert.equal(ok.persisted.length, 1);
  const forged = setup(env); assert.equal((await forged.handler(request(body, await sign(doWriterSecret, body)))).status, 401); assert.equal(forged.persisted.length, 0);
  const unsigned = setup(env); assert.equal((await unsigned.handler(request(body))).status, 401);
  const missing = setup({ ...env, LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET: "" }); assert.equal((await missing.handler(request(body, await sign(hostingerSecret, body)))).status, 503); assert.equal(missing.persisted.length, 0);
  const browser = setup(env); assert.equal((await browser.handler(request(body, await sign(hostingerSecret, body), { Origin: "https://evil.invalid" }))).status, 403);
});
