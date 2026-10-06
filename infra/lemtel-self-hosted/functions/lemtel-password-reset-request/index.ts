// Lemtel password-recovery request — source package only.
// This endpoint always returns a generic accepted response to avoid account enumeration.
// A temporary password is generated in memory, stored only in Supabase Auth and sent once
// through the approved transactional provider. It is never logged or stored in Lemtel tables.
import { createClient } from "npm:@supabase/supabase-js@2";

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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function passwordMessage(input: { locale: Locale; displayName: string; temporaryPassword: string }) {
  const displayName = escapeHtml(input.displayName);
  const password = escapeHtml(input.temporaryPassword);
  if (input.locale === "fr") {
    return {
      subject: "Lemtel — votre mot de passe temporaire",
      html: `<main style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;max-width:620px;margin:auto;color:#10213b"><h1>Bonjour ${displayName},</h1><p>Une demande de réinitialisation de mot de passe a été reçue pour votre compte Lemtel.</p><p><strong>Mot de passe temporaire :</strong> <code>${password}</code></p><p>Ouvrez l’application Lemtel et connectez-vous avec votre adresse e-mail et ce mot de passe temporaire. Vous devrez immédiatement choisir votre mot de passe personnel. Vous n’avez jamais à saisir un poste ou un domaine SIP.</p><p style="color:#64748b;font-size:12px">Ne partagez pas ce mot de passe. Si vous n’avez pas fait cette demande, contactez le soutien Lemtel dès que possible.</p></main>`,
    };
  }
  return {
    subject: "Lemtel — your temporary password",
    html: `<main style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;max-width:620px;margin:auto;color:#10213b"><h1>Hello ${displayName},</h1><p>A password recovery request was received for your Lemtel account.</p><p><strong>Temporary password:</strong> <code>${password}</code></p><p>Open the Lemtel app and sign in with your email address and this temporary password. You will be required to choose your personal password immediately. You never need to enter an extension or SIP domain.</p><p style="color:#64748b;font-size:12px">Do not share this password. If you did not request it, contact Lemtel support as soon as possible.</p></main>`,
  };
}

function emailConfig(): { apiKey: string; from: string } | null {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("LEMTEL_WELCOME_FROM") ?? "";
  return apiKey && from ? { apiKey, from } : null;
}

async function setDeliveryState(admin: any, id: string, state: "sent" | "failed", failureCode?: string, providerMessageId?: string) {
  const timestamp = new Date().toISOString();
  await admin.from("lemtel_password_reset_delivery_attempts").update({
    state,
    attempted_at: timestamp,
    ...(state === "sent" ? { sent_at: timestamp, provider_message_id: providerMessageId ?? null } : { failed_at: timestamp, failure_code: failureCode ?? "provider_delivery_failed" }),
  }).eq("id", id);
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
  const configuration = emailConfig();
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
  const { data: userResult } = await admin.auth.admin.getUserById(recipient.user_id);
  const existingMetadata = userResult?.user?.app_metadata ?? {};
  const { error: updateError } = await admin.auth.admin.updateUserById(recipient.user_id, {
    password: temporaryPassword,
    app_metadata: { ...existingMetadata, lemtel_onboarding_required: true, lemtel_email_only_signin: true },
  });
  if (updateError) {
    await setDeliveryState(admin, deliveryAttempt, "failed", "auth_password_rotation_failed");
    await admin.rpc("lemtel_release_failed_password_reset", { p_user_id: recipient.user_id });
    return accepted();
  }

  const message = passwordMessage({ locale: recipient.locale, displayName: recipient.display_name || email.split("@")[0], temporaryPassword });
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${configuration.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: configuration.from, to: [email], subject: message.subject, html: message.html }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("provider_delivery_failed");
    await setDeliveryState(admin, deliveryAttempt, "sent", undefined, typeof payload?.id === "string" ? payload.id : undefined);
  } catch {
    await setDeliveryState(admin, deliveryAttempt, "failed", "provider_delivery_failed");
    await admin.rpc("lemtel_release_failed_password_reset", { p_user_id: recipient.user_id });
  }

  return accepted();
}

Deno.serve(handler);
