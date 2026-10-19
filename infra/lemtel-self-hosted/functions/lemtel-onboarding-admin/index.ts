// Lemtel email-only onboarding — source package only.
// Deployment and email delivery require explicit approval, a fresh backup, and configured secrets.
// This function never calls FusionPBX and never persists or logs a temporary password.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { telephonyReadinessCatalog } from "./lemtelTelephonyReadiness.ts";
import { emailConfig as configuredEmail, safeHttpsUrl, sendWithResend, transactionalEmailMessage, type TransactionalEmailConfig } from "../_shared/lemtelTransactionalEmail.ts";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,62}$/;
const ROLES = ["owner", "admin", "member"] as const;
type Role = typeof ROLES[number];
type AssignableRole = Exclude<Role, "owner">;
type Locale = "fr" | "en";
type Failure = { error: string; status: number };
type UserInput = { email: string; displayName: string; role: Role; locale: Locale };
type OrganizationInput = { displayName: string; slug: string; defaultLocale: Locale };
type DomainInput = { hostname: string };
type ExistingUserInput = { email: string; role: AssignableRole };
type OrganizationUpdateInput = { displayName: string; defaultLocale: Locale };
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
type TelephonyPreparationState = "not_started" | "review_ready";
const TELEPHONY_CAPABILITY_KEYS = new Set(telephonyReadinessCatalog().map((capability) => capability.key));
type RequestBody =
  | { action: "create_organization"; organization: OrganizationInput; owner: UserInput; users: UserInput[] }
  | { action: "provision_users"; organizationId: string; users: UserInput[] }
  | { action: "resend_welcome"; organizationId: string; recipientUserId: string; locale: Locale }
  | { action: "revoke_invitation"; organizationId: string; recipientUserId: string }
  | { action: "list_organizations" }
  | { action: "list_platform_administrators" }
  | { action: "grant_platform_administrator"; email: string; confirmation: "GRANT_PLATFORM_ADMIN" }
  | { action: "revoke_platform_administrator"; recipientUserId: string; confirmation: "REVOKE_PLATFORM_ADMIN" }
  | { action: "get_config" }
  | { action: "get_operational_status" }
  | { action: "get_operational_trend" }
  | { action: "get_traffic_trend" }
  | { action: "get_node_status" }
  | { action: "get_do_writer_resources" }
  | { action: "get_hostinger_standby_resources" }
  | { action: "get_platform_overview" }
  | { action: "list_people"; organizationId: string }
  | { action: "list_invitations"; organizationId: string }
  | { action: "list_activity"; organizationId: string }
  | { action: "list_domains"; organizationId: string }
  | { action: "list_client_connections"; organizationId: string }
  | { action: "get_telephony_readiness"; organizationId: string }
  | { action: "list_telephony_preparation_states"; organizationId: string }
  | { action: "set_telephony_preparation_state"; organizationId: string; capabilityKey: string; state: TelephonyPreparationState }
  | { action: "create_domain"; organizationId: string; domain: DomainInput }
  | { action: "suspend_domain"; organizationId: string; domainId: string }
  | { action: "assign_existing_user"; organizationId: string; user: ExistingUserInput }
  | { action: "set_membership_role"; organizationId: string; recipientUserId: string; role: AssignableRole }
  | { action: "transfer_organization_ownership"; organizationId: string; recipientUserId: string }
  | { action: "reactivate_domain"; organizationId: string; domainId: string }
  | { action: "set_client_session_access"; organizationId: string; recipientUserId: string; clientKind: "mobile" | "desktop" | "client"; accessState: "active" | "revoked" }
  | { action: "update_organization"; organizationId: string; organization: OrganizationUpdateInput }
  | { action: "archive_organization"; organizationId: string; confirmation: "ARCHIVE" };

const fail = (error: string, status: number): Failure => ({ error, status });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const isFailure = (value: unknown): value is Failure => typeof value === "object" && value !== null && "error" in value && "status" in value;
const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).length === expected.length && expected.every((key) => key in value);
}

