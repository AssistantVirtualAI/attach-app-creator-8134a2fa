// Lemtel Resend delivery webhook — source-only. It never fetches mail content, logs payloads,
// returns provider identifiers, or exposes recipient information. Deployment remains separately approved.
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 32 * 1024;
const MAX_SIGNATURE_AGE_SECONDS = 300;
type DeliveryState = "provider_accepted" | "delivered" | "needs_attention";
type DeliveryEvent = { providerMessageId: string; state: DeliveryState };

const respond = (status: number) => new Response(JSON.stringify({ ok: true }), { status, headers: JSON_HEADERS });
const reject = () => new Response(JSON.stringify({ error: "webhook_not_accepted" }), { status: 401, headers: JSON_HEADERS });

function decodeSecret(secret: string): Uint8Array | undefined {
  const encoded = secret.startsWith("whsec_") ? secret.slice(6) : "";
  if (!encoded || !/^[A-Za-z0-9_-]+={0,2}$/.test(encoded)) return undefined;
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
    const decoded = atob(normalized);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** Verifies the standard Svix headers used by Resend without retaining a webhook body. */
export async function verifyResendWebhookSignature(input: { secret: string; id: string | null; timestamp: string | null; signature: string | null; rawBody: string; nowMs?: number }): Promise<boolean> {
  const key = decodeSecret(input.secret);
  const timestamp = Number(input.timestamp);
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (!key || !input.id || !input.signature || !Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > MAX_SIGNATURE_AGE_SECONDS) return false;
  const cryptoKey = await crypto.subtle.importKey("raw", key.slice().buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${input.id}.${input.timestamp}.${input.rawBody}`);
  for (const candidate of input.signature.split(/\s+/)) {
    const match = /^v1,([A-Za-z0-9+/]+={0,2})$/.exec(candidate);
    if (!match) continue;
    try {
      const bytes = Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0));
      if (await crypto.subtle.verify("HMAC", cryptoKey, bytes.slice().buffer as ArrayBuffer, signed.slice().buffer as ArrayBuffer)) return true;
    } catch {
      // Do not distinguish malformed signatures from invalid signatures.
    }
  }
  return false;
}

/** Whitelists event types and retains only an opaque provider message id and a state transition. */
export function redactedDeliveryEvent(raw: unknown): DeliveryEvent | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const event = raw as { type?: unknown; data?: { email_id?: unknown } };
  const providerMessageId = typeof event.data?.email_id === "string" ? event.data.email_id : "";
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(providerMessageId)) return undefined;
  if (event.type === "email.sent") return { providerMessageId, state: "provider_accepted" };
  if (event.type === "email.delivered") return { providerMessageId, state: "delivered" };
  if (event.type === "email.bounced" || event.type === "email.failed") return { providerMessageId, state: "needs_attention" };
  return undefined;
}

async function applyDeliveryEvent(admin: any, event: DeliveryEvent) {
  const timestamp = new Date().toISOString();
  const patch = event.state === "delivered"
    ? { state: "delivered", delivered_at: timestamp }
    : event.state === "needs_attention"
      ? { state: "needs_attention", needs_attention_at: timestamp, failure_code: "provider_delivery_needs_attention" }
      : { state: "provider_accepted", provider_accepted_at: timestamp };
  // Webhooks are idempotent and cannot downgrade a confirmed delivery or overwrite a locally failed send.
  const allowedStates = event.state === "provider_accepted" ? ["pending", "provider_accepted"] : ["pending", "provider_accepted", "needs_attention"];
  const results = await Promise.all([
    admin.from("lemtel_onboarding_delivery_attempts").update(patch).eq("provider_message_id", event.providerMessageId).in("state", allowedStates),
    admin.from("lemtel_password_reset_delivery_attempts").update(patch).eq("provider_message_id", event.providerMessageId).in("state", allowedStates),
  ]);
  if (results.some((result: { error?: unknown }) => result.error)) throw new Error("delivery_state_update_failed");
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { "Cache-Control": "no-store" } });
  const contentLength = Number(req.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BODY_BYTES) return reject();
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return reject();
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";
  const valid = await verifyResendWebhookSignature({
    secret, id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature"), rawBody,
  });
  if (!valid) return reject();
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return reject(); }
  const event = redactedDeliveryEvent(payload);
  if (!event) return respond(202); // A valid but non-delivery Resend event is deliberately ignored.
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return new Response(JSON.stringify({ error: "webhook_unavailable" }), { status: 503, headers: JSON_HEADERS });
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    await applyDeliveryEvent(admin, event);
    return respond(202);
  } catch {
    return new Response(JSON.stringify({ error: "webhook_unavailable" }), { status: 503, headers: JSON_HEADERS });
  }
}

if (import.meta.main) Deno.serve(handler);
