import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { noObservationNodeStatus, platformOverview, provisionMany, removeMember, redactedHostingerStandbyResources, redactedOperationalStatusFromRow, validateBody } from "./index.ts";
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

Deno.test("global platform overview is an exact business read with redacted presence and unprovisioned telephony", async () => {
  assertEquals(validateBody({ action: "get_platform_overview" }), { action: "get_platform_overview" });
  assertEquals(validateBody({ action: "get_platform_overview", ignored: true }), { error: "invalid_body", status: 400 });
  const result = await platformOverview({ from(table: string) {
    if (table === "lemtel_organizations" || table === "lemtel_organization_domains" || table === "lemtel_platform_administrators") {
      const count = table === "lemtel_organizations" ? 2 : table === "lemtel_organization_domains" ? 4 : 1;
      return { select: () => ({ eq: () => Promise.resolve({ data: null, count, error: null }) }) };
    }
    if (table === "lemtel_organization_memberships") return { select: () => ({ eq: () => Promise.resolve({ data: [{ user_id: "user-a" }, { user_id: "user-b" }, { user_id: "user-a" }], error: null }) }) };
    if (table === "lemtel_client_connection_presence") {
      const counts: Record<string, number> = { desktop: 2, mobile: 1, portal: 1, client: 0 };
      return { select: () => ({ eq: (_field: string, kind: string) => Promise.resolve({ data: null, count: counts[kind], error: null }) }) };
    }
    if (table === "lemtel_client_session_controls") return { select: () => ({ eq: () => Promise.resolve({ data: null, count: 2, error: null }) }) };
    throw new Error(`unexpected table ${table}`);
  } } as any);
  if ("error" in result) throw new Error(`unexpected overview failure: ${result.error}`);
  assertEquals(result.schemaVersion, "lemtel-platform-overview/v3");
  assertEquals(result.observation, "observed");
  assertEquals(result.aggregates, { activeOrganizations: 2, activeDomains: 4, activeUsers: 2, platformAdministrators: 1 });
  assertEquals(result.clientPresence, { observation: "observed", observedConnections: { total: 4, desktop: 2, mobile: 1, portal: 1, client: 0 }, accessControls: { explicitlyRevoked: 2 } });
  assertEquals(result.telephony, {
    provisioning: "not_provisioned",
    metrics: { cdr: "unavailable", activeCalls: "unavailable", extensions: "unavailable", trunks: "unavailable", voicemail: "unavailable" },
  });
  assert(!("operational" in result) && !("traffic" in result) && !("standby" in result));
  assert(!JSON.stringify(result).match(/user_id|hostname|secret|address|provider|pbx|cdr.*[0-9]/i));
});

