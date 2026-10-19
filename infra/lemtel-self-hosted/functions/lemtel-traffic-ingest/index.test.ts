import assert from "node:assert/strict";
import { createTrafficHandler, validateEnvelope, type TrafficEnvelope } from "./index.ts";

const now = Date.UTC(2026, 9, 15, 12, 0, 30);
// Synthetic local fixture only; never printed and not a provisioned secret.
const fixtureSecret = "a".repeat(64);
const hostingerFixtureSecret = "c".repeat(64);
const sample: TrafficEnvelope = { nodeRole: "do_writer", observedAt: "2026-10-15T12:00:00Z", periodSeconds: 60, rxBytes: 1234, txBytes: 5678, tcpEstablished: 12 };
async function request(text = JSON.stringify(sample), options: { proof?: string; origin?: string; method?: string; secret?: string } = {}) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(options.secret ?? fixtureSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request("https://local.invalid/functions/v1/lemtel-traffic-ingest", {
    method: options.method ?? "POST", headers: { "Content-Type": "application/json", "X-Lemtel-Traffic-Signature": options.proof ?? `sha256=${signature}`, ...(options.origin ? { Origin: options.origin } : {}) },
    body: options.method === "OPTIONS" || options.method === "GET" ? undefined : text,
  });
}
function fixture(outcome: "inserted" | "duplicate" | "failed" = "inserted", secret: string | undefined = fixtureSecret, hostingerSecret: string | undefined = hostingerFixtureSecret) {
  const received: TrafficEnvelope[] = [];
  return { received, handler: createTrafficHandler({ now: () => now,
    env: (name) => name === "LEMTEL_TRAFFIC_COLLECTOR_SECRET" ? secret : name === "LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET" ? hostingerSecret : name === "SUPABASE_URL" ? "https://local.invalid" : "synthetic-service-key",
    persist: async (_url, _key, envelope) => { received.push(envelope); return outcome; },
  }) };
}

