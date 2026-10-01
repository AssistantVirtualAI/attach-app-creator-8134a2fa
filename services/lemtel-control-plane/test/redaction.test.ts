import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, redactString } from "../src/lib/redact.js";

test("sensitive keys are redacted at any depth", () => {
  const out = redact({ authorization: "Bearer x", nested: { password: "p", sip_user: "s", pbx_host: "h", api_key: "k", cookie: "c", credential: "c", ok: "fine" }, list: [{ token: "t" }] }) as any;
  assert.equal(out.authorization, "[REDACTED]");
  for (const k of ["password", "sip_user", "pbx_host", "api_key", "cookie", "credential"]) assert.equal(out.nested[k], "[REDACTED]");
  assert.equal(out.nested.ok, "fine"); assert.equal(out.list[0].token, "[REDACTED]");
});

test("URL userinfo is removed", () => {
  const s = redactString("connect postgres://cp_app:Sup3rS3cret@db:5432/cp failed");
  assert.ok(!s.includes("Sup3rS3cret")); assert.ok(!s.includes("cp_app")); assert.ok(s.includes("@db:5432"));
});
