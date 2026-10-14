import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { redactedOperationalStatusFromRow, validateBody } from "./index.ts";
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

Deno.test("operational status accepts only the exact platform read action", () => {
  assertEquals(validateBody({ action: "get_operational_status" }), { action: "get_operational_status" });
  assertEquals(validateBody({ action: "get_operational_status", ignored: true }), { error: "invalid_body", status: 400 });
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
