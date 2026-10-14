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
  assert(catalog.every((item) => !JSON.stringify(item).match(/(?:secret|password|hostname|address|provider_config)/i)));
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
