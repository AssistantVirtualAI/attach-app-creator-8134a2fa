// Lemtel-only client for the authoritative self-hosted Lemtel backend.
// This module never imports the Planiprêt client. No password is retained by the client;
// an authenticated browser session is kept only for the current browser session.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = (import.meta as { env?: Record<string, unknown> }).env ?? {};
// Keep this as a direct Vite access so the approved admin-build flag is inlined.
const hostedOnboardingApproval = import.meta.env.VITE_LEMTEL_HOSTED_ONBOARDING;

/**
 * The Lemtel portal can be built beside Planiprêt, so it must never inherit the
 * generic VITE_SUPABASE_* values from that application. Only namespaced public
 * Lemtel variables can configure the Lemtel server.
 */
export function resolveLemtelPortalBackend(environment: Record<string, unknown>) {
  const url = String(environment.VITE_LEMTEL_API_URL ?? "").replace(/\/+$/, "");
  const publishableKey = String(
    environment.VITE_LEMTEL_PUBLISHABLE_KEY ?? environment.VITE_LEMTEL_ANON_KEY ?? "",
  );
  return { url, publishableKey };
}

const { url: configuredUrl, publishableKey: configuredKey } = resolveLemtelPortalBackend(env);

export const LEMTEL_API_URL = configuredUrl;
export const LEMTEL_PUBLISHABLE_KEY = configuredKey;
export const LEMTEL_BACKEND_CONFIGURED = Boolean(LEMTEL_API_URL && LEMTEL_PUBLISHABLE_KEY);
/** Administrative writes remain fail-closed until an approved Lemtel build opts in. */
export const LEMTEL_ONBOARDING_ENABLED =
  LEMTEL_BACKEND_CONFIGURED && hostedOnboardingApproval === "approved";

const sessionMemory = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => sessionMemory.get(key) ?? null,
  setItem: (key: string, value: string) => { sessionMemory.set(key, value); },
  removeItem: (key: string) => { sessionMemory.delete(key); },
};

type SessionStorageAdapter = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Preserve an authenticated admin session through a reload in the same browser
 * session, without using persistent local storage. The memory fallback remains
 * fail-safe for non-browser or privacy-restricted environments.
 */
function resolvePortalSessionStorage(): SessionStorageAdapter {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage;
  } catch {
    // Browser storage can be blocked by a privacy policy; fall back to memory.
  }
  return memoryStorage;
}

const portalSessionStorage = resolvePortalSessionStorage();

let client: SupabaseClient | null = null;
export function lemtelClient(): SupabaseClient | null {
  if (!LEMTEL_BACKEND_CONFIGURED) return null;
  if (!client) {
    client = createClient(LEMTEL_API_URL, LEMTEL_PUBLISHABLE_KEY, {
      auth: {
        storage: portalSessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "lemtel-portal-session",
      },
    });
  }
  return client;
}

export type LemtelErrorKey =
  | "temp_expired"
  | "already_personalized"
  | "network"
  | "unavailable"
  | "invalid_credentials"
  | "not_allowed"
  | "conflict"
  | "invalid_input"
  | "throttled"
  | "readonly"
  | "generic";

export class LemtelError extends Error {
  constructor(public readonly key: LemtelErrorKey) {
    super(key);
  }
}

/** Converts backend failures to a controlled UI category without exposing backend text. */
export function toLemtelErrorKey(code: unknown, status?: number): LemtelErrorKey {
  const value = String(code ?? "").toLowerCase();
  if (value.includes("expired")) return "temp_expired";
  if (value.includes("first_password_change_not_required") || (value.includes("already") && (value.includes("personal") || value.includes("changed")))) return "already_personalized";
  if (value.includes("invalid_credentials") || value.includes("invalid login")) return "invalid_credentials";
  if (value.includes("throttl") || value.includes("rate") || status === 429) return "throttled";
  if (value.includes("exists") || value.includes("duplicate") || value.includes("conflict") || status === 409) return "conflict";
  if (value.includes("forbidden") || value.includes("unauthorized") || value.includes("membership_required") || status === 401 || status === 403) return "not_allowed";
  if (value.includes("invalid") || value.includes("weak_password") || status === 400 || status === 422) return "invalid_input";
  if (value.includes("failed to fetch") || value.includes("network")) return "network";
  if ((status ?? 0) >= 500 || value.includes("unavailable") || value.includes("not_configured")) return "unavailable";
  return "generic";
}

