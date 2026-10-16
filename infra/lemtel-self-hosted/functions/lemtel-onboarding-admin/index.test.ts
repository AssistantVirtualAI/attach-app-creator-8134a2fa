import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { noObservationNodeStatus, platformOverview, provisionMany, redactedOperationalStatusFromRow, validateBody } from "./index.ts";
import { telephonyReadinessCatalog } from "./lemtelTelephonyReadiness.ts";

Deno.test("portal list action accepts only its exact body", () => {
  assertEquals(validateBody({ action: "list_organizations" }), { action: "list_organizations" });
  assertEquals(validateBody({ action: "list_organizations", ignored: true }), { error: "invalid_body", status: 400 });
});

Deno.test("create organization requires Lemtel-only names and owner role", () => {
  assertEquals(validateBody({
    action: "create_organization",
    organization: { displayName: "Lemtel : Staging", slug: "lemtel-staging", defaultLocale: "fr" },
    owner: { email: "owner@example.com", displayName: "Owner", role: "owner", locale: "fr" },
    users: [],
  }), {
    action: "create_organization",
    organization: { displayName: "Lemtel : Staging", slug: "lemtel-staging", defaultLocale: "fr" },
    owner: { email: "owner@example.com", displayName: "Owner", role: "owner", locale: "fr" },
    users: [],
  });
});

Deno.test("user provisioning rejects deprecated non-Lemtel roles", () => {
  assertEquals(validateBody({
    action: "provision_users",
    organizationId: "11111111-1111-4111-8111-111111111111",
    users: [{ email: "member@example.com", displayName: "Member", role: "manager", locale: "en" }],
  }), { error: "invalid_role", status: 400 });
});

Deno.test("revoke action requires an exact pair of Lemtel UUIDs", () => {
  assertEquals(validateBody({ action: "revoke_invitation", organizationId: "bad", recipientUserId: "bad" }), { error: "invalid_organization_id", status: 400 });
});

Deno.test("membership assignment and role updates require strict Lemtel-scoped bodies", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const recipientUserId = "22222222-2222-4222-8222-222222222222";
  assertEquals(validateBody({ action: "assign_existing_user", organizationId, user: { email: " Existing@Example.com ", role: "member" } }), {
    action: "assign_existing_user", organizationId, user: { email: "existing@example.com", role: "member" },
  });
  assertEquals(validateBody({ action: "assign_existing_user", organizationId, user: { email: "existing@example.com", role: "owner" } }), { error: "invalid_user", status: 400 });
  assertEquals(validateBody({ action: "set_membership_role", organizationId, recipientUserId, role: "admin" }), {
    action: "set_membership_role", organizationId, recipientUserId, role: "admin",
  });
  assertEquals(validateBody({ action: "set_membership_role", organizationId, recipientUserId, role: "owner" }), { error: "invalid_role", status: 400 });
  assertEquals(validateBody({ action: "set_membership_role", organizationId, recipientUserId, role: "member", ignored: true }), { error: "invalid_body", status: 400 });
});

Deno.test("ownership transfer and domain reactivation require exact tenant-scoped bodies", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const recipientUserId = "22222222-2222-4222-8222-222222222222";
  const domainId = "33333333-3333-4333-8333-333333333333";
  assertEquals(validateBody({ action: "transfer_organization_ownership", organizationId, recipientUserId }), {
    action: "transfer_organization_ownership", organizationId, recipientUserId,
  });
  assertEquals(validateBody({ action: "transfer_organization_ownership", organizationId, recipientUserId, ignored: true }), { error: "invalid_body", status: 400 });
  assertEquals(validateBody({ action: "reactivate_domain", organizationId, domainId }), {
    action: "reactivate_domain", organizationId, domainId,
  });
  assertEquals(validateBody({ action: "reactivate_domain", organizationId, domainId, ignored: true }), { error: "invalid_body", status: 400 });
});

Deno.test("client session controls require exact bounded state", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const recipientUserId = "22222222-2222-4222-8222-222222222222";
  assertEquals(validateBody({ action: "set_client_session_access", organizationId, recipientUserId, clientKind: "desktop", accessState: "revoked" }), {
    action: "set_client_session_access", organizationId, recipientUserId, clientKind: "desktop", accessState: "revoked",
  });
  assertEquals(validateBody({ action: "set_client_session_access", organizationId, recipientUserId, clientKind: "portal", accessState: "revoked" }), { error: "invalid_client_kind", status: 400 });
  assertEquals(validateBody({ action: "set_client_session_access", organizationId, recipientUserId, clientKind: "desktop", accessState: "unknown" }), { error: "invalid_access_state", status: 400 });
});

