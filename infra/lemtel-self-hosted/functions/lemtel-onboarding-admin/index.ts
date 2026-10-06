// Lemtel email-only onboarding — source package only.
// Deployment and email delivery require explicit approval, a fresh backup, and configured secrets.
// This function never calls FusionPBX and never persists or logs a temporary password.
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,62}$/;
const ROLES = ["owner", "admin", "member"] as const;
type Role = typeof ROLES[number];
type Locale = "fr" | "en";
type Failure = { error: string; status: number };
type UserInput = { email: string; displayName: string; role: Role; locale: Locale };
type OrganizationInput = { displayName: string; slug: string; defaultLocale: Locale };
type RequestBody =
  | { action: "create_organization"; organization: OrganizationInput; owner: UserInput; users: UserInput[] }
  | { action: "provision_users"; organizationId: string; users: UserInput[] }
  | { action: "resend_welcome"; organizationId: string; recipientUserId: string; locale: Locale };

const fail = (error: string, status: number): Failure => ({ error, status });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const isFailure = (value: unknown): value is Failure => typeof value === "object" && value !== null && "error" in value && "status" in value;
const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).length === expected.length && expected.every((key) => key in value);
}

function locale(value: unknown): Locale | Failure {
  return value === "fr" || value === "en" ? value : fail("invalid_locale", 400);
}

function userInput(value: unknown, allowOwner: boolean): UserInput | Failure {
  if (!plainObject(value) || !exactKeys(value, ["email", "displayName", "role", "locale"])) return fail("invalid_user", 400);
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const displayName = typeof value.displayName === "string" ? value.displayName.trim() : "";
  const role = value.role;
  const selectedLocale = locale(value.locale);
  if (!EMAIL_RE.test(email) || email.length > 254 || !displayName || displayName.length > 160) return fail("invalid_user", 400);
  if (!(ROLES as readonly string[]).includes(String(role)) || (!allowOwner && role === "owner")) return fail("invalid_role", 400);
  if (isFailure(selectedLocale)) return selectedLocale;
  return { email, displayName, role: role as Role, locale: selectedLocale };
}

function userList(value: unknown, allowOwner: boolean): UserInput[] | Failure {
  if (!Array.isArray(value) || value.length > 200) return fail("invalid_users", 400);
  const seen = new Set<string>();
  const users: UserInput[] = [];
  for (const entry of value) {
    const parsed = userInput(entry, allowOwner);
    if (isFailure(parsed)) return parsed;
    if (seen.has(parsed.email)) return fail("duplicate_email", 400);
    seen.add(parsed.email);
    users.push(parsed);
  }
  return users;
}

export function validateBody(raw: unknown): RequestBody | Failure {
  if (!plainObject(raw) || typeof raw.action !== "string") return fail("invalid_body", 400);
  if (raw.action === "create_organization") {
    if (!exactKeys(raw, ["action", "organization", "owner", "users"]) || !plainObject(raw.organization)) return fail("invalid_body", 400);
    const org = raw.organization;
    const displayName = typeof org.displayName === "string" ? org.displayName.trim() : "";
    const slug = typeof org.slug === "string" ? org.slug.trim().toLowerCase() : "";
    const defaultLocale = locale(org.defaultLocale);
    const owner = userInput(raw.owner, true);
    const users = userList(raw.users, false);
    if (!exactKeys(org, ["displayName", "slug", "defaultLocale"]) || !displayName || displayName.length > 160 || !SLUG_RE.test(slug)) return fail("invalid_organization", 400);
    if (isFailure(defaultLocale)) return defaultLocale;
    if (isFailure(owner)) return owner;
    if (owner.role !== "owner") return fail("owner_role_required", 400);
    if (isFailure(users)) return users;
    if (users.some((user) => user.email === owner.email)) return fail("duplicate_email", 400);
    return { action: "create_organization", organization: { displayName, slug, defaultLocale }, owner, users };
  }
  if (raw.action === "provision_users") {
    if (!exactKeys(raw, ["action", "organizationId", "users"]) || typeof raw.organizationId !== "string" || !UUID_RE.test(raw.organizationId)) return fail("invalid_body", 400);
    const users = userList(raw.users, false);
    if (isFailure(users) || users.length === 0) return isFailure(users) ? users : fail("users_required", 400);
    return { action: "provision_users", organizationId: raw.organizationId.toLowerCase(), users };
  }
  if (raw.action === "resend_welcome") {
    if (!exactKeys(raw, ["action", "organizationId", "recipientUserId", "locale"]) || typeof raw.organizationId !== "string" || typeof raw.recipientUserId !== "string" || !UUID_RE.test(raw.organizationId) || !UUID_RE.test(raw.recipientUserId)) return fail("invalid_body", 400);
    const selectedLocale = locale(raw.locale);
    if (isFailure(selectedLocale)) return selectedLocale;
    return { action: "resend_welcome", organizationId: raw.organizationId.toLowerCase(), recipientUserId: raw.recipientUserId.toLowerCase(), locale: selectedLocale };
  }
  return fail("invalid_action", 400);
}