async function invoke<T>(functionName: string, body: unknown, options: { authenticated?: boolean; write?: boolean } = {}): Promise<T> {
  const { authenticated = true, write = false } = options;
  if (!LEMTEL_BACKEND_CONFIGURED) throw new LemtelError("readonly");
  if (write && !LEMTEL_ONBOARDING_ENABLED) throw new LemtelError("readonly");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: LEMTEL_PUBLISHABLE_KEY,
  };
  if (authenticated) {
    const { data } = await lemtelClient()!.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new LemtelError("not_allowed");
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers.Authorization = `Bearer ${LEMTEL_PUBLISHABLE_KEY}`;
  }

  let response: Response;
  try {
    response = await fetch(`${LEMTEL_API_URL}/functions/v1/${functionName}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new LemtelError(typeof navigator !== "undefined" && navigator.onLine === false ? "network" : "unavailable");
  }

  let data: unknown = null;
  try { data = await response.json(); } catch { /* controlled generic error below */ }
  const failure = data as { ok?: boolean; error?: unknown } | null;
  if (!response.ok || failure?.ok === false || failure?.error) {
    throw new LemtelError(toLemtelErrorKey(failure?.error, response.status));
  }
  return (data ?? {}) as T;
}

export type LemtelLocale = "fr" | "en";
export type LemtelRole = "owner" | "admin" | "member";
export type ProvisionedUser = { email: string; displayName: string; role: "admin" | "member"; locale: LemtelLocale };
export type AssignableRole = "admin" | "member";
export type ExistingLemtelUserAssignment = { email: string; role: AssignableRole };
export type PortalOrganization = {
  id: string;
  displayName: string;
  slug: string;
  defaultLocale: LemtelLocale;
  memberCount: number;
  pendingInvitations: number;
};
export type PortalPerson = { userId: string; fullName: string; email: string; role: LemtelRole; status: "active" | "suspended"; locale: LemtelLocale };
export type PortalInvitation = {
  userId: string;
  fullName: string;
  email: string;
  role: LemtelRole;
  locale: LemtelLocale;
  status: "active" | "temp_pending" | "delivery_needs_attention" | "revoked";
  sentAt?: string;
};
export type PortalActivity = { id: string; at: string; action: string };
export type PortalDomain = { id: string; hostname: string; status: "active" | "suspended"; verificationStatus: "verified" | "unverified"; createdAt?: string };
export type PortalClientConnection = {
  userId: string;
  fullName: string;
  email: string;
  clientKind: "mobile" | "desktop" | "portal" | "client";
  lastSeenAt: string;
  authorityRevision: number;
};
export type PortalConfig = { downloads: { desktop?: string; windows?: string; macosApple?: string; macosIntel?: string; ios?: string; android?: string }; supportContact?: string };
export type PortalTelephonyCapability = {
  key: string;
  category: "phone_system" | "call_center" | "analytics_media" | "communications" | "monitoring" | "administration";
  categoryFr: string;
  categoryEn: string;
  nameFr: string;
  nameEn: string;
  descriptionFr: string;
  descriptionEn: string;
  activationRequirementFr: string;
  activationRequirementEn: string;
  status: "not_provisioned";
};
export type OperationalHealth = "healthy" | "degraded" | "unknown";
export type LemtelOperationalStatus = {
  telemetry: "live" | "not_configured";
  observedAt?: string;
  overall: OperationalHealth;
  topology: {
    writer: "digitalocean_promoted_writer" | "unknown";
    standby: "hostinger_streaming_standby" | "hostinger_fenced_rebuild_required" | "unknown";
    route: "canonical_digitalocean_live" | "unknown";
    automaticFailover: boolean;
  };
  services: { runtime: OperationalHealth; database: OperationalHealth; auth: OperationalHealth; rest: OperationalHealth; storage: OperationalHealth; accountRecovery: OperationalHealth };
  replication: {
    database: "streaming" | "rebuild_required" | "unknown";
    storage: "integrity_verified" | "sync_attention" | "rebuild_required" | "unknown";
  };
};
export type LemtelOperationalTrendSample = {
  observedAt?: string;
  overall: OperationalHealth;
  runtime: OperationalHealth;
  database: OperationalHealth;
  storage: OperationalHealth;
  standby: "hostinger_streaming_standby" | "hostinger_fenced_rebuild_required" | "unknown";
};

export function buildCreateOrganizationBody(input: {
  displayName: string;
  slug: string;
  defaultLocale: LemtelLocale;
  owner: { email: string; displayName: string; locale: LemtelLocale };
}) {
  return {
    action: "create_organization" as const,
    organization: { displayName: input.displayName, slug: input.slug, defaultLocale: input.defaultLocale },
    owner: { email: input.owner.email, displayName: input.owner.displayName, role: "owner" as const, locale: input.owner.locale },
    users: [],
  };
}

export function buildProvisionUsersBody(organizationId: string, users: ProvisionedUser[]) {
  return { action: "provision_users" as const, organizationId, users };
}

export function buildResendWelcomeBody(organizationId: string, recipientUserId: string, locale: LemtelLocale) {
  return { action: "resend_welcome" as const, organizationId, recipientUserId, locale };
}

export function buildCreateDomainBody(organizationId: string, hostname: string) {
  return { action: "create_domain" as const, organizationId, domain: { hostname: hostname.trim().toLowerCase().replace(/\.$/, "") } };
}

export function buildAssignExistingUserBody(organizationId: string, user: ExistingLemtelUserAssignment) {
  return { action: "assign_existing_user" as const, organizationId, user: { email: user.email.trim().toLowerCase(), role: user.role } };
}

export function buildSetMembershipRoleBody(organizationId: string, recipientUserId: string, role: AssignableRole) {
  return { action: "set_membership_role" as const, organizationId, recipientUserId, role };
}

export function buildTransferOrganizationOwnershipBody(organizationId: string, recipientUserId: string) {
  return { action: "transfer_organization_ownership" as const, organizationId, recipientUserId };
}

export function buildReactivateDomainBody(organizationId: string, domainId: string) {
  return { action: "reactivate_domain" as const, organizationId, domainId };
}

/**
 * Every object below uses the exact Lemtel Edge contract. There is intentionally
 * no generic action/payload wrapper and no legacy Planiprêt action name.
 */
export const portalApi = {
  listOrganizations: () => invoke<{ organizations: PortalOrganization[] }>("lemtel-onboarding-admin", { action: "list_organizations" }),
  getConfig: () => invoke<PortalConfig>("lemtel-onboarding-admin", { action: "get_config" }),
  getOperationalStatus: () => invoke<LemtelOperationalStatus>("lemtel-onboarding-admin", { action: "get_operational_status" }),
  getOperationalTrend: () => invoke<{ samples: LemtelOperationalTrendSample[] }>("lemtel-onboarding-admin", { action: "get_operational_trend" }),
  listPeople: (organizationId: string) => invoke<{ people: PortalPerson[] }>("lemtel-onboarding-admin", { action: "list_people", organizationId }),
  listInvitations: (organizationId: string) => invoke<{ invitations: PortalInvitation[] }>("lemtel-onboarding-admin", { action: "list_invitations", organizationId }),
  listActivity: (organizationId: string) => invoke<{ events: PortalActivity[] }>("lemtel-onboarding-admin", { action: "list_activity", organizationId }),
  listDomains: (organizationId: string) => invoke<{ domains: PortalDomain[] }>("lemtel-onboarding-admin", { action: "list_domains", organizationId }),
  listClientConnections: (organizationId: string) => invoke<{ connections: PortalClientConnection[] }>("lemtel-onboarding-admin", { action: "list_client_connections", organizationId }),
  getTelephonyReadiness: (organizationId: string) => invoke<{ capabilities: PortalTelephonyCapability[] }>("lemtel-onboarding-admin", { action: "get_telephony_readiness", organizationId }),
  createOrganization: (input: Parameters<typeof buildCreateOrganizationBody>[0]) =>
    invoke<{ ok: true; organization: { id: string } }>("lemtel-onboarding-admin", buildCreateOrganizationBody(input), { write: true }),
  provisionUsers: (organizationId: string, users: ProvisionedUser[]) =>
    invoke<{ ok: true; users: Array<{ email: string; delivered: boolean; error?: string }> }>("lemtel-onboarding-admin", buildProvisionUsersBody(organizationId, users), { write: true }),
  issueTemporaryPassword: (organizationId: string, recipientUserId: string, locale: LemtelLocale) =>
    invoke<{ ok: true; delivered: boolean }>("lemtel-onboarding-admin", buildResendWelcomeBody(organizationId, recipientUserId, locale), { write: true }),
  revokeAccess: (organizationId: string, recipientUserId: string) =>
    invoke<{ ok: true }>("lemtel-onboarding-admin", { action: "revoke_invitation", organizationId, recipientUserId }, { write: true }),
  createDomain: (organizationId: string, hostname: string) =>
    invoke<{ ok: true; domain: PortalDomain }>("lemtel-onboarding-admin", buildCreateDomainBody(organizationId, hostname), { write: true }),
  suspendDomain: (organizationId: string, domainId: string) =>
    invoke<{ ok: true }>("lemtel-onboarding-admin", { action: "suspend_domain", organizationId, domainId }, { write: true }),
  reactivateDomain: (organizationId: string, domainId: string) =>
    invoke<{ ok: true }>("lemtel-onboarding-admin", buildReactivateDomainBody(organizationId, domainId), { write: true }),
  assignExistingUser: (organizationId: string, user: ExistingLemtelUserAssignment) =>
    invoke<{ ok: true; membership: { status: "assigned" | "reactivated" | "unchanged" } }>("lemtel-onboarding-admin", buildAssignExistingUserBody(organizationId, user), { write: true }),
  setMembershipRole: (organizationId: string, recipientUserId: string, role: AssignableRole) =>
    invoke<{ ok: true; membership: { status: "updated" | "unchanged" } }>("lemtel-onboarding-admin", buildSetMembershipRoleBody(organizationId, recipientUserId, role), { write: true }),
  transferOrganizationOwnership: (organizationId: string, recipientUserId: string) =>
    invoke<{ ok: true; ownership: { status: "transferred" } }>("lemtel-onboarding-admin", buildTransferOrganizationOwnershipBody(organizationId, recipientUserId), { write: true }),
  completeFirstPassword: (newPassword: string) =>
    invoke<{ ok: true; password_change_required: false }>("lemtel-complete-first-password", { newPassword }),
  requestTemporaryPassword: async (email: string): Promise<void> => {
    try {
      await invoke("lemtel-password-reset-request", { email: email.trim().toLowerCase() }, { authenticated: false });
    } catch (error) {
      const key = error instanceof LemtelError ? error.key : "generic";
      // The endpoint is deliberately non-enumerating. Only transport and throttle failures alter the generic UI outcome.
      if (["throttled", "network", "unavailable", "readonly"].includes(key)) throw error;
    }
  },
};
