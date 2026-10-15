import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { redactedDeliveryEvent, verifyResendWebhookSignature } from "./index.ts";

const encoder = new TextEncoder();
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function signedFixture(rawBody: string) {
  const secretBytes = encoder.encode("synthetic-webhook-secret-32-bytes!!");
  const secret = `whsec_${base64(secretBytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  const id = "msg_synthetic_123456";
  const timestamp = "1700000000";
  const key = await crypto.subtle.importKey("raw", secretBytes.slice().buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = encoder.encode(`${id}.${timestamp}.${rawBody}`);
  const signature = base64(new Uint8Array(await crypto.subtle.sign("HMAC", key, signed.slice().buffer as ArrayBuffer)));
  return { secret, id, timestamp, signature: `v1,${signature}`, rawBody };
}

Deno.test("signed Resend webhook input is verified without retaining its raw payload", async () => {
  const fixture = await signedFixture('{"type":"email.delivered","data":{"email_id":"msg_123456789012345"}}');
  assert(await verifyResendWebhookSignature({ ...fixture, nowMs: 1_700_000_010_000 }));
  assertEquals(await verifyResendWebhookSignature({ ...fixture, rawBody: "{}", nowMs: 1_700_000_010_000 }), false);
  assertEquals(await verifyResendWebhookSignature({ ...fixture, nowMs: 1_700_000_400_000 }), false);
});

Deno.test("only allowed delivery events are reduced to opaque ids and safe status names", () => {
  const delivered = redactedDeliveryEvent({ type: "email.delivered", data: { email_id: "msg_123456789012345", to: ["person@example.test"], subject: "do not retain" } });
  assertEquals(delivered, { providerMessageId: "msg_123456789012345", state: "delivered" });
  assertEquals(redactedDeliveryEvent({ type: "email.bounced", data: { email_id: "msg_123456789012345" } }), { providerMessageId: "msg_123456789012345", state: "needs_attention" });
  assertEquals(redactedDeliveryEvent({ type: "email.opened", data: { email_id: "msg_123456789012345" } }), undefined);
  assertEquals(redactedDeliveryEvent({ type: "email.delivered", data: { email_id: "person@example.test" } }), undefined);
  assert(!JSON.stringify(delivered).includes("person@example.test"));
});