Deno.test("global platform overview returns no presence observation when a count cannot be attested", async () => {
  const result = await platformOverview({ from(table: string) {
    if (table === "lemtel_organizations" || table === "lemtel_organization_domains" || table === "lemtel_platform_administrators") return { select: () => ({ eq: () => Promise.resolve({ data: null, count: 0, error: null }) }) };
    if (table === "lemtel_organization_memberships") return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    if (table === "lemtel_client_connection_presence") return { select: () => ({ eq: () => Promise.resolve({ data: null, count: null, error: { code: "absent" } }) }) };
    if (table === "lemtel_client_session_controls") return { select: () => ({ eq: () => Promise.resolve({ data: null, count: 0, error: null }) }) };
    throw new Error(`unexpected table ${table}`);
  } } as any);
  if ("error" in result) throw new Error(`unexpected overview failure: ${result.error}`);
  assertEquals(result.clientPresence, { observation: "no_observation" });
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

Deno.test("Hostinger standby resources are labelled as signed, not enrolled, and only fresh bounded rows are shown", () => {
  const now = Date.UTC(2026, 9, 19, 2, 30, 30);
  const row = { observed_at: "2026-10-19T02:30:00Z", cpu_percent: 7, memory_percent: 51, disk_percent: 22, load1_milli: 40, load5_milli: 30, load15_milli: 20 };
  const observed = redactedHostingerStandbyResources(row, now);
  assertEquals(observed, { schemaVersion: "lemtel-hostinger-standby-resources/v1", trust: "signed_publication_not_enrolled", observation: "observed", observedAt: "2026-10-19T02:30:00.000Z", resources: { cpuPercent: 7, memoryPercent: 51, diskPercent: 22, load1Milli: 40, load5Milli: 30, load15Milli: 20 } });
  for (const stale of [undefined, null, {}, { ...row, observed_at: "2026-10-19T02:27:00Z" }, { ...row, cpu_percent: 101 }, { ...row, load5_milli: 1.5 }]) {
    assertEquals(redactedHostingerStandbyResources(stale, now), { schemaVersion: "lemtel-hostinger-standby-resources/v1", trust: "signed_publication_not_enrolled", observation: "no_observation" });
  }
  assert(!("error" in validateBody({ action: "get_hostinger_standby_resources" })));
  assert("error" in validateBody({ action: "get_hostinger_standby_resources", role: "do_writer" }));
});

// Minimal in-memory PostgREST/Auth fake for the member-removal flow.
function memberWorld(rows: Record<string, Record<string, unknown>[]>, options: { deleteUserFails?: boolean } = {}) {
  const calls: string[] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const sets: [string, unknown[]][] = [];
    let mode: "select" | "delete" | "update" = "select";
    let patch: Record<string, unknown> = {};
    const match = () => (rows[table] ?? []).filter((row) => filters.every(([k, v]) => row[k] === v) && sets.every(([k, v]) => v.includes(row[k])));
    const run = () => {
      if (mode === "delete") { const keep = (rows[table] ?? []).filter((row) => !match().includes(row)); calls.push(`delete:${table}`); rows[table] = keep; return { data: null, error: null }; }
      if (mode === "update") { for (const row of match()) Object.assign(row, patch); calls.push(`update:${table}`); return { data: match()[0] ?? null, error: null }; }
      return { data: match(), error: null };
    };
    const builder: any = {
      select: () => builder, eq: (k: string, v: unknown) => { filters.push([k, v]); return builder; }, in: (k: string, v: unknown[]) => { sets.push([k, v]); return builder; }, limit: () => builder,
      delete: () => { mode = "delete"; return builder; }, update: (p: Record<string, unknown>) => { mode = "update"; patch = p; return builder; },
      insert: (row: Record<string, unknown>) => { (rows[table] ??= []).push(row); calls.push(`insert:${table}`); return Promise.resolve({ data: null, error: null }); },
      maybeSingle: () => Promise.resolve({ data: run().data instanceof Array ? (run().data as unknown[])[0] ?? null : run().data, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return builder;
  };
  const admin = {
    from, rpc: () => Promise.resolve({ error: null }),
    auth: { admin: {
      deleteUser: (id: string) => { calls.push(`deleteUser:${id}`); return Promise.resolve({ error: options.deleteUserFails ? { message: "restricted" } : null }); },
      updateUserById: (id: string, attrs: Record<string, unknown>) => { calls.push(`ban:${id}:${attrs.ban_duration}`); return Promise.resolve({ error: null }); },
    } },
  };
  return { admin, calls, rows };
}
const ORG = "11111111-1111-4111-8111-111111111111", OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const ADMIN_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const baseRows = () => ({
  lemtel_organization_memberships: [
    { organization_id: ORG, user_id: ADMIN_USER, role: "owner", status: "active" },
    { organization_id: ORG, user_id: MEMBER, role: "member", status: "active" },
  ],
  lemtel_platform_administrators: [],
  lemtel_client_session_controls: [{ organization_id: ORG, user_id: MEMBER, client_kind: "mobile" }],
});

Deno.test("remove, restore and domain deletion require exact, confirmed bodies", () => {
  assertEquals(validateBody({ action: "remove_member", organizationId: ORG, recipientUserId: MEMBER, confirmation: "REMOVE_MEMBER" }),
    { action: "remove_member", organizationId: ORG, recipientUserId: MEMBER, confirmation: "REMOVE_MEMBER" });
  assert("error" in (validateBody({ action: "remove_member", organizationId: ORG, recipientUserId: MEMBER }) as object));
  assert("error" in (validateBody({ action: "remove_member", organizationId: ORG, recipientUserId: MEMBER, confirmation: "yes" }) as object));
  assertEquals(validateBody({ action: "restore_member", organizationId: ORG, recipientUserId: MEMBER }), { action: "restore_member", organizationId: ORG, recipientUserId: MEMBER });
  assertEquals(validateBody({ action: "delete_domain", organizationId: ORG, domainId: MEMBER, confirmation: "DELETE_DOMAIN" }),
    { action: "delete_domain", organizationId: ORG, domainId: MEMBER, confirmation: "DELETE_DOMAIN" });
  assert("error" in (validateBody({ action: "delete_domain", organizationId: ORG, domainId: MEMBER }) as object));
  assertEquals(validateBody({ action: "update_member_profile", organizationId: ORG, recipientUserId: MEMBER, profile: { fullName: "  Ana   Roy ", locale: "en" } }),
    { action: "update_member_profile", organizationId: ORG, recipientUserId: MEMBER, profile: { fullName: "Ana Roy", locale: "en" } });
  assert("error" in (validateBody({ action: "update_member_profile", organizationId: ORG, recipientUserId: MEMBER, profile: { fullName: "<b>", locale: "en" } }) as object));
  assert("error" in (validateBody({ action: "update_member_profile", organizationId: ORG, recipientUserId: MEMBER, profile: { fullName: "Ana", locale: "es" } }) as object));
  assertEquals(validateBody({ action: "list_archived_organizations" }), { action: "list_archived_organizations" });
  assertEquals(validateBody({ action: "restore_organization", organizationId: ORG, confirmation: "RESTORE" }), { action: "restore_organization", organizationId: ORG, confirmation: "RESTORE" });
  assert("error" in (validateBody({ action: "restore_organization", organizationId: ORG }) as object));
});

Deno.test("removing a member deletes the membership and sessions, then the account when it belongs nowhere else", async () => {
  const w = memberWorld(baseRows());
  const result = await removeMember(w.admin, ORG, ADMIN_USER, MEMBER);
  assertEquals(result, { ok: true, account: "deleted" });
  assertEquals(w.rows.lemtel_organization_memberships.filter((r) => r.user_id === MEMBER).length, 0);
  assertEquals(w.rows.lemtel_client_session_controls.length, 0);
  assert(w.calls.includes(`deleteUser:${MEMBER}`));
});

Deno.test("a member of another organization keeps the account; a referenced account is banned; owners and self are protected", async () => {
  const shared = baseRows(); shared.lemtel_organization_memberships.push({ organization_id: OTHER_ORG, user_id: MEMBER, role: "member", status: "active" });
  const w1 = memberWorld(shared);
  assertEquals(await removeMember(w1.admin, ORG, ADMIN_USER, MEMBER), { ok: true, account: "kept_other_organizations" });
  assert(!w1.calls.some((c) => c.startsWith("deleteUser")));
  const w2 = memberWorld(baseRows(), { deleteUserFails: true });
  assertEquals(await removeMember(w2.admin, ORG, ADMIN_USER, MEMBER), { ok: true, account: "disabled" });
  assert(w2.calls.includes(`ban:${MEMBER}:876000h`));
  const w3 = memberWorld(baseRows());
  assertEquals((await removeMember(w3.admin, ORG, ADMIN_USER, ADMIN_USER) as { error: string }).error, "cannot_remove_yourself");
  const w4 = memberWorld(baseRows()); w4.rows.lemtel_organization_memberships[1].role = "owner";
  assertEquals((await removeMember(w4.admin, ORG, ADMIN_USER, MEMBER) as { error: string }).error, "transfer_ownership_first");
  const w5 = memberWorld(baseRows());
  assertEquals((await removeMember(w5.admin, ORG, MEMBER, ADMIN_USER) as { error: string }).error, "forbidden");
});
