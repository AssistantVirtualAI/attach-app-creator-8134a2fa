import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideCrmSync, internalBrokerStop } from "../crm-sync-authorization.ts";

const owner = { ok: true, serviceRole: false };
const pending = { save_consent: "pending", deleted_at: null };

Deno.test("legacy installed-app click {force:true} is accepted", () => {
  assertEquals(decideCrmSync({ access: owner, force: true, call: pending }), { allow: true, authorizeConsent: true });
});
Deno.test("new app click with explicit_user_action is accepted", () => {
  assertEquals(decideCrmSync({ access: owner, force: true, explicit_user_action: true, call: { save_consent: "approved" } }), { allow: true, authorizeConsent: false });
});
Deno.test("{force:false} automatic sync is blocked as manual_only", () => {
  const d = decideCrmSync({ access: owner, force: false, call: pending });
  assertEquals(d.allow, false);
  if (!d.allow) { assertEquals(d.code, "manual_only"); assertEquals(d.skipped, true); }
});
Deno.test("service-role is blocked even with force/explicit", () => {
  const d = decideCrmSync({ access: { ok: true, serviceRole: true }, force: true, explicit_user_action: true, call: pending });
  assertEquals(d.allow, false);
  if (!d.allow) assertEquals(d.code, "manual_only");
});
Deno.test("non-owner is blocked", () => {
  const d = decideCrmSync({ access: { ok: false, status: 403, error: "forbidden" }, force: true, explicit_user_action: true, call: pending });
  assertEquals(d.allow, false);
  if (!d.allow) assertEquals(d.code, "forbidden");
});
Deno.test("deleted call is blocked", () => {
  const d = decideCrmSync({ access: owner, explicit_user_action: true, call: { save_consent: "approved", deleted_at: "2026-10-05T00:00:00Z" } });
  assertEquals(d.allow, false);
  if (!d.allow) assertEquals(d.code, "call_deleted");
});
Deno.test("internal inbound broker call returns internal_broker_call", () => {
  assertEquals(internalBrokerStop("internal_broker_inbound")?.code, "internal_broker_call");
  assertEquals(internalBrokerStop(null), null);
});
