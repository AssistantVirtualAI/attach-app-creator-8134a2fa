// Lemtel password-recovery request — source package only.
// This endpoint always returns a generic accepted response to avoid account enumeration.
// A temporary password is generated in memory, stored only in Supabase Auth and sent once
// through the approved transactional provider. It is never logged or stored in Lemtel tables.
import { createClient } from "npm:@supabase/supabase-js@2";
import { emailConfig as configuredEmail, sendWithResend, transactionalEmailMessage } from "../_shared/lemtelTransactionalEmail.ts";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Locale = "fr" | "en";
type Recipient = { user_id: string; organization_id: string; display_name: string; locale: Locale };

const accepted = () => new Response(JSON.stringify({ ok: true, status: "request_accepted" }), { status: 202, headers: JSON_HEADERS });
const fail = (error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function randomPassword(length = 20): string {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*-_+"];
  const all = groups.join("");
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  const chars = groups.map((group, index) => group[bytes[index] % group.length]);
  for (let i = chars.length; i < length; i++) chars.push(all[bytes[i] % all.length]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[(i + 5) % bytes.length] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Configuration is checked before a throttle claim or password mutation. */
function transactionalEmailConfig() {
  return configuredEmail(Deno.env);
}

export function passwordResetDeliveryPatch(state: "provider_accepted" | "failed" | "needs_attention", failureCode?: string, providerMessageId?: string, timestamp = new Date().toISOString()) {
  return {
    state,
    attempted_at: timestamp,
    ...(state === "provider_accepted"
      ? { provider_accepted_at: timestamp, provider_message_id: providerMessageId ?? null }
      : state === "needs_attention"
        ? { needs_attention_at: timestamp, failure_code: failureCode ?? "credential_rotation_failed_after_provider_acceptance", provider_message_id: providerMessageId ?? null }
        : { failed_at: timestamp, failure_code: failureCode ?? "provider_request_failed", provider_message_id: providerMessageId ?? null }),
  };
}

async function setDeliveryState(admin: any, id: string, state: "provider_accepted" | "failed" | "needs_attention", failureCode?: string, providerMessageId?: string) {
  await admin.from("lemtel_password_reset_delivery_attempts").update(passwordResetDeliveryPatch(state, failureCode, providerMessageId)).eq("id", id);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  let raw: unknown;
  try { raw = await req.json(); } catch { return fail("invalid_json", 400); }
  if (!plainObject(raw) || Object.keys(raw).length !== 1 || typeof raw.email !== "string") return fail("invalid_body", 400);
  const email = raw.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return fail("invalid_email", 400);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const configuration = transactionalEmailConfig();
  if (!url || !serviceRoleKey || !configuration) return fail("password_recovery_unavailable", 503);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  const { data: matches, error: lookupError } = await admin.rpc("lemtel_find_password_reset_recipient", { p_email: email });
  if (lookupError || !Array.isArray(matches) || matches.length !== 1) return accepted();
  const recipient = matches[0] as Recipient;
  if (!recipient?.user_id || !recipient.organization_id || (recipient.locale !== "fr" && recipient.locale !== "en")) return accepted();

  const { data: deliveryAttempt, error: claimError } = await admin.rpc("lemtel_claim_password_reset", {
    p_user_id: recipient.user_id,
    p_organization_id: recipient.organization_id,
    p_locale: recipient.locale,
    p_cooldown_seconds: 900,
  });
  if (claimError || typeof deliveryAttempt !== "string" || !deliveryAttempt) return accepted();

  const temporaryPassword = randomPassword();
  const message = transactionalEmailMessage({
    kind: "password_recovery", locale: recipient.locale, displayName: recipient.display_name || email.split("@")[0],
    email, temporaryPassword, config: configuration,
  });
  const provider = await sendWithResend(configuration, email, message);
  if (!provider.accepted) {
    await setDeliveryState(admin, deliveryAttempt, "failed", "provider_request_failed");
    await admin.rpc("lemtel_release_failed_password_reset", { p_user_id: recipient.user_id });
    return accepted();
  }

  // Never replace a working password before the transactional provider accepts
  // its delivery request. A provider refusal must leave the existing sign-in
  // credential usable; an accepted email paired with a rare Auth failure is
  // auditable and retryable without locking the user out.
  const { data: userResult } = await admin.auth.admin.getUserById(recipient.user_id);
  const existingMetadata = userResult?.user?.app_metadata ?? {};
  const { error: updateError } = await admin.auth.admin.updateUserById(recipient.user_id, {
    password: temporaryPassword,
    app_metadata: { ...existingMetadata, lemtel_onboarding_required: true, lemtel_email_only_signin: true },
  });
  if (updateError) {
    // The provider accepted the request but no usable password was committed: surface action, not delivery.
    await setDeliveryState(admin, deliveryAttempt, "needs_attention", "credential_rotation_failed_after_provider_acceptance", provider.providerMessageId);
    await admin.rpc("lemtel_release_failed_password_reset", { p_user_id: recipient.user_id });
    return accepted();
  }

  // Provider acceptance is not inbox delivery. A signed provider webhook may later mark this delivered.
  await setDeliveryState(admin, deliveryAttempt, "provider_accepted", undefined, provider.providerMessageId);

  return accepted();
}

if (import.meta.main) Deno.serve(handler);
