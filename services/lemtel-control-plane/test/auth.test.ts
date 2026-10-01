import { test } from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual, extractBearer } from "../src/auth.js";
import { app, TOKEN } from "./helpers.js";

test("constant-time comparison", () => {
  assert.equal(constantTimeEqual(TOKEN, TOKEN), true);
  assert.equal(constantTimeEqual(TOKEN, TOKEN.slice(0, -1) + "X"), false);
  assert.equal(constantTimeEqual(TOKEN, TOKEN + "a"), false);
  assert.equal(constantTimeEqual("", TOKEN), false);
});

test("bearer extraction validates format", () => {
  assert.equal(extractBearer(`Bearer ${TOKEN}`), TOKEN);
  for (const h of [undefined, "", TOKEN, `Basic ${TOKEN}`, "Bearer short", `Bearer ${TOKEN} x`]) assert.equal(extractBearer(h), null);
});

test("internal routes require the service token with a generic 401", async () => {
  const a = app();
  for (const headers of [{}, { authorization: "Bearer nope" }, { authorization: `Bearer ${TOKEN.slice(0, -1)}Z` }, { authorization: `Token ${TOKEN}` }]) {
    const r = await a.inject({ method: "GET", url: "/v1/internal/status", headers });
    assert.equal(r.statusCode, 401); assert.deepEqual(r.json(), { error: "unauthorized" });
  }
  const r = await a.inject({ method: "GET", url: "/v1/internal/status", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { controlPlane: "foundation", edge: "disabled", fusionPbx: "disabled", push: "disabled" });
  assert.equal(r.headers["access-control-allow-origin"], undefined);
});

test("audit route validation and idempotency", async () => {
  const { MemoryAudit } = await import("./helpers.js");
  const audit = new MemoryAudit(); const a = app({ audit });
  const auth = { authorization: `Bearer ${TOKEN}` };
  const post = (payload: string, headers: Record<string, string> = { ...auth, "content-type": "application/json" }) => a.inject({ method: "POST", url: "/v1/internal/audit", headers, payload });
  assert.equal((await post('{"action":"control_plane.test"}', { "content-type": "application/json" })).statusCode, 401);
  assert.equal((await post('{"action":"control_plane.test"}', { ...auth, "content-type": "text/plain" })).statusCode, 415);
  assert.equal((await post('{"action":"control_plane.test","tenant":"x"}')).statusCode, 400);
  assert.equal((await post('{"action":"control_plane.test","metadata":{}}')).statusCode, 400);
  assert.equal((await post('{"action":"delete_everything"}')).statusCode, 400);
  assert.equal((await post(JSON.stringify({ action: "control_plane." + "a".repeat(80) }))).statusCode, 400);
  assert.equal((await post('{"action":"control_plane.test","requestId":"bad id!"}')).statusCode, 400);
  const r1 = await post('{"action":"control_plane.smoke","requestId":"req-1"}');
  const r2 = await post('{"action":"control_plane.smoke","requestId":"req-1"}');
  assert.equal(r1.statusCode, 200); assert.deepEqual(r1.json(), { ok: true }); assert.deepEqual(r2.json(), { ok: true });
  assert.equal(audit.rows.length, 1); assert.equal(audit.rows[0].source, "internal_test");
  assert.equal((await post("x".repeat(5000))).statusCode, 413);
});