function randomPassword(length = 20): string {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*-_+"];
  const all = groups.join("");
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  const chars = groups.map((group, index) => group[bytes[index] % group.length]);
  for (let i = chars.length; i < length; i++) chars.push(all[bytes[i] % all.length]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[(i + 3) % bytes.length] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function welcomeMessage(input: { locale: Locale; displayName: string; email: string; temporaryPassword: string; role: Role; downloadUrls: { ios: string; android: string; desktop: string } }) {
  const displayName = escapeHtml(input.displayName);
  const email = escapeHtml(input.email);
  const password = escapeHtml(input.temporaryPassword);
  const admin = input.role === "owner" || input.role === "admin";
  if (input.locale === "fr") {
    return {
      subject: "Bienvenue chez Lemtel — votre accès est prêt",
      html: `<main style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;max-width:620px;margin:auto;color:#10213b"><h1>Bienvenue chez Lemtel, ${displayName}</h1><p>Votre accès ${admin ? "administrateur" : "utilisateur"} est prêt.</p><p><strong>Nom d’utilisateur :</strong> ${email}<br/><strong>Mot de passe temporaire :</strong> <code>${password}</code></p><p>Ouvrez l’application Lemtel, entrez ces deux informations, puis choisissez immédiatement votre propre mot de passe. Vous ne devez jamais entrer un poste ou un domaine SIP.</p><h2>Télécharger Lemtel</h2><p><a href="${escapeHtml(input.downloadUrls.ios)}">iPhone / iPad</a> · <a href="${escapeHtml(input.downloadUrls.android)}">Android</a> · <a href="${escapeHtml(input.downloadUrls.desktop)}">Mac et Windows</a></p><p style="color:#64748b;font-size:12px">Ne partagez jamais ce mot de passe temporaire. Si vous n’attendiez pas ce courriel, contactez le soutien Lemtel.</p></main>`,
    };
  }
  return {
    subject: "Welcome to Lemtel — your access is ready",
    html: `<main style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;max-width:620px;margin:auto;color:#10213b"><h1>Welcome to Lemtel, ${displayName}</h1><p>Your ${admin ? "administrator" : "user"} access is ready.</p><p><strong>Username:</strong> ${email}<br/><strong>Temporary password:</strong> <code>${password}</code></p><p>Open the Lemtel app, enter these two values, then choose your own password immediately. You never need to enter an extension or SIP domain.</p><h2>Download Lemtel</h2><p><a href="${escapeHtml(input.downloadUrls.ios)}">iPhone / iPad</a> · <a href="${escapeHtml(input.downloadUrls.android)}">Android</a> · <a href="${escapeHtml(input.downloadUrls.desktop)}">Mac and Windows</a></p><p style="color:#64748b;font-size:12px">Never share this temporary password. If you did not expect this email, contact Lemtel support.</p></main>`,
  };
}

function emailConfig(): { apiKey: string; from: string; urls: { ios: string; android: string; desktop: string } } | Failure {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("LEMTEL_WELCOME_FROM") ?? "";
  const ios = Deno.env.get("LEMTEL_DOWNLOAD_IOS_URL") ?? "";
  const android = Deno.env.get("LEMTEL_DOWNLOAD_ANDROID_URL") ?? "";
  const desktop = Deno.env.get("LEMTEL_DOWNLOAD_DESKTOP_URL") ?? "";
  if (!apiKey || !from || !ios || !android || !desktop) return fail("email_provider_not_configured", 503);
  return { apiKey, from, urls: { ios, android, desktop } };
}

async function actorId(admin: any, req: Request): Promise<string | Failure> {
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return fail("unauthorized", 401);
  const { data, error } = await admin.auth.getUser(token);
  const userId = data?.user?.id;
  return error || !userId ? fail("unauthorized", 401) : userId;
}

async function platformAdmin(admin: any, userId: string): Promise<boolean> {
  const { data } = await admin.from("lemtel_platform_administrators").select("user_id").eq("user_id", userId).eq("status", "active").maybeSingle();
  return Boolean(data?.user_id);
}

async function organizationAdmin(admin: any, userId: string, organizationId: string): Promise<boolean> {
  const { data } = await admin.from("lemtel_organization_memberships").select("user_id").eq("organization_id", organizationId).eq("user_id", userId).eq("status", "active").in("role", ["owner", "admin"]).maybeSingle();
  return Boolean(data?.user_id);
}

async function audit(admin: any, organizationId: string, actor: string, action: string, subjectUserId: string | null, metadata: Record<string, unknown>) {
  await admin.from("lemtel_onboarding_audit").insert({ organization_id: organizationId, actor_id: actor, subject_user_id: subjectUserId, action, metadata });
}

async function createRecipient(admin: any, organizationId: string, recipient: UserInput) {
  const temporaryPassword = randomPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: recipient.email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: recipient.displayName, locale: recipient.locale },
    app_metadata: { lemtel_onboarding_required: true, lemtel_email_only_signin: true },
  });
  const userId = data?.user?.id;
  if (error || !userId) return fail("user_create_failed", 409);
  const { error: membershipError } = await admin.from("lemtel_organization_memberships").insert({ organization_id: organizationId, user_id: userId, role: recipient.role, status: "active" });
  if (membershipError) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return fail("membership_create_failed", 503);
  }
  return { userId, temporaryPassword };
}

