import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { ConfigError } from "../src/lib/errors.js";
import { TOKEN } from "./helpers.js";

const base = {
  NODE_ENV: "test", CONTROL_PLANE_PORT: "8080",
  CONTROL_PLANE_DATABASE_URL: "postgres://cp_app:Qx7rLm2vNp9tZk@127.0.0.1:5432/cp",
  CONTROL_PLANE_REDIS_URL: "redis://127.0.0.1:6379",
  CONTROL_PLANE_SERVICE_TOKEN: TOKEN, CONTROL_PLANE_LOG_LEVEL: "info",
};

test("valid local test config parses", () => {
  const c = loadConfig(base);
  assert.equal(c.port, 8080); assert.equal(c.nodeEnv, "test");
});

test("missing or blank values fail closed naming only the setting", () => {
  for (const k of Object.keys(base)) {
    for (const v of [undefined, "", "   "]) {
      assert.throws(() => loadConfig({ ...base, [k]: v }), (e: unknown) => e instanceof ConfigError && e.message.includes(k) && e.message.includes("missing"));
    }
  }
});

test("weak tokens are rejected without leaking the value", () => {
  for (const t of ["abc12", "changeme".repeat(5), "replace-me-replace-me-replace-me-123", "0".repeat(40), "a".repeat(40), "default_default_default_default_default", "my-secret-token-that-is-long-enough-xx"]) {
    assert.throws(() => loadConfig({ ...base, CONTROL_PLANE_SERVICE_TOKEN: t }), (e: unknown) => e instanceof ConfigError && !e.message.includes(t));
  }
});

test("malformed or unsafe URLs are rejected", () => {
  assert.throws(() => loadConfig({ ...base, CONTROL_PLANE_DATABASE_URL: "mysql://h/db" }), /scheme_not_allowed/);
  assert.throws(() => loadConfig({ ...base, CONTROL_PLANE_DATABASE_URL: "not a url" }), /malformed/);
  assert.throws(() => loadConfig({ ...base, CONTROL_PLANE_DATABASE_URL: "postgres://u:changeme@db/cp" }), /weak_password/);
  assert.throws(() => loadConfig({ ...base, CONTROL_PLANE_REDIS_URL: "http://cache" }), /scheme_not_allowed/);
});

test("production rejects local URLs and debug logs", () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "production" }), /insecure_for_production/);
  const prod = { ...base, NODE_ENV: "production", CONTROL_PLANE_DATABASE_URL: "postgres://cp_app:Qx7rLm2vNp9tZk@db:5432/cp", CONTROL_PLANE_REDIS_URL: "redis://:Rz8kWq3nVb6tYm@cache:6379" };
  assert.equal(loadConfig(prod).nodeEnv, "production");
  assert.throws(() => loadConfig({ ...prod, CONTROL_PLANE_LOG_LEVEL: "debug" }), /debug_not_allowed/);
});

test("bad port and log level rejected", () => {
  assert.throws(() => loadConfig({ ...base, CONTROL_PLANE_PORT: "99999" }), /PORT/);
  assert.throws(() => loadConfig({ ...base, CONTROL_PLANE_LOG_LEVEL: "loud" }), /LOG_LEVEL/);
});
