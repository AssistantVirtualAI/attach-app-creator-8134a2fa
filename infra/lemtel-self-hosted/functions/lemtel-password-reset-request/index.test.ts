import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { passwordResetDeliveryPatch } from "./index.ts";

Deno.test("password reset failure state is actionable and never contains a temporary password", () => {
  const patch = passwordResetDeliveryPatch("failed", "provider_request_failed", undefined, "2026-10-15T00:00:00.000Z");
  assertEquals(patch, { state: "failed", attempted_at: "2026-10-15T00:00:00.000Z", failed_at: "2026-10-15T00:00:00.000Z", failure_code: "provider_request_failed", provider_message_id: null });
  assert(!JSON.stringify(patch).match(/password|secret|email/i));
});

Deno.test("post-acceptance Auth failure becomes needs_attention rather than delivered", () => {
  const patch = passwordResetDeliveryPatch("needs_attention", "credential_rotation_failed_after_provider_acceptance", "msg_123456789012345", "2026-10-15T00:00:00.000Z");
  assertEquals(patch.state, "needs_attention");
  assertEquals("failure_code" in patch ? patch.failure_code : undefined, "credential_rotation_failed_after_provider_acceptance");
});
