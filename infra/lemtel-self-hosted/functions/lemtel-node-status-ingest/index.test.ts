import assert from "node:assert/strict";
import { createNodeStatusHandler, validateEnvelope, type NodeStatusEnvelope } from "./index.ts";

const now = Date.UTC(2026, 9, 15, 12, 0, 30);
// Synthetic local fixtures only; neither value is provisioned or emitted.
const writerSecret = "a".repeat(64);
const standbySecret = "b".repeat(64);
const sample: NodeStatusEnvelope = {
  nodeRole: "do_writer", observedAt: "2026-10-15T12:00:00Z", agentState: "healthy",
  runtimeState: "ready", replicationState: "streaming", storageState: "synced",
};
async function request(text = JSON.stringify(sample), options: { proof?: string; secret?: string; origin?: string; fetchMode?: string; method?: string } = {}) {
  const payload = text ?? JSON.stringify(sample);
  let role: unknown = "do_writer";
  try { role = JSON.parse(payload).nodeRole; } catch { /* Invalid fixtures use the writer secret. */ }
  const secret = options.secret ?? (role === "hostinger_standby" ? standbySecret : writerSecret);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request("https://local.invalid/functions/v1/lemtel-node-status-ingest", {
    method: options.method ?? "POST",
    headers: { "Content-Type": "application/json", "X-Lemtel-Node-Status-Signature": options.proof ?? `sha256=${signature}`, ...(options.origin ? { Origin: options.origin } : {}), ...(options.fetchMode ? { "Sec-Fetch-Mode": options.fetchMode } : {}) },
    body: options.method && options.method !== "POST" ? undefined : payload,
  });
}
function fixture(outcome: "recorded" | "failed" = "recorded", secrets = { do_writer: writerSecret, hostinger_standby: standbySecret }) {
  const received: NodeStatusEnvelope[] = [];
  return { received, handler: createNodeStatusHandler({ now: () => now,
    env: (name) => name === "LEMTEL_NODE_STATUS_DO_WRITER_SECRET" ? secrets.do_writer : name === "LEMTEL_NODE_STATUS_HOSTINGER_STANDBY_SECRET" ? secrets.hostinger_standby : name === "SUPABASE_URL" ? "https://local.invalid" : name === "SUPABASE_SERVICE_ROLE_KEY" ? "synthetic-service-key" : undefined,
    persist: async (_url, _key, envelope) => { received.push(envelope); return outcome; },
  }) };
}

Deno.test("only exact bounded redacted envelopes for both roles are acknowledged", async () => {
  for (const nodeRole of ["do_writer", "hostinger_standby"] as const) {
    const f = fixture();
    const response = await f.handler(await request(JSON.stringify({ ...sample, nodeRole })));
    assert.equal(response.status, 204); assert.equal(await response.text(), "");
    assert.deepEqual(f.received, [{ ...sample, nodeRole }]);
  }
});
Deno.test("role secrets are distinct and HMAC failures never persist", async () => {
  const standby = JSON.stringify({ ...sample, nodeRole: "hostinger_standby" });
  for (const proof of ["", "sha256=" + "0".repeat(64), "sha256=" + "A".repeat(64)]) {
    const f = fixture(); const response = await f.handler(await request(standby, { proof }));
    assert.equal(response.status, 401); assert.equal(f.received.length, 0);
  }
  const f = fixture();
  assert.equal((await f.handler(await request(standby, { secret: writerSecret }))).status, 401);
  assert.equal(f.received.length, 0);
});
Deno.test("strict canonical envelope rejects extras, duplicate keys, invalid states and skew", () => {
  const invalid = [
    { ...sample, agentState: "raw-error" }, { ...sample, runtimeState: "running" }, { ...sample, replicationState: "lag=1" },
    { ...sample, storageState: "message" }, { ...sample, observedAt: "2026-10-15T12:00:01Z" },
    { ...sample, observedAt: "2026-10-15T11:57:00Z" }, { ...sample, observedAt: "2026-10-15T12:03:00Z" },
    { ...sample, extra: "hostname" }, { ...sample, nodeRole: "writer" }, [], null,
  ];
  for (const value of invalid) assert.equal(validateEnvelope(JSON.stringify(value), now), null);
  assert.equal(validateEnvelope(" " + JSON.stringify(sample), now), null);
  assert.equal(validateEnvelope(JSON.stringify(sample).replace("{", '{"agentState":"degraded",'), now), null);
  assert.notEqual(validateEnvelope(JSON.stringify(sample), now), null);
});
Deno.test("non-POST and browser-shaped requests have no CORS response or persistence", async () => {
  const f = fixture();
  for (const input of [await request(undefined, { method: "GET" }), await request(undefined, { method: "OPTIONS" }), await request(undefined, { origin: "https://browser.invalid" }), await request(undefined, { fetchMode: "cors" })]) {
    const response = await f.handler(input);
    assert.ok([403, 405].includes(response.status)); assert.equal(response.headers.has("Access-Control-Allow-Origin"), false); assert.equal(await response.text(), "");
  }
  assert.equal(f.received.length, 0);
});
Deno.test("media, size, secret/runtime and persistence failures are never acknowledged", async () => {
  const f = fixture();
  assert.equal((await f.handler(await request("x".repeat(385)))).status, 413);
  const media = await request(); media.headers.set("Content-Type", "text/plain");
  assert.equal((await f.handler(media)).status, 415);
  assert.equal((await fixture("failed").handler(await request())).status, 503);
  assert.equal((await fixture("recorded", { do_writer: "short", hostinger_standby: standbySecret }).handler(await request())).status, 503);
  assert.equal(f.received.length, 0);
});