async function deliverWelcome(admin: any, organizationId: string, actor: string, userId: string, recipient: UserInput, temporaryPassword: string, kind: "welcome" | "welcome_resend") {
  const { data: attempt, error: attemptError } = await admin.from("lemtel_onboarding_delivery_attempts").insert({
    organization_id: organizationId,
    recipient_user_id: userId,
    recipient_email: recipient.email,
    recipient_role: recipient.role,
    locale: recipient.locale,
    delivery_kind: kind,
    state: "pending",
  }).select("id").single();
  if (attemptError || !attempt?.id) return { delivered: false, reason: "delivery_audit_unavailable" };
  const configuration = emailConfig();
  if (isFailure(configuration)) {
    await admin.from("lemtel_onboarding_delivery_attempts").update({ state: "failed", attempted_at: new Date().toISOString(), failed_at: new Date().toISOString(), failure_code: configuration.error }).eq("id", attempt.id);
    await audit(admin, organizationId, actor, "welcome_failed", userId, { reason: configuration.error, delivery_kind: kind });
    return { delivered: false, reason: configuration.error };
  }
  const message = welcomeMessage({ ...recipient, temporaryPassword, downloadUrls: configuration.urls });
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${configuration.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: configuration.from, to: [recipient.email], subject: message.subject, html: message.html }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`provider_${response.status}`);
    await admin.from("lemtel_onboarding_delivery_attempts").update({ state: "sent", attempted_at: new Date().toISOString(), sent_at: new Date().toISOString(), provider_message_id: typeof payload?.id === "string" ? payload.id : null }).eq("id", attempt.id);
    await audit(admin, organizationId, actor, kind === "welcome" ? "welcome_sent" : "welcome_resent", userId, { locale: recipient.locale, delivery_kind: kind });
    return { delivered: true };
  } catch {
    await admin.from("lemtel_onboarding_delivery_attempts").update({ state: "failed", attempted_at: new Date().toISOString(), failed_at: new Date().toISOString(), failure_code: "provider_delivery_failed" }).eq("id", attempt.id);
    await audit(admin, organizationId, actor, "welcome_failed", userId, { reason: "provider_delivery_failed", delivery_kind: kind });
    return { delivered: false, reason: "provider_delivery_failed" };
  }
}