function organizationId(value: unknown): string | Failure {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : fail("invalid_organization_id", 400);
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
  if (raw.action === "list_organizations" || raw.action === "list_platform_administrators" || raw.action === "get_config" || raw.action === "get_operational_status" || raw.action === "get_operational_trend" || raw.action === "get_traffic_trend" || raw.action === "get_node_status" || raw.action === "get_do_writer_resources" || raw.action === "get_hostinger_standby_resources" || raw.action === "get_platform_overview") {
    return exactKeys(raw, ["action"]) ? raw as RequestBody : fail("invalid_body", 400);
  }
  if (raw.action === "list_people" || raw.action === "list_invitations" || raw.action === "list_activity" || raw.action === "list_domains" || raw.action === "list_client_connections" || raw.action === "get_telephony_readiness" || raw.action === "list_telephony_preparation_states") {
    if (!exactKeys(raw, ["action", "organizationId"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    return isFailure(parsedOrganizationId) ? parsedOrganizationId : { action: raw.action, organizationId: parsedOrganizationId } as RequestBody;
  }
  if (raw.action === "grant_platform_administrator") {
    if (!exactKeys(raw, ["action", "email", "confirmation"])) return fail("invalid_body", 400);
    const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email) || email.length > 254) return fail("invalid_email", 400);
    if (raw.confirmation !== "GRANT_PLATFORM_ADMIN") return fail("platform_admin_confirmation_required", 400);
    return { action: "grant_platform_administrator", email, confirmation: "GRANT_PLATFORM_ADMIN" };
  }
  if (raw.action === "revoke_platform_administrator") {
    if (!exactKeys(raw, ["action", "recipientUserId", "confirmation"])) return fail("invalid_body", 400);
    const recipientUserId = organizationId(raw.recipientUserId);
    if (isFailure(recipientUserId)) return fail("invalid_recipient_user_id", 400);
    if (raw.confirmation !== "REVOKE_PLATFORM_ADMIN") return fail("platform_admin_confirmation_required", 400);
    return { action: "revoke_platform_administrator", recipientUserId, confirmation: "REVOKE_PLATFORM_ADMIN" };
  }
  if (raw.action === "set_telephony_preparation_state") {
    if (!exactKeys(raw, ["action", "organizationId", "capabilityKey", "state"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    const capabilityKey = typeof raw.capabilityKey === "string" ? raw.capabilityKey : "";
    const state = raw.state;
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (!TELEPHONY_CAPABILITY_KEYS.has(capabilityKey)) return fail("invalid_telephony_capability", 400);
    if (state !== "not_started" && state !== "review_ready") return fail("invalid_telephony_preparation_state", 400);
    return { action: "set_telephony_preparation_state", organizationId: parsedOrganizationId, capabilityKey, state };
  }
  if (raw.action === "create_domain") {
    if (!exactKeys(raw, ["action", "organizationId", "domain"]) || !plainObject(raw.domain)) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    const hostname = typeof raw.domain.hostname === "string" ? raw.domain.hostname.trim().toLowerCase().replace(/\.$/, "") : "";
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (!exactKeys(raw.domain, ["hostname"]) || !HOSTNAME_RE.test(hostname)) return fail("invalid_domain", 400);
    return { action: "create_domain", organizationId: parsedOrganizationId, domain: { hostname } };
  }
  if (raw.action === "suspend_domain") {
    if (!exactKeys(raw, ["action", "organizationId", "domainId"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    const parsedDomainId = organizationId(raw.domainId);
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (isFailure(parsedDomainId)) return parsedDomainId;
    return { action: "suspend_domain", organizationId: parsedOrganizationId, domainId: parsedDomainId };
  }
  if (raw.action === "assign_existing_user") {
    if (!exactKeys(raw, ["action", "organizationId", "user"]) || !plainObject(raw.user) || !exactKeys(raw.user, ["email", "role"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    const email = typeof raw.user.email === "string" ? raw.user.email.trim().toLowerCase() : "";
    const role = raw.user.role;
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (!EMAIL_RE.test(email) || email.length > 254 || (role !== "admin" && role !== "member")) return fail("invalid_user", 400);
    return { action: "assign_existing_user", organizationId: parsedOrganizationId, user: { email, role } };
  }
  if (raw.action === "transfer_organization_ownership") {
    if (!exactKeys(raw, ["action", "organizationId", "recipientUserId"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    const parsedRecipientUserId = organizationId(raw.recipientUserId);
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (isFailure(parsedRecipientUserId)) return parsedRecipientUserId;
    if (parsedOrganizationId === parsedRecipientUserId) return fail("invalid_owner_transfer", 400);
    return { action: "transfer_organization_ownership", organizationId: parsedOrganizationId, recipientUserId: parsedRecipientUserId };
  }
  if (raw.action === "reactivate_domain") {
    if (!exactKeys(raw, ["action", "organizationId", "domainId"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    const parsedDomainId = organizationId(raw.domainId);
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (isFailure(parsedDomainId)) return parsedDomainId;
    return { action: "reactivate_domain", organizationId: parsedOrganizationId, domainId: parsedDomainId };
  }
  if (raw.action === "set_client_session_access") {
    if (!exactKeys(raw, ["action", "organizationId", "recipientUserId", "clientKind", "accessState"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    const parsedRecipientUserId = organizationId(raw.recipientUserId);
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (isFailure(parsedRecipientUserId)) return parsedRecipientUserId;
    if (raw.clientKind !== "mobile" && raw.clientKind !== "desktop" && raw.clientKind !== "client") return fail("invalid_client_kind", 400);
    if (raw.accessState !== "active" && raw.accessState !== "revoked") return fail("invalid_access_state", 400);
    return { action: "set_client_session_access", organizationId: parsedOrganizationId, recipientUserId: parsedRecipientUserId, clientKind: raw.clientKind, accessState: raw.accessState };
  }
  if (raw.action === "set_membership_role") {
    if (!exactKeys(raw, ["action", "organizationId", "recipientUserId", "role"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    const parsedRecipientUserId = organizationId(raw.recipientUserId);
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (isFailure(parsedRecipientUserId)) return parsedRecipientUserId;
    if (raw.role !== "admin" && raw.role !== "member") return fail("invalid_role", 400);
    return { action: "set_membership_role", organizationId: parsedOrganizationId, recipientUserId: parsedRecipientUserId, role: raw.role };
  }
  if (raw.action === "update_organization") {
    if (!exactKeys(raw, ["action", "organizationId", "organization"]) || !plainObject(raw.organization)) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    const displayName = typeof raw.organization.displayName === "string" ? raw.organization.displayName.trim() : "";
    const defaultLocale = locale(raw.organization.defaultLocale);
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (!exactKeys(raw.organization, ["displayName", "defaultLocale"]) || !displayName || displayName.length > 160) return fail("invalid_organization", 400);
    if (isFailure(defaultLocale)) return defaultLocale;
    return { action: "update_organization", organizationId: parsedOrganizationId, organization: { displayName, defaultLocale } };
  }
  if (raw.action === "archive_organization") {
    if (!exactKeys(raw, ["action", "organizationId", "confirmation"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (raw.confirmation !== "ARCHIVE") return fail("archive_confirmation_required", 400);
    return { action: "archive_organization", organizationId: parsedOrganizationId, confirmation: "ARCHIVE" };
  }
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
    if (!exactKeys(raw, ["action", "organizationId", "users"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    const users = userList(raw.users, false);
    if (isFailure(users) || users.length === 0) return isFailure(users) ? users : fail("users_required", 400);
    return { action: "provision_users", organizationId: parsedOrganizationId, users };
  }
  if (raw.action === "resend_welcome") {
    if (!exactKeys(raw, ["action", "organizationId", "recipientUserId", "locale"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    const parsedRecipientUserId = organizationId(raw.recipientUserId);
    const selectedLocale = locale(raw.locale);
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (isFailure(parsedRecipientUserId)) return parsedRecipientUserId;
    if (isFailure(selectedLocale)) return selectedLocale;
    return { action: "resend_welcome", organizationId: parsedOrganizationId, recipientUserId: parsedRecipientUserId, locale: selectedLocale };
  }
  if (raw.action === "revoke_invitation") {
    if (!exactKeys(raw, ["action", "organizationId", "recipientUserId"])) return fail("invalid_body", 400);
    const parsedOrganizationId = organizationId(raw.organizationId);
    const parsedRecipientUserId = organizationId(raw.recipientUserId);
    if (isFailure(parsedOrganizationId)) return parsedOrganizationId;
    if (isFailure(parsedRecipientUserId)) return parsedRecipientUserId;
    return { action: "revoke_invitation", organizationId: parsedOrganizationId, recipientUserId: parsedRecipientUserId };
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

function distributionUrls() {
  const value = (name: string, fallback: string) => safeHttpsUrl(Deno.env.get(name)?.trim() || fallback);
  return {
    desktop: value("LEMTEL_DOWNLOAD_DESKTOP_URL", "https://github.com/AssistantVirtualAI/attach-app-creator-8134a2fa/releases/tag/v2.5.20"),
    windows: value("LEMTEL_DOWNLOAD_WINDOWS_URL", "https://github.com/AssistantVirtualAI/attach-app-creator-8134a2fa/releases/download/v2.5.20/Lemtel-Telecom-Setup-2.5.20.exe"),
    macosApple: value("LEMTEL_DOWNLOAD_MACOS_APPLE_URL", "https://github.com/AssistantVirtualAI/attach-app-creator-8134a2fa/releases/download/v2.5.20/Lemtel-Telecom-2.5.20-arm64.dmg"),
    macosIntel: value("LEMTEL_DOWNLOAD_MACOS_INTEL_URL", "https://github.com/AssistantVirtualAI/attach-app-creator-8134a2fa/releases/download/v2.5.20/Lemtel-Telecom-2.5.20-x64.dmg"),
    ios: value("LEMTEL_DOWNLOAD_IOS_URL", "https://testflight.apple.com"),
    // The GitHub releases carry no Android package: the store listing is the only working default.
    android: value("LEMTEL_DOWNLOAD_ANDROID_URL", "https://play.google.com/store/apps/details?id=com.lemtel.softphone"),
  };
}

/** All sender, logo and download URLs are checked before an Auth password can be changed. */
function transactionalEmailConfig(): TransactionalEmailConfig | Failure {
  const configuration = configuredEmail(Deno.env);
  return configuration ?? fail("email_delivery_unavailable", 503);
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

async function organizationOwner(admin: any, userId: string, organizationId: string): Promise<boolean> {
  const { data } = await admin.from("lemtel_organization_memberships").select("user_id").eq("organization_id", organizationId).eq("user_id", userId).eq("status", "active").eq("role", "owner").maybeSingle();
  return Boolean(data?.user_id);
}

async function audit(admin: any, organizationId: string, actor: string, action: string, subjectUserId: string | null, metadata: Record<string, unknown>) {
  await admin.from("lemtel_onboarding_audit").insert({ organization_id: organizationId, actor_id: actor, subject_user_id: subjectUserId, action, metadata });
}

/** Refreshes the server-owned account revision after a password/access change. */
async function bumpAccountAuthorityRevision(admin: any, organizationId: string) {
  await admin.rpc("lemtel_bump_account_authority_revision", { p_organization_id: organizationId });
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

async function deliverWelcome(admin: any, organizationId: string, actor: string, userId: string, recipient: UserInput, temporaryPassword: string, kind: "welcome" | "welcome_resend", configuration: TransactionalEmailConfig) {
  const { data: attempt, error: attemptError } = await admin.from("lemtel_onboarding_delivery_attempts").insert({
    organization_id: organizationId,
    recipient_user_id: userId,
    recipient_email: recipient.email,
    recipient_role: recipient.role,
    locale: recipient.locale,
    delivery_kind: kind,
    state: "pending",
  }).select("id").single();
  if (attemptError || !attempt?.id) {
    await audit(admin, organizationId, actor, "welcome_delivery_failed", userId, { delivery_kind: kind, reason: "delivery_recording_unavailable" });
    return { deliveryStatus: "needs_attention" as const };
  }
  // This returns provider API acceptance only. It is never represented as inbox delivery.
  const message = transactionalEmailMessage({ kind: "welcome", ...recipient, temporaryPassword, config: configuration });
  const provider = await sendWithResend(configuration, recipient.email, message);
  const timestamp = new Date().toISOString();
  if (provider.accepted) {
    await admin.from("lemtel_onboarding_delivery_attempts").update({
      state: "provider_accepted", attempted_at: timestamp, provider_accepted_at: timestamp,
      provider_message_id: provider.providerMessageId ?? null,
    }).eq("id", attempt.id);
    await audit(admin, organizationId, actor, "welcome_provider_accepted", userId, { locale: recipient.locale, delivery_kind: kind });
    return { deliveryStatus: "provider_accepted" as const };
  }
  await admin.from("lemtel_onboarding_delivery_attempts").update({ state: "failed", attempted_at: timestamp, failed_at: timestamp, failure_code: "provider_request_failed" }).eq("id", attempt.id);
  await audit(admin, organizationId, actor, "welcome_delivery_failed", userId, { delivery_kind: kind, reason: "provider_request_failed" });
  return { deliveryStatus: "failed" as const };
}

type ProvisionResult = { email: string; userId?: string; deliveryStatus: "provider_accepted" | "failed" | "needs_attention"; error?: string };
export async function provisionMany(admin: any, organizationId: string, actor: string, recipients: UserInput[], configurationProvider: () => TransactionalEmailConfig | Failure = transactionalEmailConfig): Promise<ProvisionResult[]> {
  // Fail before creating any account when sender/logo/link configuration is invalid.
  const configuration = configurationProvider();
  if (isFailure(configuration)) return recipients.map((recipient): ProvisionResult => ({ email: recipient.email, deliveryStatus: "needs_attention", error: "email_delivery_unavailable" }));
  const results: ProvisionResult[] = [];
  for (const recipient of recipients) {
    const created = await createRecipient(admin, organizationId, recipient);
    if (isFailure(created)) { results.push({ email: recipient.email, deliveryStatus: "needs_attention", error: created.error }); continue; }
    await audit(admin, organizationId, actor, "user_provisioned", created.userId, { role: recipient.role, locale: recipient.locale });
    const delivery = await deliverWelcome(admin, organizationId, actor, created.userId, recipient, created.temporaryPassword, "welcome", configuration);
    results.push({ email: recipient.email, userId: created.userId, deliveryStatus: delivery.deliveryStatus, ...(delivery.deliveryStatus === "provider_accepted" ? {} : { error: "email_delivery_unavailable" }) });
  }
  return results;
}

async function platformAudit(admin: any, actor: string, subjectUserId: string, action: "platform_administrator_granted" | "platform_administrator_revoked") {
  const { error } = await admin.from("lemtel_platform_administrator_audit").insert({ actor_id: actor, subject_user_id: subjectUserId, action, metadata: {} });
  return !error;
}
async function listPlatformAdministrators(admin: any) {
  const { data, error } = await admin.from("lemtel_platform_administrators").select("user_id,status,created_at").order("created_at", { ascending: true });
  if (error) return fail("platform_administrator_list_failed", 503);
  const users = await usersById(admin, (data ?? []).map((entry: any) => entry.user_id));
  return { administrators: (data ?? []).map((entry: any) => {
    const user = users.get(entry.user_id);
    return { userId: entry.user_id, fullName: userName(user), email: String(user?.email ?? "").trim().toLowerCase(), status: entry.status === "active" ? "active" : "revoked", grantedAt: entry.created_at };
  }).filter((entry: any) => entry.email) };
}
async function grantPlatformAdministrator(admin: any, actor: string, email: string) {
  const user = await userByEmail(admin, email);
  if (!user?.id) return fail("platform_administrator_recipient_not_found", 404);
  const { data: previous, error: previousError } = await admin.from("lemtel_platform_administrators").select("status,revoked_at").eq("user_id", user.id).maybeSingle();
  if (previousError) return fail("platform_administrator_lookup_failed", 503);
  const { error } = await admin.from("lemtel_platform_administrators").upsert({ user_id: user.id, status: "active", revoked_at: null }, { onConflict: "user_id" });
  if (error) return fail("platform_administrator_grant_failed", 503);
  if (!(await platformAudit(admin, actor, user.id, "platform_administrator_granted"))) {
    if (previous) await admin.from("lemtel_platform_administrators").update({ status: previous.status, revoked_at: previous.revoked_at }).eq("user_id", user.id);
    else await admin.from("lemtel_platform_administrators").delete().eq("user_id", user.id);
    return fail("platform_administrator_audit_failed", 503);
  }
  return { status: "active" as const, userId: user.id };
}
async function revokePlatformAdministrator(admin: any, actor: string, recipientUserId: string) {
  if (actor === recipientUserId) return fail("platform_administrator_self_revoke_forbidden", 400);
  const { count, error: countError } = await admin.from("lemtel_platform_administrators").select("user_id", { count: "exact", head: true }).eq("status", "active");
  if (countError) return fail("platform_administrator_count_failed", 503);
  if ((count ?? 0) <= 1) return fail("last_platform_administrator_required", 400);
  const { data, error } = await admin.from("lemtel_platform_administrators").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("user_id", recipientUserId).eq("status", "active").select("user_id").maybeSingle();
  if (error) return fail("platform_administrator_revoke_failed", 503);
  if (!data?.user_id) return fail("platform_administrator_not_found", 404);
  if (!(await platformAudit(admin, actor, recipientUserId, "platform_administrator_revoked"))) {
    await admin.from("lemtel_platform_administrators").update({ status: "active", revoked_at: null }).eq("user_id", recipientUserId);
    return fail("platform_administrator_audit_failed", 503);
  }
  return { status: "revoked" as const };
}
async function portalAccess(admin: any, userId: string): Promise<boolean> {
  if (await platformAdmin(admin, userId)) return true;
  const { data } = await admin.from("lemtel_organization_memberships").select("user_id").eq("user_id", userId).eq("status", "active").limit(1);
  return Boolean(data?.length);
}

async function portalOrganizationAdmin(admin: any, userId: string, organizationId: string): Promise<boolean> {
  return (await platformAdmin(admin, userId)) || (await organizationAdmin(admin, userId, organizationId));
}

async function activeOrganization(admin: any, organizationId: string): Promise<boolean> {
  const { data } = await admin.from("lemtel_organizations").select("id").eq("id", organizationId).eq("status", "active").maybeSingle();
  return Boolean(data?.id);
}


async function userByEmail(admin: any, email: string): Promise<any | null> {
  const canonicalEmail = email.trim().toLowerCase();
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const user = (data?.users ?? []).find((candidate: any) => String(candidate?.email ?? "").trim().toLowerCase() === canonicalEmail);
    if (user) return user;
    if ((data?.users ?? []).length < 1000) break;
  }
  return null;
}

async function usersById(admin: any, ids: string[]): Promise<Map<string, any>> {
  const needed = new Set(ids);
  const users = new Map<string, any>();
  for (let page = 1; page <= 100 && needed.size; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    const batch = data?.users ?? [];
    for (const user of batch) {
      if (needed.has(user.id)) {
        users.set(user.id, user);
        needed.delete(user.id);
      }
    }
    if (batch.length < 1000) break;
  }
  return users;
}

function userName(user: any): string {
  const fullName = String(user?.user_metadata?.full_name ?? "").trim();
  return fullName || String(user?.email ?? "").split("@")[0] || "Lemtel user";
}

function userLocale(user: any): Locale {
  return user?.user_metadata?.locale === "en" ? "en" : "fr";
}

async function assignExistingUser(admin: any, organizationId: string, actor: string, input: ExistingUserInput) {
  const existingUser = await userByEmail(admin, input.email);
  if (!existingUser?.id) return fail("existing_user_not_found", 404);
  const { data: membership, error: lookupError } = await admin.from("lemtel_organization_memberships")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", existingUser.id)
    .maybeSingle();
  if (lookupError) return fail("membership_lookup_failed", 503);
  if (!membership) {
    const { error } = await admin.from("lemtel_organization_memberships")
      .insert({ organization_id: organizationId, user_id: existingUser.id, role: input.role, status: "active" });
    if (error) return fail("membership_assign_failed", 409);
    await audit(admin, organizationId, actor, "membership_assigned", existingUser.id, { role: input.role });
    return { status: "assigned" as const };
  }
  if (membership.role === "owner") return fail("owner_membership_protected", 400);
  if (membership.status !== "active") {
    const { error } = await admin.from("lemtel_organization_memberships")
      .update({ role: input.role, status: "active", suspended_at: null })
      .eq("organization_id", organizationId)
      .eq("user_id", existingUser.id);
    if (error) return fail("membership_reactivate_failed", 503);
    await audit(admin, organizationId, actor, "membership_reactivated", existingUser.id, { role: input.role });
    return { status: "reactivated" as const };
  }
  if (membership.role !== input.role) {
    const { error } = await admin.from("lemtel_organization_memberships")
      .update({ role: input.role })
      .eq("organization_id", organizationId)
      .eq("user_id", existingUser.id);
    if (error) return fail("membership_role_change_failed", 503);
    await audit(admin, organizationId, actor, "membership_role_changed", existingUser.id, { role: input.role });
  }
  return { status: "unchanged" as const };
}

async function transferOrganizationOwnership(admin: any, organizationId: string, actor: string, recipientUserId: string) {
  const { data, error } = await admin.rpc("lemtel_transfer_organization_ownership", { p_organization_id: organizationId, p_actor_id: actor, p_recipient_user_id: recipientUserId });
  if (error || data !== "transferred") return fail(error?.code === "42501" ? "organization_owner_required" : "ownership_transfer_failed", error?.code === "42501" ? 403 : 503);
  return { status: "transferred" as const };
}

async function setMembershipRole(admin: any, organizationId: string, actor: string, recipientUserId: string, role: AssignableRole) {
  const { data: membership, error: lookupError } = await admin.from("lemtel_organization_memberships")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", recipientUserId)
    .maybeSingle();
  if (lookupError) return fail("membership_lookup_failed", 503);
  if (!membership) return fail("recipient_not_found", 404);
  if (membership.role === "owner") return fail("owner_membership_protected", 400);
  if (membership.role === role) return { status: "unchanged" as const };
  const { error } = await admin.from("lemtel_organization_memberships")
    .update({ role })
    .eq("organization_id", organizationId)
    .eq("user_id", recipientUserId);
  if (error) return fail("membership_role_change_failed", 503);
  await audit(admin, organizationId, actor, "membership_role_changed", recipientUserId, { role, membership_status: membership.status });
  return { status: "updated" as const };
}

async function listOrganizations(admin: any, actor: string) {
  const platform = await platformAdmin(admin, actor);
  const { data: activeMemberships, error: membershipError } = await admin
    .from("lemtel_organization_memberships")
    .select("organization_id,user_id")
    .eq("status", "active");
  if (membershipError) return fail("organization_lookup_failed", 503);
  const rows = activeMemberships ?? [];
  const organizationIds = [...new Set((platform ? rows : rows.filter((row: any) => row.user_id === actor)).map((row: any) => String(row.organization_id)))];
  if (!organizationIds.length) return { organizations: [] };
  const { data: organizations, error } = await admin
    .from("lemtel_organizations")
    .select("id,display_name,slug,default_locale")
    .in("id", organizationIds)
    .eq("status", "active")
    .order("display_name");
  if (error) return fail("organization_lookup_failed", 503);
  const directory = await usersById(admin, rows.filter((row: any) => organizationIds.includes(String(row.organization_id))).map((row: any) => String(row.user_id)));
  return {
    organizations: (organizations ?? []).map((organization: any) => {
      const members = rows.filter((row: any) => row.organization_id === organization.id);
      return {
        id: organization.id,
        displayName: organization.display_name,
        slug: organization.slug,
        defaultLocale: organization.default_locale === "en" ? "en" : "fr",
        memberCount: members.length,
        pendingInvitations: members.filter((row: any) => directory.get(String(row.user_id))?.app_metadata?.lemtel_onboarding_required === true).length,
      };
    }),
  };
}

async function listPeople(admin: any, organizationId: string) {
  const { data: memberships, error } = await admin.from("lemtel_organization_memberships").select("user_id,role,status").eq("organization_id", organizationId).order("created_at");
  if (error) return fail("people_lookup_failed", 503);
  const directory = await usersById(admin, (memberships ?? []).map((row: any) => String(row.user_id)));
  return {
    people: (memberships ?? []).flatMap((membership: any) => {
      const user = directory.get(String(membership.user_id));
      return user?.email ? [{ userId: user.id, fullName: userName(user), email: user.email, role: membership.role, status: membership.status, locale: userLocale(user) }] : [];
    }),
  };
}

async function listInvitations(admin: any, organizationId: string) {
  const { data: memberships, error } = await admin.from("lemtel_organization_memberships").select("user_id,role,status").eq("organization_id", organizationId).order("created_at", { ascending: false });
  if (error) return fail("invitation_lookup_failed", 503);
  const { data: deliveries } = await admin.from("lemtel_onboarding_delivery_attempts").select("recipient_user_id,state,locale,provider_accepted_at,delivered_at,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false });
  const latestDelivery = new Map<string, any>();
  for (const delivery of deliveries ?? []) if (!latestDelivery.has(String(delivery.recipient_user_id))) latestDelivery.set(String(delivery.recipient_user_id), delivery);
  const directory = await usersById(admin, (memberships ?? []).map((row: any) => String(row.user_id)));
  const deliveryState = (value: unknown): "pending" | "provider_accepted" | "delivered" | "failed" | "needs_attention" =>
    value === "pending" || value === "provider_accepted" || value === "delivered" || value === "failed" || value === "needs_attention" ? value : "needs_attention";
  return {
    invitations: (memberships ?? []).flatMap((membership: any) => {
      const user = directory.get(String(membership.user_id));
      if (!user?.email) return [];
      const delivery = latestDelivery.get(String(user.id));
      const onboardingPending = user.app_metadata?.lemtel_onboarding_required === true;
      const status = membership.status !== "active" ? "revoked" : !onboardingPending ? "active" : "onboarding_pending";
      const requestedLocale = delivery?.locale === "en" ? "en" : delivery?.locale === "fr" ? "fr" : userLocale(user);
      return [{ userId: user.id, fullName: userName(user), email: user.email, role: membership.role, locale: userLocale(user), requestedLocale, status, ...(onboardingPending ? { deliveryStatus: deliveryState(delivery?.state) } : {}), ...(delivery?.provider_accepted_at ? { providerAcceptedAt: delivery.provider_accepted_at } : {}), ...(delivery?.delivered_at ? { deliveredAt: delivery.delivered_at } : {}) }];
    }),
  };
}

async function listActivity(admin: any, organizationId: string) {
  const { data, error } = await admin.from("lemtel_onboarding_audit").select("id,created_at,action").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100);
  return error ? fail("activity_lookup_failed", 503) : { events: (data ?? []).map((row: any) => ({ id: row.id, at: row.created_at, action: row.action })) };
}

async function listDomains(admin: any, organizationId: string) {
  const { data, error } = await admin.from("lemtel_organization_domains")
    .select("id,hostname,status,verification_status,created_at")
    .eq("organization_id", organizationId)
    .order("hostname");
  return error ? fail("domain_lookup_failed", 503) : { domains: (data ?? []).map((row: any) => ({
    id: row.id, hostname: row.hostname, status: row.status === "suspended" ? "suspended" : "active",
    verificationStatus: row.verification_status === "verified" ? "verified" : "unverified", createdAt: row.created_at,
  })) };
}

async function listClientConnections(admin: any, organizationId: string) {
  const { data, error } = await admin.from("lemtel_client_connection_presence")
    .select("user_id,client_kind,last_seen_at,authority_revision")
    .eq("organization_id", organizationId)
    .order("last_seen_at", { ascending: false })
    .limit(500);
  if (error) return fail("client_connection_lookup_failed", 503);
  const { data: controls, error: controlsError } = await admin.from("lemtel_client_session_controls")
    .select("user_id,client_kind,access_state")
    .eq("organization_id", organizationId)
    .limit(500);
  if (controlsError) return fail("client_connection_lookup_failed", 503);
  const controlledKinds = new Set(["mobile", "desktop", "client"]);
  const controlsByKey = new Map((controls ?? []).map((row: any) => [`${row.user_id}:${row.client_kind}`, row.access_state === "revoked" ? "revoked" : "active"]));
  const combined = new Map<string, any>();
  for (const row of data ?? []) combined.set(`${row.user_id}:${row.client_kind}`, row);
  for (const control of controls ?? []) {
    const key = `${control.user_id}:${control.client_kind}`;
    if (!combined.has(key)) combined.set(key, { user_id: control.user_id, client_kind: control.client_kind, authority_revision: 0 });
  }
  const directory = await usersById(admin, [...combined.values()].map((row: any) => String(row.user_id)));
  return {
    connections: [...combined.values()].flatMap((row: any) => {
      const user = directory.get(String(row.user_id));
      if (!user?.email) return [];
      const clientKind = row.client_kind === "mobile" || row.client_kind === "desktop" || row.client_kind === "portal" ? row.client_kind : "client";
      return [{
        userId: user.id,
        fullName: userName(user),
        email: user.email,
        clientKind,
        ...(typeof row.last_seen_at === "string" ? { lastSeenAt: row.last_seen_at } : {}),
        authorityRevision: Number.isSafeInteger(Number(row.authority_revision)) ? Number(row.authority_revision) : 0,
        accessState: controlledKinds.has(clientKind) && controlsByKey.get(`${row.user_id}:${clientKind}`) === "revoked" ? "revoked" : "active",
      }];
    }),
  };
}

type TelephonyPreparation = { capabilityKey: string; state: TelephonyPreparationState; revision: number; updatedAt: string };

async function listTelephonyPreparationStates(admin: any, organizationId: string) {
  const { data, error } = await admin.from("lemtel_telephony_preparation_states")
    .select("capability_key,state,revision,updated_at")
    .eq("organization_id", organizationId)
    .order("capability_key");
  if (error) return fail("telephony_preparation_lookup_failed", 503);
  return { preparations: (data ?? []).flatMap((row: any): TelephonyPreparation[] => {
    const capabilityKey = typeof row.capability_key === "string" ? row.capability_key : "";
    const state = row.state === "review_ready" ? "review_ready" as const : null;
    const revision = Number(row.revision);
    const updatedAt = typeof row.updated_at === "string" ? row.updated_at : "";
    return TELEPHONY_CAPABILITY_KEYS.has(capabilityKey) && state && Number.isSafeInteger(revision) && revision > 0 && updatedAt
      ? [{ capabilityKey, state, revision, updatedAt }]
      : [];
  }) };
}

async function setTelephonyPreparationState(admin: any, organizationId: string, actor: string, capabilityKey: string, state: TelephonyPreparationState) {
  const { data, error } = await admin.rpc("lemtel_set_telephony_preparation_state", {
    p_organization_id: organizationId,
    p_capability_key: capabilityKey,
    p_state: state,
    p_actor_id: actor,
  });
  const row = Array.isArray(data) ? data[0] : null;
  const returnedState = row?.state === "review_ready" ? "review_ready" : row?.state === "not_started" ? "not_started" : null;
  const revision = Number(row?.revision);
  const updatedAt = typeof row?.updated_at === "string" ? row.updated_at : undefined;
  if (error || !returnedState || !Number.isSafeInteger(revision) || revision < 0) return fail("telephony_preparation_update_failed", 503);
  if ((returnedState === "not_started" && (revision !== 0 || updatedAt !== undefined))
    || (returnedState === "review_ready" && (revision < 1 || !updatedAt))) return fail("telephony_preparation_update_failed", 503);
  return { capabilityKey, state: returnedState, revision, ...(updatedAt ? { updatedAt } : {}) };
}

async function setClientSessionAccess(admin: any, organizationId: string, actor: string, recipientUserId: string, clientKind: "mobile" | "desktop" | "client", accessState: "active" | "revoked") {
  const { data: membership, error: membershipError } = await admin.from("lemtel_organization_memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", recipientUserId)
    .maybeSingle();
  if (membershipError) return fail("membership_lookup_failed", 503);
  if (!membership?.user_id) return fail("recipient_not_found", 404);
  const { error } = await admin.from("lemtel_client_session_controls").upsert({
    organization_id: organizationId,
    user_id: recipientUserId,
    client_kind: clientKind,
    access_state: accessState,
    updated_at: new Date().toISOString(),
    updated_by: actor,
  }, { onConflict: "organization_id,user_id,client_kind" });
  if (error) return fail("client_session_access_update_failed", 503);
  await bumpAccountAuthorityRevision(admin, organizationId);
  await audit(admin, organizationId, actor, accessState === "revoked" ? "client_session_access_revoked" : "client_session_access_reactivated", recipientUserId, { client_kind: clientKind });
  return { status: accessState };
}


function portalConfig() {
  const supportContact = Deno.env.get("LEMTEL_SUPPORT_CONTACT")?.trim() || undefined;
  return { downloads: distributionUrls(), ...(supportContact ? { supportContact } : {}) };
}

type OperationalHealth = "healthy" | "degraded" | "unknown";

function redactedHealth(value: unknown): OperationalHealth {
  return value === "healthy" || value === "degraded" ? value : "unknown";
}

function redactedObject(value: unknown): Record<string, unknown> {
  return plainObject(value) ? value : {};
}

export function emptyOperationalStatus() {
  return {
    telemetry: "not_configured" as const,
    overall: "unknown" as const,
    topology: { writer: "unknown" as const, standby: "unknown" as const, route: "unknown" as const, automaticFailover: false },
    services: { runtime: "unknown" as const, database: "unknown" as const, auth: "unknown" as const, rest: "unknown" as const, storage: "unknown" as const, accountRecovery: "unknown" as const },
    replication: { database: "unknown" as const, storage: "unknown" as const },
  };
}

/**
 * Returns only a schema-checked, redacted snapshot. The browser never receives a
 * hostname, address, credential, raw error, database metric, user data or telephony detail.
 */
/** Converts an untrusted database row into the exact browser-safe status shape. */
export function redactedOperationalStatusFromRow(row: unknown) {
  if (!plainObject(row)) return emptyOperationalStatus();
  const payload = redactedObject(row.payload);
  const topology = redactedObject(payload.topology);
  const services = redactedObject(payload.services);
  const replication = redactedObject(payload.replication);
  return {
    telemetry: "live" as const,
    ...(typeof row.observed_at === "string" ? { observedAt: row.observed_at } : {}),
    overall: redactedHealth(row.overall_status),
    topology: {
      writer: topology.writer === "digitalocean_promoted_writer" ? "digitalocean_promoted_writer" as const : "unknown" as const,
      standby: topology.standby === "hostinger_streaming_standby"
        ? "hostinger_streaming_standby" as const
        : topology.standby === "hostinger_fenced_rebuild_required"
          ? "hostinger_fenced_rebuild_required" as const
          : "unknown" as const,
      route: topology.route === "canonical_digitalocean_live" ? "canonical_digitalocean_live" as const : "unknown" as const,
      // No endpoint attests the full promotion gates; this read must never enable it.
      automaticFailover: false,
    },
    services: { runtime: redactedHealth(services.runtime), database: redactedHealth(services.database), auth: redactedHealth(services.auth), rest: redactedHealth(services.rest), storage: redactedHealth(services.storage), accountRecovery: redactedHealth(services.account_recovery) },
    replication: {
      database: replication.database === "streaming" ? "streaming" as const : replication.database === "rebuild_required" ? "rebuild_required" as const : "unknown" as const,
      storage: replication.storage === "integrity_verified"
        ? "integrity_verified" as const
        : replication.storage === "sync_attention"
          ? "sync_attention" as const
          : replication.storage === "rebuild_required"
            ? "rebuild_required" as const
            : "unknown" as const,
    },
  };
}

async function operationalStatus(admin: any) {
  const { data, error } = await admin
    .from("lemtel_operational_status")
    .select("observed_at,overall_status,payload")
    .eq("singleton", true)
    .maybeSingle();
  if (error) return fail("operational_status_unavailable", 503);
  if (!data) return emptyOperationalStatus();
  return redactedOperationalStatusFromRow(data);
}

async function operationalTrend(admin: any) {
  const { data, error } = await admin
    .from("lemtel_operational_status_history")
    .select("observed_at,overall_status,payload")
    .order("observed_at", { ascending: false })
    .limit(48);
  if (error) return fail("operational_trend_unavailable", 503);
  return {
    samples: (data ?? []).map((row: unknown) => {
      const status = redactedOperationalStatusFromRow(row);
      return {
        observedAt: "observedAt" in status ? status.observedAt : undefined,
        overall: status.overall,
        runtime: status.services.runtime,
        database: status.services.database,
        storage: status.services.storage,
        standby: status.topology.standby,
      };
    }).reverse(),
  };
}

type NodeRole = "do_writer" | "hostinger_standby";
type TrafficSample = { observedAt: string; periodSeconds: number; rxBytes: number; txBytes: number; tcpEstablished: number };
const NODE_ROLES: NodeRole[] = ["do_writer", "hostinger_standby"];
const BUCKET_MS = 300_000;
const TRAFFIC_READ_TIMEOUT_MS = 4_000;
const NODE_STATUS_READ_TIMEOUT_MS = 2_000;
const boundedInteger = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;

/** A new object allowlist: never forward rows, opaque JSON or database errors. */
export function redactedTrafficTrend(rows: unknown[], now = Date.now()) {
  const windowEnd = Math.floor(now / 60_000) * 60_000 + 60_000;
  const windowStart = windowEnd - 86_400_000;
  const roles = NODE_ROLES.map((nodeRole) => {
    const minutes = new Map<number, TrafficSample>();
    for (const raw of rows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      if (row.node_role !== nodeRole || row.collector_state !== "collecting" || typeof row.observed_at !== "string") continue;
      const at = Date.parse(row.observed_at);
      if (!Number.isFinite(at) || at % 60_000 !== 0 || at < windowStart || at >= windowEnd
        || !boundedInteger(row.period_seconds, 300) || row.period_seconds < 30
        || !boundedInteger(row.rx_bytes, 1_000_000_000_000) || !boundedInteger(row.tx_bytes, 1_000_000_000_000)
        || !boundedInteger(row.tcp_established, 1_000_000)) continue;
      if (!minutes.has(at)) minutes.set(at, { observedAt: new Date(at).toISOString(), periodSeconds: row.period_seconds,
        rxBytes: row.rx_bytes, txBytes: row.tx_bytes, tcpEstablished: row.tcp_established });
    }
    const sorted = [...minutes.entries()].sort(([a], [b]) => a - b);
    const buckets = new Map<number, TrafficSample>();
    for (const [at, sample] of sorted) {
      const bucket = Math.floor(at / BUCKET_MS) * BUCKET_MS;
      const previous = buckets.get(bucket);
      buckets.set(bucket, {
        observedAt: new Date(bucket).toISOString(),
        periodSeconds: (previous?.periodSeconds ?? 0) + sample.periodSeconds,
        rxBytes: (previous?.rxBytes ?? 0) + sample.rxBytes,
        txBytes: (previous?.txBytes ?? 0) + sample.txBytes,
        // Gauge: latest measured count, NEVER the sum of connection counts.
        tcpEstablished: sample.tcpEstablished,
      });
    }
    const latest = sorted.at(-1)?.[1];
    return { nodeRole, collectorState: latest && now - Date.parse(latest.observedAt) <= 180_000 ? "collecting" as const : "pending" as const,
      ...(latest ? { latest } : {}), samples: [...buckets.values()] };
  });
  return { windowStart: new Date(windowStart).toISOString(), windowEnd: new Date(windowEnd).toISOString(), bucketSeconds: 300, roles };
}

export async function trafficTrend(admin: Pick<SupabaseClient, "from">, now = Date.now(), timeoutMs = TRAFFIC_READ_TIMEOUT_MS) {
  const empty = redactedTrafficTrend([], now);
  const rows: unknown[] = [];
  // A stalled PostgREST query is unavailable, never an indefinitely pending portal state.
  const deadline = AbortSignal.timeout(timeoutMs);
  // Two roles × 1,440 minute keys. Explicit pages avoid the usual 1,000-row cap.
  for (let offset = 0; offset < 3000; offset += 1000) {
    const { data, error } = await admin.from("lemtel_traffic_samples")
      .select("node_role,observed_at,period_seconds,rx_bytes,tx_bytes,tcp_established,collector_state")
      .gte("observed_at", empty.windowStart).lt("observed_at", empty.windowEnd)
      .order("observed_at", { ascending: true }).order("node_role", { ascending: true })
      .range(offset, offset + 999).abortSignal(deadline);
    if (error) return { error: "traffic_trend_unavailable", status: 503 };
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return redactedTrafficTrend(rows, now);
}

type NodeStatusState = "healthy" | "degraded" | "unknown";
type RuntimeNodeStatusState = "ready" | "degraded" | "unknown";
type ReplicationNodeStatusState = "streaming" | "degraded" | "unknown";
type StorageNodeStatusState = "synced" | "degraded" | "unknown";
const nodeStatusState = (value: unknown): NodeStatusState => value === "healthy" || value === "degraded" ? value : "unknown";
const runtimeNodeStatusState = (value: unknown): RuntimeNodeStatusState => value === "ready" || value === "degraded" ? value : "unknown";
const replicationNodeStatusState = (value: unknown): ReplicationNodeStatusState => value === "streaming" || value === "degraded" ? value : "unknown";
const storageNodeStatusState = (value: unknown): StorageNodeStatusState => value === "synced" || value === "degraded" ? value : "unknown";

/** Converts at most two trusted table rows into the exact browser-safe node projection. */
export function redactedNodeStatus(rows: unknown[], now = Date.now()) {
  const latest = new Map<NodeRole, { at: number; row: Record<string, unknown> }>();
  for (const raw of rows) {
    if (!plainObject(raw) || (raw.node_role !== "do_writer" && raw.node_role !== "hostinger_standby") || typeof raw.observed_at !== "string") continue;
    const at = Date.parse(raw.observed_at);
    if (!Number.isFinite(at) || at % 60_000 !== 0 || at < Date.UTC(2026, 0, 1) || at >= Date.UTC(2100, 0, 1)) continue;
    const role = raw.node_role;
    if (!latest.has(role) || at > latest.get(role)!.at) latest.set(role, { at, row: raw });
  }
  return {
    telemetry: latest.size ? "live" as const : "not_configured" as const,
    roles: NODE_ROLES.map((nodeRole) => {
      const entry = latest.get(nodeRole);
      const stale = !entry || now - entry.at > 180_000 || entry.at > now + 120_000;
      const row = entry?.row;
      return {
        nodeRole,
        ...(entry ? { observedAt: new Date(entry.at).toISOString() } : {}),
        agentState: stale ? "unknown" as const : nodeStatusState(row?.agent_state),
        runtimeState: stale ? "unknown" as const : runtimeNodeStatusState(row?.runtime_state),
        replicationState: stale ? "unknown" as const : replicationNodeStatusState(row?.replication_state),
        storageState: stale ? "unknown" as const : storageNodeStatusState(row?.storage_state),
      };
    }),
  };
}

/** Current table has a primary key on the two fixed roles; query and wait are bounded. */
export async function nodeStatus(admin: Pick<SupabaseClient, "from">, now = Date.now(), timeoutMs = NODE_STATUS_READ_TIMEOUT_MS) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const { data, error } = await admin.from("lemtel_node_status_current")
    .select("node_role,observed_at,agent_state,runtime_state,replication_state,storage_state")
    .order("node_role", { ascending: true }).limit(2).abortSignal(deadline);
  return error ? { error: "node_status_unavailable", status: 503 } : redactedNodeStatus(data ?? [], now);
}

export function redactedDoWriterResources(raw: unknown, now = Date.now()) {
  if (!plainObject(raw) || typeof raw.observed_at !== "string") return { schemaVersion: "lemtel-do-writer-resources/v1" as const, observation: "no_observation" as const };
  const observed = Date.parse(raw.observed_at);
  const validPercent = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100;
  const validLoad = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000;
  if (!Number.isFinite(observed) || observed % 60_000 !== 0 || now - observed > 180_000 || observed > now + 120_000 || !validPercent(raw.cpu_percent) || !validPercent(raw.memory_percent) || !validPercent(raw.disk_percent) || !validLoad(raw.load1_milli) || !validLoad(raw.load5_milli) || !validLoad(raw.load15_milli)) return { schemaVersion: "lemtel-do-writer-resources/v1" as const, observation: "no_observation" as const };
  return { schemaVersion: "lemtel-do-writer-resources/v1" as const, observation: "observed" as const, observedAt: new Date(observed).toISOString(), resources: { cpuPercent: raw.cpu_percent as number, memoryPercent: raw.memory_percent as number, diskPercent: raw.disk_percent as number, load1Milli: raw.load1_milli as number, load5Milli: raw.load5_milli as number, load15Milli: raw.load15_milli as number } };
}

export async function doWriterResources(admin: Pick<SupabaseClient, "from">, now = Date.now(), timeoutMs = NODE_STATUS_READ_TIMEOUT_MS) {
  const { data, error } = await admin.from("lemtel_do_writer_resource_current").select("observed_at,cpu_percent,memory_percent,disk_percent,load1_milli,load5_milli,load15_milli").eq("singleton", true).limit(1).abortSignal(AbortSignal.timeout(timeoutMs));
  return error ? { error: "do_writer_resources_unavailable", status: 503 } : redactedDoWriterResources(data?.[0], now);
}

/** Hostinger standby resources come from a role-bound signed publisher, NOT a secure enrollment; the trust label is explicit. */
export function redactedHostingerStandbyResources(raw: unknown, now = Date.now()) {
  const none = { schemaVersion: "lemtel-hostinger-standby-resources/v1" as const, trust: "signed_publication_not_enrolled" as const, observation: "no_observation" as const };
  if (!plainObject(raw) || typeof raw.observed_at !== "string") return none;
  const observed = Date.parse(raw.observed_at);
  const validPercent = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100;
  const validLoad = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000;
  if (!Number.isFinite(observed) || observed % 60_000 !== 0 || now - observed > 180_000 || observed > now + 120_000 || !validPercent(raw.cpu_percent) || !validPercent(raw.memory_percent) || !validPercent(raw.disk_percent) || !validLoad(raw.load1_milli) || !validLoad(raw.load5_milli) || !validLoad(raw.load15_milli)) return none;
  return { schemaVersion: "lemtel-hostinger-standby-resources/v1" as const, trust: "signed_publication_not_enrolled" as const, observation: "observed" as const, observedAt: new Date(observed).toISOString(), resources: { cpuPercent: raw.cpu_percent as number, memoryPercent: raw.memory_percent as number, diskPercent: raw.disk_percent as number, load1Milli: raw.load1_milli as number, load5Milli: raw.load5_milli as number, load15Milli: raw.load15_milli as number } };
}

export async function hostingerStandbyResources(admin: Pick<SupabaseClient, "from">, now = Date.now(), timeoutMs = NODE_STATUS_READ_TIMEOUT_MS) {
  const { data, error } = await admin.from("lemtel_hostinger_standby_resource_current").select("observed_at,cpu_percent,memory_percent,disk_percent,load1_milli,load5_milli,load15_milli").eq("singleton", true).limit(1).abortSignal(AbortSignal.timeout(timeoutMs));
  return error ? { error: "hostinger_standby_resources_unavailable", status: 503 } : redactedHostingerStandbyResources(data?.[0], now);
}

type PlatformOverviewNodeRole = {
  nodeRole: NodeRole;
  observedAt?: string;
  agentState: NodeStatusState;
  runtimeState: RuntimeNodeStatusState;
  replicationState: ReplicationNodeStatusState;
  storageState: StorageNodeStatusState;
};

/**
 * Node-status migration 0020 is deliberately optional during rollout. Its absence
 * is a no-observation state, never a raw PostgREST error exposed to a browser.
 */
export function noObservationNodeStatus() {
  return {
    schemaVersion: "lemtel-node-status/v1" as const,
    observation: "no_observation" as const,
    roles: NODE_ROLES.map((nodeRole): PlatformOverviewNodeRole => ({
      nodeRole, agentState: "unknown", runtimeState: "unknown", replicationState: "unknown", storageState: "unknown",
    })),
  };
}

function platformNodeStatus(value: ReturnType<typeof redactedNodeStatus>) {
  return {
    schemaVersion: "lemtel-node-status/v1" as const,
    observation: value.telemetry === "live" ? "observed" as const : "no_observation" as const,
    roles: value.roles,
  };
}

async function nodeStatusForPlatformOverview(admin: Pick<SupabaseClient, "from">) {
  const status = await nodeStatus(admin);
  // This handles an unavailable or not-yet-deployed 0020 table identically. No
  // relation name, driver error, network detail or other raw diagnostic leaves Edge.
  return isFailure(status) ? noObservationNodeStatus() : platformNodeStatus(status);
}

function configuredPlatformClientAccess() {
  const configuredValue = (environmentKey: string) => {
    try { return Deno.env.get(environmentKey)?.trim() ?? ""; } catch { return ""; }
  };
  const configured = (client: "desktop" | "ios" | "android", environmentKey: string) => {
    const url = safeHttpsUrl(configuredValue(environmentKey));
    return url ? { client, state: "configured" as const, url } : { client, state: "pending" as const };
  };
  // No release URL is inferred from a fallback: availability requires a server-set,
  // HTTPS distribution source for each client family.
  return [
    configured("desktop", "LEMTEL_DOWNLOAD_DESKTOP_URL"),
    configured("ios", "LEMTEL_DOWNLOAD_IOS_URL"),
    configured("android", "LEMTEL_DOWNLOAD_ANDROID_URL"),
  ];
}

async function platformOverviewAggregates(admin: any) {
  const [organizations, domains, memberships, administrators] = await Promise.all([
    admin.from("lemtel_organizations").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("lemtel_organization_domains").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("lemtel_organization_memberships").select("user_id").eq("status", "active"),
    admin.from("lemtel_platform_administrators").select("user_id", { count: "exact", head: true }).eq("status", "active"),
  ]);
  if (organizations.error || domains.error || memberships.error || administrators.error) return fail("platform_overview_aggregate_unavailable", 503);
  // A count that is not explicitly returned remains absent. It is never rendered as
  // a fictional zero by the client contract.
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
  const userIds = new Set((memberships.data ?? []).flatMap((entry: any) => typeof entry?.user_id === "string" ? [entry.user_id] : []));
  return {
    activeOrganizations: count(organizations.count),
    activeDomains: count(domains.count),
    activeUsers: userIds.size,
    platformAdministrators: count(administrators.count),
  };
}

const PLATFORM_CONNECTION_KINDS = ["desktop", "mobile", "portal", "client"] as const;
function redactedPlatformConnectionCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

/**
 * Presence is a server-written, non-authorizing observation. This global projection
 * returns only bounded totals and rejects the entire presence section on any missing
 * table/count; it never substitutes a fictional zero or returns an individual row.
 */
async function platformOverviewClientPresence(admin: any) {
  const counts = await Promise.all(PLATFORM_CONNECTION_KINDS.map(async (clientKind) => {
    const { count, error } = await admin.from("lemtel_client_connection_presence")
      .select("user_id", { count: "exact", head: true })
      .eq("client_kind", clientKind);
    return error ? undefined : redactedPlatformConnectionCount(count);
  }));
  const { count: revokedCount, error: controlsError } = await admin.from("lemtel_client_session_controls")
    .select("user_id", { count: "exact", head: true })
    .eq("access_state", "revoked");
  const explicitlyRevoked = controlsError ? undefined : redactedPlatformConnectionCount(revokedCount);
  if (counts.some((value) => value === undefined) || explicitlyRevoked === undefined) return { observation: "no_observation" as const };
  const [desktop, mobile, portal, client] = counts as number[];
  return {
    observation: "observed" as const,
    observedConnections: { total: desktop + mobile + portal + client, desktop, mobile, portal, client },
    accessControls: { explicitlyRevoked },
  };
}

/**
 * Authoritative business dashboard contract. It contains only aggregate Lemtel
 * organization data, redacted non-authorizing connection totals and fixed telephony
 * provisioning enums; Operations owns every server/traffic/HA view. No tenant record,
 * identifier, address, secret, raw error, provider state or telephony event crosses
 * this boundary.
 */
export async function platformOverview(admin: any) {
  const [aggregates, clientPresence] = await Promise.all([platformOverviewAggregates(admin), platformOverviewClientPresence(admin)]);
  if (isFailure(aggregates)) return aggregates;
  return {
    schemaVersion: "lemtel-platform-overview/v3" as const,
    observation: "observed" as const,
    aggregates,
    clientPresence,
    telephony: {
      provisioning: "not_provisioned" as const,
      metrics: {
        cdr: "unavailable" as const,
        activeCalls: "unavailable" as const,
        extensions: "unavailable" as const,
        trunks: "unavailable" as const,
        voicemail: "unavailable" as const,
      },
    },
  };
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
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const actor = await actorId(admin, req);
  if (isFailure(actor)) return respond({ error: actor.error }, actor.status);

  if (request.action === "list_organizations") {
    if (!(await portalAccess(admin, actor))) return respond({ error: "forbidden" }, 403);
    const result = await listOrganizations(admin, actor);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond(result);
  }
  if (request.action === "list_platform_administrators") {
    if (!(await platformAdmin(admin, actor))) return respond({ error: "forbidden" }, 403);
    const result = await listPlatformAdministrators(admin);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond(result);
  }
  if (request.action === "grant_platform_administrator") {
    if (!(await platformAdmin(admin, actor))) return respond({ error: "forbidden" }, 403);
    const result = await grantPlatformAdministrator(admin, actor, request.email);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond({ ok: true, administrator: result });
  }
  if (request.action === "revoke_platform_administrator") {
    if (!(await platformAdmin(admin, actor))) return respond({ error: "forbidden" }, 403);
    const result = await revokePlatformAdministrator(admin, actor, request.recipientUserId);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond({ ok: true, administrator: result });
  }
  if (request.action === "get_config") {
    if (!(await portalAccess(admin, actor))) return respond({ error: "forbidden" }, 403);
    return respond(portalConfig());
  }
  if (request.action === "get_operational_status" || request.action === "get_operational_trend") {
    if (!(await platformAdmin(admin, actor))) return respond({ error: "forbidden" }, 403);
    const result = request.action === "get_operational_status" ? await operationalStatus(admin) : await operationalTrend(admin);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond(result);
  }
  if (request.action === "get_traffic_trend") {
    if (!(await platformAdmin(admin, actor))) return respond({ error: "forbidden" }, 403);
    const result = await trafficTrend(admin);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond(result);
  }
  if (request.action === "get_node_status") {
    if (!(await platformAdmin(admin, actor))) return respond({ error: "forbidden" }, 403);
    const result = await nodeStatus(admin);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond(result);
  }
  if (request.action === "get_do_writer_resources") {
    if (!(await platformAdmin(admin, actor))) return respond({ error: "forbidden" }, 403);
    const result = await doWriterResources(admin);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond(result);
  }
  if (request.action === "get_hostinger_standby_resources") {
    if (!(await platformAdmin(admin, actor))) return respond({ error: "forbidden" }, 403);
    const result = await hostingerStandbyResources(admin);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond(result);
  }
  if (request.action === "get_platform_overview") {
    if (!(await platformAdmin(admin, actor))) return respond({ error: "forbidden" }, 403);
    const result = await platformOverview(admin);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond(result);
  }
  if (request.action === "get_telephony_readiness" || request.action === "list_telephony_preparation_states") {
    if (!(await portalOrganizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
    const result = await listTelephonyPreparationStates(admin, request.organizationId);
    if (isFailure(result)) return respond({ error: result.error }, result.status);
    // The catalog and its review markers remain pre-provisioning only: no provider connection or business-data mutation occurs here.
    return request.action === "get_telephony_readiness"
      ? respond({ capabilities: telephonyReadinessCatalog(), preparations: result.preparations })
      : respond(result);
  }
  if (request.action === "set_telephony_preparation_state") {
    if (!(await portalOrganizationAdmin(admin, actor, request.organizationId)) || !(await activeOrganization(admin, request.organizationId))) return respond({ error: "forbidden" }, 403);
    const result = await setTelephonyPreparationState(admin, request.organizationId, actor, request.capabilityKey, request.state);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond({ ok: true, preparation: result });
  }
  if (request.action === "list_people" || request.action === "list_invitations" || request.action === "list_activity" || request.action === "list_domains" || request.action === "list_client_connections") {
    if (!(await portalOrganizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
    const result = request.action === "list_people"
      ? await listPeople(admin, request.organizationId)
      : request.action === "list_invitations"
        ? await listInvitations(admin, request.organizationId)
        : request.action === "list_domains"
          ? await listDomains(admin, request.organizationId)
          : request.action === "list_client_connections"
            ? await listClientConnections(admin, request.organizationId)
            : await listActivity(admin, request.organizationId);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond(result);
  }

  if (request.action === "assign_existing_user") {
    if (!(await organizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
    const result = await assignExistingUser(admin, request.organizationId, actor, request.user);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond({ ok: true, membership: result });
  }

  if (request.action === "set_membership_role") {
    if (!(await organizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
    const result = await setMembershipRole(admin, request.organizationId, actor, request.recipientUserId, request.role);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond({ ok: true, membership: result });
  }

  if (request.action === "set_client_session_access") {
    if (!(await organizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
    const result = await setClientSessionAccess(admin, request.organizationId, actor, request.recipientUserId, request.clientKind, request.accessState);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond({ ok: true, clientSession: result });
  }

  if (request.action === "transfer_organization_ownership") {
    if (!(await organizationOwner(admin, actor, request.organizationId))) return respond({ error: "organization_owner_required" }, 403);
    const result = await transferOrganizationOwnership(admin, request.organizationId, actor, request.recipientUserId);
    return isFailure(result) ? respond({ error: result.error }, result.status) : respond({ ok: true, ownership: result });
  }

  if (request.action === "update_organization") {
    if (!(await portalOrganizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
    const { data, error } = await admin.from("lemtel_organizations")
      .update({ display_name: request.organization.displayName, default_locale: request.organization.defaultLocale })
      .eq("id", request.organizationId).eq("status", "active")
      .select("id").maybeSingle();
    if (error) return respond({ error: "organization_update_failed" }, 503);
    if (!data?.id) return respond({ error: "organization_not_found" }, 404);
    await audit(admin, request.organizationId, actor, "organization_updated", null, { default_locale: request.organization.defaultLocale });
    return respond({ ok: true });
  }
  if (request.action === "archive_organization") {
    if (!(await platformAdmin(admin, actor))) return respond({ error: "forbidden" }, 403);
    const { data, error } = await admin.from("lemtel_organizations")
      .update({ status: "archived" })
      .eq("id", request.organizationId).eq("status", "active")
      .select("id").maybeSingle();
    if (error) return respond({ error: "organization_archive_failed" }, 503);
    if (!data?.id) return respond({ error: "organization_not_found" }, 404);
    await audit(admin, request.organizationId, actor, "organization_archived", null, { lifecycle: "soft_archive" });
    return respond({ ok: true });
  }
  if (request.action === "create_domain") {
    if (!(await organizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
    const { data: domain, error } = await admin.from("lemtel_organization_domains")
      .insert({ organization_id: request.organizationId, hostname: request.domain.hostname, created_by: actor })
      .select("id,hostname,status,verification_status,created_at").single();
    if (error || !domain?.id) return respond({ error: "domain_create_failed" }, 409);
    await audit(admin, request.organizationId, actor, "domain_created", null, { hostname: request.domain.hostname });
    return respond({ ok: true, domain: { id: domain.id, hostname: domain.hostname, status: domain.status, verificationStatus: domain.verification_status, createdAt: domain.created_at } }, 201);
  }

  if (request.action === "suspend_domain") {
    if (!(await organizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
    const { data: domain, error } = await admin.from("lemtel_organization_domains")
      .update({ status: "suspended", suspended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", request.domainId).eq("organization_id", request.organizationId).eq("status", "active")
      .select("id").maybeSingle();
    if (error) return respond({ error: "domain_suspend_failed" }, 503);
    if (!domain?.id) return respond({ error: "domain_not_found" }, 404);
    await audit(admin, request.organizationId, actor, "domain_suspended", null, { domain_id: request.domainId });
    return respond({ ok: true });
  }

  if (request.action === "reactivate_domain") {
    if (!(await organizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
    const { data: domain, error } = await admin.from("lemtel_organization_domains")
      .update({ status: "active", suspended_at: null, updated_at: new Date().toISOString() })
      .eq("id", request.domainId).eq("organization_id", request.organizationId).eq("status", "suspended")
      .select("id").maybeSingle();
    if (error) return respond({ error: "domain_reactivate_failed" }, 503);
    if (!domain?.id) return respond({ error: "domain_not_found" }, 404);
    await audit(admin, request.organizationId, actor, "domain_reactivated", null, { domain_id: request.domainId });
    return respond({ ok: true });
  }

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

  if (request.action === "resend_welcome") {
  // Organization admins and platform admins only. Mail preflight must succeed before rotation.
  if (!(await portalOrganizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
  const configuration = transactionalEmailConfig();
  if (isFailure(configuration)) return respond({ error: "email_delivery_unavailable" }, configuration.status);
  const { data: membership } = await admin.from("lemtel_organization_memberships").select("role").eq("organization_id", request.organizationId).eq("user_id", request.recipientUserId).eq("status", "active").maybeSingle();
  const { data: userResult } = await admin.auth.admin.getUserById(request.recipientUserId);
  const authUser = userResult?.user;
  const email = authUser?.email?.trim().toLowerCase() ?? "";
  if (!membership?.role || !email) return respond({ error: "recipient_not_found" }, 404);
  const temporaryPassword = randomPassword();
  const { error: updateError } = await admin.auth.admin.updateUserById(request.recipientUserId, { password: temporaryPassword, app_metadata: { ...(authUser?.app_metadata ?? {}), lemtel_onboarding_required: true, lemtel_email_only_signin: true } });
  if (updateError) return respond({ error: "temporary_password_reset_failed" }, 503);
  await bumpAccountAuthorityRevision(admin, request.organizationId);
  await audit(admin, request.organizationId, actor, "temporary_password_rotated", request.recipientUserId, {});
  const recipient: UserInput = { email, displayName: String(authUser?.user_metadata?.full_name || email), role: membership.role as Role, locale: request.locale };
  const delivery = await deliverWelcome(admin, request.organizationId, actor, request.recipientUserId, recipient, temporaryPassword, "welcome_resend", configuration);
  return respond({ ok: true, deliveryStatus: delivery.deliveryStatus, email_delivery_required: true });
  }

  if (request.action !== "revoke_invitation") return respond({ error: "invalid_action" }, 400);
  if (!(await organizationAdmin(admin, actor, request.organizationId))) return respond({ error: "forbidden" }, 403);
  const { data: membership, error: membershipError } = await admin.from("lemtel_organization_memberships")
    .select("role,status")
    .eq("organization_id", request.organizationId)
    .eq("user_id", request.recipientUserId)
    .maybeSingle();
  if (membershipError || !membership) return respond({ error: "recipient_not_found" }, 404);
  if (membership.status !== "active") return respond({ ok: true, already_revoked: true });
  if (membership.role === "owner") {
    const { data: owners } = await admin.from("lemtel_organization_memberships")
      .select("user_id")
      .eq("organization_id", request.organizationId)
      .eq("role", "owner")
      .eq("status", "active");
    if ((owners ?? []).length <= 1) return respond({ error: "last_owner_required" }, 400);
  }
  const { error: suspendError } = await admin.from("lemtel_organization_memberships")
    .update({ status: "suspended", suspended_at: new Date().toISOString() })
    .eq("organization_id", request.organizationId)
    .eq("user_id", request.recipientUserId);
  if (suspendError) return respond({ error: "access_revoke_failed" }, 503);
  await audit(admin, request.organizationId, actor, "user_access_suspended", request.recipientUserId, {});
  return respond({ ok: true });
}

if (import.meta.main) Deno.serve(handler);