Deno.test("organization workspace updates and archives use strict, confirmed bodies", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  assertEquals(validateBody({ action: "update_organization", organizationId, organization: { displayName: "Lemtel : Staging", defaultLocale: "fr" } }), { action: "update_organization", organizationId, organization: { displayName: "Lemtel : Staging", defaultLocale: "fr" } });
  assertEquals(validateBody({ action: "archive_organization", organizationId, confirmation: "ARCHIVE" }), { action: "archive_organization", organizationId, confirmation: "ARCHIVE" });
  assertEquals(validateBody({ action: "archive_organization", organizationId, confirmation: "DELETE" }), { error: "archive_confirmation_required", status: 400 });
});

Deno.test("telephony preparation transitions require exact catalog-scoped, bounded bodies", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  assertEquals(validateBody({ action: "list_telephony_preparation_states", organizationId }), { action: "list_telephony_preparation_states", organizationId });
  assertEquals(validateBody({ action: "set_telephony_preparation_state", organizationId, capabilityKey: "extensions", state: "review_ready" }), {
    action: "set_telephony_preparation_state", organizationId, capabilityKey: "extensions", state: "review_ready",
  });
  assertEquals(validateBody({ action: "set_telephony_preparation_state", organizationId, capabilityKey: "extensions", state: "not_started" }), {
    action: "set_telephony_preparation_state", organizationId, capabilityKey: "extensions", state: "not_started",
  });
  assertEquals(validateBody({ action: "set_telephony_preparation_state", organizationId, capabilityKey: "unknown_capability", state: "review_ready" }), { error: "invalid_telephony_capability", status: 400 });
  assertEquals(validateBody({ action: "set_telephony_preparation_state", organizationId, capabilityKey: "extensions", state: "active" }), { error: "invalid_telephony_preparation_state", status: 400 });
  assertEquals(validateBody({ action: "set_telephony_preparation_state", organizationId, capabilityKey: "extensions", state: "review_ready", ignored: true }), { error: "invalid_body", status: 400 });
});

Deno.test("operational status accepts only the exact platform read action", () => {
  assertEquals(validateBody({ action: "get_operational_status" }), { action: "get_operational_status" });
  assertEquals(validateBody({ action: "get_operational_status", ignored: true }), { error: "invalid_body", status: 400 });
});

Deno.test("global platform overview is an exact platform read with an honest node fallback", async () => {
  assertEquals(validateBody({ action: "get_platform_overview" }), { action: "get_platform_overview" });
  assertEquals(validateBody({ action: "get_platform_overview", ignored: true }), { error: "invalid_body", status: 400 });
  assertEquals(noObservationNodeStatus(), {
    schemaVersion: "lemtel-node-status/v1", observation: "no_observation",
    roles: [
      { nodeRole: "do_writer", agentState: "unknown", runtimeState: "unknown", replicationState: "unknown", storageState: "unknown" },
      { nodeRole: "hostinger_standby", agentState: "unknown", runtimeState: "unknown", replicationState: "unknown", storageState: "unknown" },
    ],
  });
  const result = await platformOverview({ from(table: string) {
    if (table === "lemtel_organizations" || table === "lemtel_organization_memberships" || table === "lemtel_platform_administrators") {
      const count = table === "lemtel_organizations" ? 2 : table === "lemtel_organization_memberships" ? 5 : 1;
      return { select: () => ({ eq: () => Promise.resolve({ data: null, count, error: null }) }) };
    }
    if (table === "lemtel_operational_status") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { observed_at: "2026-10-15T12:00:00Z", overall_status: "healthy", payload: { topology: { automatic_failover: true }, services: { runtime: "healthy" }, replication: {} } }, error: null }) }) }) };
    if (table === "lemtel_traffic_samples") return { select: () => ({ gte: () => ({ lt: () => ({ order: () => ({ order: () => ({ range: () => ({ abortSignal: () => Promise.resolve({ data: [], error: null }) }) }) }) }) }) }) };
    if (table === "lemtel_node_status_current") return { select: () => ({ order: () => ({ limit: () => ({ abortSignal: () => Promise.resolve({ data: null, error: { code: "42P01" } }) }) }) }) };
    throw new Error(`unexpected table ${table}`);
  } } as any, Date.parse("2026-10-15T12:01:00Z"));
  if ("error" in result) throw new Error(`unexpected overview failure: ${result.error}`);
  assertEquals(result.schemaVersion, "lemtel-platform-overview/v1");
  assertEquals(result.observation, "observed");
  assertEquals(result.aggregates, { activeOrganizations: 2, activeMemberships: 5, platformAdministrators: 1 });
  assertEquals(result.operational.topology.automaticFailover, false);
  assertEquals(result.standby.observation, "no_observation");
  assertEquals(result.traffic.observation, "no_observation");
  assert(!JSON.stringify(result).match(/42P01|hostname|secret|address|telephony/i));
});