Deno.test("HMAC ingress persists only both bounded role envelopes and returns no content", async () => {
  for (const nodeRole of ["do_writer", "hostinger_standby"] as const) {
    const f = fixture();
    const response = await f.handler(await request(JSON.stringify({ ...sample, nodeRole }), { secret: nodeRole === "do_writer" ? fixtureSecret : hostingerFixtureSecret }));
    assert.equal(response.status, 204); assert.equal(await response.text(), "");
    assert.deepEqual(f.received, [{ ...sample, nodeRole }]);
  }
});
Deno.test("secrets are role-bound: neither role can write the other's rows", async () => {
  const hostingerBody = JSON.stringify({ ...sample, nodeRole: "hostinger_standby" });
  const shared = fixture(); assert.equal((await shared.handler(await request(hostingerBody, { secret: fixtureSecret }))).status, 401); assert.equal(shared.received.length, 0);
  const crossed = fixture(); assert.equal((await crossed.handler(await request(undefined, { secret: hostingerFixtureSecret }))).status, 401); assert.equal(crossed.received.length, 0);
  const absent = fixture("inserted", fixtureSecret, ""); assert.equal((await absent.handler(await request(hostingerBody, { secret: hostingerFixtureSecret }))).status, 503); assert.equal(absent.received.length, 0);
  const reused = fixture("inserted", fixtureSecret, fixtureSecret); assert.equal((await reused.handler(await request(hostingerBody, { secret: fixtureSecret }))).status, 503); assert.equal(reused.received.length, 0);
  const doStillWorks = fixture("inserted", fixtureSecret, ""); assert.equal((await doStillWorks.handler(await request())).status, 204);
});
Deno.test("missing/bogus/non-HMAC proofs fail closed without persistence", async () => {
  for (const proof of ["", "Bearer synthetic", "sha256=" + "0".repeat(64), "sha256=" + "A".repeat(64)]) {
    const f = fixture(); const response = await f.handler(await request(undefined, { proof }));
    assert.equal(response.status, 401); assert.equal(f.received.length, 0); assert.equal(await response.text(), "");
  }
  const f = fixture();
  const missing = await request(); missing.headers.delete("X-Lemtel-Traffic-Signature");
  assert.equal((await f.handler(missing)).status, 401);
});
Deno.test("secret missing, insecure format or env failure yields controlled unavailable", async () => {
  for (const secret of [undefined, "", "short", "A".repeat(64)]) {
    const f = fixture("inserted", secret === undefined ? "" : secret);
    assert.equal((await f.handler(await request())).status, 503); assert.equal(f.received.length, 0);
  }
  const handler = createTrafficHandler({ env: () => { throw new Error("hidden"); }, now: () => now, persist: async () => { throw new Error("unreachable"); } });
  assert.equal((await handler(await request())).status, 503);
});
Deno.test("exact envelope rejects unsafe values, dates, clock skew and extra fields", () => {
  const invalid = [
    { ...sample, nodeRole: "other" }, { ...sample, observedAt: "2026-02-30T12:00:00Z" },
    { ...sample, observedAt: "2026-10-15T11:57:00Z" }, { ...sample, observedAt: "2026-10-15T12:03:00Z" },
    { ...sample, observedAt: "2026-10-15T12:00:01Z" }, { ...sample, observedAt: "2026-10-15T12:00:00.000Z" },
    { ...sample, rxBytes: -1 }, { ...sample, txBytes: 1e12 + 1 }, { ...sample, rxBytes: "1" },
    { ...sample, rxBytes: null }, { ...sample, tcpEstablished: 1e6 + 1 }, { ...sample, tcpEstablished: 1.2 },
    { ...sample, periodSeconds: 29 }, { ...sample, periodSeconds: 301 }, { ...sample, periodSeconds: true },
    { ...sample, extra: "must-not-persist" }, { ...sample, nodeRole: null }, [], null,
  ];
  for (const value of invalid) assert.equal(validateEnvelope(JSON.stringify(value), now), null);
  assert.equal(validateEnvelope(" " + JSON.stringify(sample), now), null);
  assert.equal(validateEnvelope(JSON.stringify(sample).replace('{', '{"rxBytes":1,'), now), null);
  const { rxBytes: _missing, ...missing } = sample; assert.equal(validateEnvelope(JSON.stringify(missing), now), null);
  assert.notEqual(validateEnvelope(JSON.stringify({ ...sample, rxBytes: 0, txBytes: 1e12, tcpEstablished: 1e6 }), now), null);
});
Deno.test("signed invalid/oversized payloads and media errors are rejected", async () => {
  const f = fixture();
  assert.equal((await f.handler(await request(JSON.stringify({ ...sample, extra: true })))).status, 400);
  assert.equal((await f.handler(await request("x".repeat(513)))).status, 413);
  const req = await request(); req.headers.set("Content-Type", "text/plain");
  assert.equal((await f.handler(req)).status, 415);
  assert.equal(f.received.length, 0);
});
Deno.test("CORS has no allow-origin or reflected origin and never accepts browser POST", async () => {
  const f = fixture();
  for (const method of ["POST", "OPTIONS", "GET"]) {
    const response = await f.handler(await request(undefined, { method, origin: "https://browser.invalid" }));
    assert.equal(response.status, method === "POST" ? 403 : method === "OPTIONS" ? 204 : 405);
    assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
    assert.equal(await response.text(), "");
  }
  assert.equal(f.received.length, 0);
});
Deno.test("duplicates are idempotent; database or runtime failure is not acknowledged", async () => {
  assert.equal((await fixture("duplicate").handler(await request())).status, 204);
  assert.equal((await fixture("failed").handler(await request())).status, 503);
  const handler = createTrafficHandler({ env: (name) => name === "LEMTEL_TRAFFIC_COLLECTOR_SECRET" ? fixtureSecret : undefined,
    now: () => now, persist: async () => { throw new Error("hidden"); } });
  assert.equal((await handler(await request())).status, 503);
});