async function provisionMany(admin: any, organizationId: string, actor: string, recipients: UserInput[]) {
  const results: Array<{ email: string; userId?: string; delivered: boolean; error?: string }> = [];
  for (const recipient of recipients) {
    const created = await createRecipient(admin, organizationId, recipient);
    if (isFailure(created)) { results.push({ email: recipient.email, delivered: false, error: created.error }); continue; }
    await audit(admin, organizationId, actor, "user_provisioned", created.userId, { role: recipient.role, locale: recipient.locale });
    const delivery = await deliverWelcome(admin, organizationId, actor, created.userId, recipient, created.temporaryPassword, "welcome");
    results.push({ email: recipient.email, userId: created.userId, delivered: delivery.delivered, ...(delivery.delivered ? {} : { error: delivery.reason }) });
  }
  return results;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  let raw: unknown;
  try { raw = await req.json(); } catch { return respond({ error: "invalid_json" }, 400); }
  const request = validateBody(raw);
  if (isFailure(request)) return respond({ error: request.error }, request.status);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return respond({ error: "server_not_configured" }, 503);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const actor = await actorId(admin, req);
  if (isFailure(actor)) return respond({ error: actor.error }, actor.status);

  if (request.action === "create_organization") {
    if (!(await platformAdmin(admin, actor))) return respond({ error: "forbidden" }, 403);
    const { data: organization, error: orgError } = await admin.from("lemtel_organizations").insert({ slug: request.organization.slug, display_name: request.organization.displayName, default_locale: request.organization.defaultLocale, status: "active" }).select("id,slug,display_name,default_locale").single();
    if (orgError || !organization?.id) return respond({ error: "organization_create_failed" }, 409);
    const ownerResults = await provisionMany(admin, organization.id, actor, [request.owner]);
    if (!ownerResults[0]?.userId) {
      await admin.from("lemtel_organizations").delete().eq("id", organization.id);
      return respond({ error: "owner_provision_failed" }, 409);
    }
    await audit(admin, organization.id, actor, "organization_created", ownerResults[0].userId, { default_locale: request.organization.defaultLocale });
    const userResults = await provisionMany(admin, organization.id, actor, request.users);
    return respond({ ok: true, organization, owner: ownerResults[0], users: userResults, email_delivery_required: true }, 201);
  }

  if (request.action === "provision_users") {
    if (!(await organizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
    const results = await provisionMany(admin, request.organizationId, actor, request.users);
    return respond({ ok: true, users: results, email_delivery_required: true }, 201);
  }

  if (!(await organizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
  const { data: membership } = await admin.from("lemtel_organization_memberships").select("role").eq("organization_id", request.organizationId).eq("user_id", request.recipientUserId).eq("status", "active").maybeSingle();
  const { data: userResult } = await admin.auth.admin.getUserById(request.recipientUserId);
  const authUser = userResult?.user;
  const email = authUser?.email?.trim().toLowerCase() ?? "";
  if (!membership?.role || !email) return respond({ error: "recipient_not_found" }, 404);
  const temporaryPassword = randomPassword();
  const { error: updateError } = await admin.auth.admin.updateUserById(request.recipientUserId, { password: temporaryPassword, app_metadata: { ...(authUser?.app_metadata ?? {}), lemtel_onboarding_required: true, lemtel_email_only_signin: true } });
  if (updateError) return respond({ error: "temporary_password_reset_failed" }, 503);
  const recipient: UserInput = { email, displayName: String(authUser?.user_metadata?.full_name || email), role: membership.role as Role, locale: request.locale };
  const delivery = await deliverWelcome(admin, request.organizationId, actor, request.recipientUserId, recipient, temporaryPassword, "welcome_resend");
  return respond({ ok: true, delivered: delivery.delivered, ...(delivery.delivered ? {} : { error: delivery.reason }), email_delivery_required: true });
}

Deno.serve(handler);