Deno.test("telephony readiness is an organization-scoped, exact and fail-closed read", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  assertEquals(validateBody({ action: "get_telephony_readiness", organizationId }), { action: "get_telephony_readiness", organizationId });
  assertEquals(validateBody({ action: "get_telephony_readiness", organizationId, ignored: true }), { error: "invalid_body", status: 400 });
  const catalog = telephonyReadinessCatalog();
  assert(catalog.some((item) => item.key === "extensions"));
  assert(catalog.some((item) => item.key === "recordings"));
  assert(catalog.every((item) => item.status === "not_provisioned"));
  assert(catalog.every((item) => !JSON.stringify(item).match(/(?:password|hostname|address|provider_config)/i)));
});

Deno.test("operational status removes unexpected and sensitive snapshot fields", () => {
  const snapshot = redactedOperationalStatusFromRow({
    observed_at: "2026-10-12T04:00:00Z",
    overall_status: "healthy",
    payload: {
      topology: { writer: "digitalocean_promoted_writer", standby: "hostinger_fenced_rebuild_required", route: "canonical_digitalocean_live", automatic_failover: false, hostname: "private.example.invalid" },
      services: { runtime: "healthy", database: "healthy", auth: "healthy", rest: "healthy", storage: "healthy", database_error: "private detail" },
      replication: { database: "rebuild_required", storage: "rebuild_required", lag_bytes: 999 },
      secret: "must-not-leave-server",
      address: "must-not-leave-server",
    },
  });

  assertEquals(snapshot.topology.writer, "digitalocean_promoted_writer");
  assertEquals(snapshot.topology.automaticFailover, false);
  assertEquals(snapshot.services.auth, "healthy");
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ["hostname", "private.example.invalid", "database_error", "lag_bytes", "must-not-leave-server", "secret", "address"]) {
    assert(!serialized.includes(forbidden), `unexpected field leaked: ${forbidden}`);
  }
});

Deno.test("operational status fails closed for malformed data", () => {
  const snapshot = redactedOperationalStatusFromRow({ observed_at: 123, overall_status: "unexpected", payload: { services: { auth: "untrusted" } } });
  assertEquals(snapshot.overall, "unknown");
  assertEquals(snapshot.services.auth, "unknown");
  assertEquals(snapshot.topology.writer, "unknown");
});

Deno.test("platform administrator controls require explicit exact confirmations", () => {
  const recipientUserId = "22222222-2222-4222-8222-222222222222";
  assertEquals(validateBody({ action: "list_platform_administrators" }), { action: "list_platform_administrators" });
  assertEquals(validateBody({ action: "grant_platform_administrator", email: " Phil@Lemtel.com ", confirmation: "GRANT_PLATFORM_ADMIN" }), { action: "grant_platform_administrator", email: "phil@lemtel.com", confirmation: "GRANT_PLATFORM_ADMIN" });
  assertEquals(validateBody({ action: "grant_platform_administrator", email: "phil@lemtel.com", confirmation: "GRANT" }), { error: "platform_admin_confirmation_required", status: 400 });
  assertEquals(validateBody({ action: "revoke_platform_administrator", recipientUserId, confirmation: "REVOKE_PLATFORM_ADMIN" }), { action: "revoke_platform_administrator", recipientUserId, confirmation: "REVOKE_PLATFORM_ADMIN" });
});

Deno.test("invalid mail preflight stops before any account or delivery mutation", async () => {
  const result = await provisionMany({} as any, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", [{ email: "member@example.test", displayName: "Member", role: "member", locale: "fr" }], () => ({ error: "email_delivery_unavailable", status: 503 }));
  assertEquals(result, [{ email: "member@example.test", deliveryStatus: "needs_attention", error: "email_delivery_unavailable" }]);
  assert(!JSON.stringify(result).match(/password|synthetic-provider-key/i));
});
