import { test } from "node:test";
import assert from "node:assert/strict";
import { app, down, hang, ok } from "./helpers.js";

test("/health/live returns 200 without touching dependencies", async () => {
  let touched = false;
  const spy = { ping: async () => { touched = true; } };
  const r = await app({ db: spy, redis: spy }).inject({ method: "GET", url: "/health/live" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { service: "lemtel-control-plane", version: "0.1.0", status: "live" });
  assert.equal(touched, false);
  assert.ok(r.headers["x-request-id"]); assert.equal(r.headers["x-content-type-options"], "nosniff");
});

test("/health/ready is 200 only when both dependencies answer", async () => {
  assert.equal((await app().inject({ method: "GET", url: "/health/ready" })).statusCode, 200);
  for (const [db, redis] of [[down, ok], [ok, down], [hang, ok], [ok, hang]]) {
    const r = await app({ db, redis }).inject({ method: "GET", url: "/health/ready" });
    assert.equal(r.statusCode, 503); assert.equal(r.body, '{"status":"not_ready"}');
  }
});

test("unknown routes return a generic 404 with no stack", async () => {
  const r = await app().inject({ method: "GET", url: "/v1/devices" });
  assert.equal(r.statusCode, 404); assert.deepEqual(r.json(), { error: "not_found" });
});
