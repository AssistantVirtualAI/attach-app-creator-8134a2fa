// Lemtel PBX connection admin — portal-only (platform administrators, organization owners/admins).
// Receives what Kenny/Phil provide (FusionPBX host, SIP domain, WSS, TURN, test extensions), stores secrets
// write-only (encrypted), runs a real WSS + SIP validation (OPTIONS, REGISTER then un-REGISTER), and activates
// the organization's connection only after a passing validation. No secret is ever returned.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  activationBlocker, extensionAad, rowFromDb, isInvalid, loadSecretKey, openSecret, optionsPing, parseAssignment, parseSecret, parseSettings,
  registrationProbe, sealSecret, secretAad, SECRET_KINDS, summarize,
  type ConnectionRow, type ConnectionSettings, type SecretKind, type SocketFactory, type ValidationCheck,
} from "../_shared/lemtelPbxConnection.ts";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export type Request_ =
  | { action: "get_connection"; organizationId: string }
  | { action: "save_settings"; organizationId: string; settings: ConnectionSettings }
  | { action: "set_secret"; organizationId: string; kind: SecretKind; value: string }
  | { action: "clear_secret"; organizationId: string; kind: SecretKind }
  | { action: "assign_extension"; organizationId: string; assignment: ReturnType<typeof parseAssignment> & object; sipPassword: string | null }
  | { action: "unassign_extension"; organizationId: string; userId: string }
  | { action: "validate"; organizationId: string }
  | { action: "set_state"; organizationId: string; state: "active" | "suspended" | "draft" };

const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));

/** Exact body validation; a secret value is only accepted in the two write-only actions. */
export function validateBody(raw: unknown): Request_ | { error: string } {
  if (!plain(raw) || typeof raw.action !== "string") return { error: "invalid_request" };
  const org = typeof raw.organizationId === "string" && UUID_RE.test(raw.organizationId) ? raw.organizationId.toLowerCase() : null;
  if (!org) return { error: "invalid_organization" };
  switch (raw.action) {
    case "get_connection": case "validate":
      return keys(raw, ["action", "organizationId"]) ? { action: raw.action, organizationId: org } : { error: "invalid_request" };
    case "save_settings": {
      if (!keys(raw, ["action", "organizationId", "settings"])) return { error: "invalid_request" };
      const settings = parseSettings(raw.settings);
      return isInvalid(settings) ? settings : { action: "save_settings", organizationId: org, settings };
    }
    case "set_secret": case "clear_secret": {
      if (!keys(raw, raw.action === "set_secret" ? ["action", "organizationId", "kind", "value"] : ["action", "organizationId", "kind"])) return { error: "invalid_request" };
      if (!(SECRET_KINDS as readonly unknown[]).includes(raw.kind)) return { error: "invalid_secret_kind" };
      if (raw.action === "clear_secret") return { action: "clear_secret", organizationId: org, kind: raw.kind as SecretKind };
      const value = parseSecret(raw.value, 16);
      return isInvalid(value) ? value : { action: "set_secret", organizationId: org, kind: raw.kind as SecretKind, value };
    }
    case "assign_extension": {
      if (!keys(raw, ["action", "organizationId", "assignment", "sipPassword"])) return { error: "invalid_request" };
      const assignment = parseAssignment(raw.assignment);
      if (isInvalid(assignment)) return assignment;
      let sipPassword: string | null = null;
      if (raw.sipPassword !== undefined && raw.sipPassword !== null && raw.sipPassword !== "") {
        const p = parseSecret(raw.sipPassword, 6); if (isInvalid(p)) return { error: "invalid_sip_password" }; sipPassword = p;
      }
      return { action: "assign_extension", organizationId: org, assignment, sipPassword };
    }
    case "unassign_extension":
      return keys(raw, ["action", "organizationId", "userId"]) && typeof raw.userId === "string" && UUID_RE.test(raw.userId)
        ? { action: "unassign_extension", organizationId: org, userId: raw.userId.toLowerCase() } : { error: "invalid_request" };
    case "set_state":
      return keys(raw, ["action", "organizationId", "state"]) && (raw.state === "active" || raw.state === "suspended" || raw.state === "draft")
        ? { action: "set_state", organizationId: org, state: raw.state } : { error: "invalid_request" };
    default: return { error: "invalid_action" };
  }
}

export { rowFromDb };
// deno-lint-ignore no-explicit-any
type Admin = any;
export type Deps = { admin: Admin; env: (n: string) => string | undefined; socket: SocketFactory; now: () => number };

async function authorized(admin: Admin, req: Request, organizationId: string): Promise<string | { error: string; status: number }> {
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return { error: "unauthorized", status: 401 };
  const { data, error } = await admin.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return { error: "unauthorized", status: 401 };
  const { data: org } = await admin.from("lemtel_organizations").select("id").eq("id", organizationId).eq("status", "active").maybeSingle();
  if (!org?.id) return { error: "organization_not_active", status: 404 };
  const { data: platform } = await admin.from("lemtel_platform_administrators").select("user_id").eq("user_id", userId).eq("status", "active").maybeSingle();
  if (platform?.user_id) return userId;
  const { data: member } = await admin.from("lemtel_organization_memberships").select("user_id").eq("organization_id", organizationId)
    .eq("user_id", userId).eq("status", "active").in("role", ["owner", "admin"]).maybeSingle();
  return member?.user_id ? userId : { error: "forbidden", status: 403 };
}

async function audit(admin: Admin, organizationId: string, actor: string, action: string, subjectUserId: string | null, metadata: Record<string, unknown> = {}) {
  await admin.from("lemtel_pbx_connection_audit").insert({ organization_id: organizationId, actor_id: actor, action, subject_user_id: subjectUserId, metadata });
}

const deliveryEnabled = (env: Deps["env"]) => env("LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY") === "enabled";

export async function getConnection(d: Deps, organizationId: string) {
  const { admin, env } = d;
  const [{ data: conn }, { data: secrets }, { data: assignments }, { data: members }] = await Promise.all([
    admin.from("lemtel_pbx_connections").select("*").eq("organization_id", organizationId).maybeSingle(),
    admin.from("lemtel_pbx_connection_secrets").select("secret_kind,set_at").eq("organization_id", organizationId),
    admin.from("lemtel_pbx_extension_assignments").select("user_id,extension,auth_username,display_name,is_test,credential_set_at,credential_revision,state,sip_password_ciphertext").eq("organization_id", organizationId).order("extension"),
    admin.from("lemtel_organization_memberships").select("user_id,role").eq("organization_id", organizationId).eq("status", "active").limit(500),
  ]);
  const row = rowFromDb(conn ?? null);
  const people = new Map<string, { email: string; name: string; role: string }>();
  for (const m of (members ?? []) as Array<{ user_id: string; role: string }>) {
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    const u = data?.user;
    if (u?.email) people.set(m.user_id, { email: u.email, name: String(u.user_metadata?.full_name || u.email), role: m.role });
  }
  const secretState = Object.fromEntries(SECRET_KINDS.map((k) => {
    const s = ((secrets ?? []) as Array<{ secret_kind: string; set_at: string }>).find((x) => x.secret_kind === k);
    return [k, { set: Boolean(s), setAt: s?.set_at ?? null }];
  }));
  return {
    connection: row,
    secrets: secretState,
    assignments: ((assignments ?? []) as Array<Record<string, unknown>>).map((a) => ({
      userId: a.user_id, email: people.get(String(a.user_id))?.email ?? null, userName: people.get(String(a.user_id))?.name ?? null,
      extension: a.extension, authUsername: a.auth_username, displayName: a.display_name, isTest: a.is_test, state: a.state,
      credentialSet: Boolean(a.sip_password_ciphertext), credentialSetAt: a.credential_set_at, credentialRevision: a.credential_revision,
    })),
    members: [...people.entries()].map(([userId, p]) => ({ userId, email: p.email, name: p.name, role: p.role })),
    activationBlocker: activationBlocker(row, d.now()),
    serverReadiness: {
      encryptionKeyConfigured: Boolean(await loadSecretKey(env)),
      credentialDeliveryEnabled: deliveryEnabled(env),
    },
  };
}

export async function runValidation(d: Deps, organizationId: string, actor: string) {
  const { admin } = d;
  const { data: conn } = await admin.from("lemtel_pbx_connections").select("*").eq("organization_id", organizationId).maybeSingle();
  const row = rowFromDb(conn ?? null);
  if (!row) return { error: "connection_not_configured", status: 409 };
  const key = await loadSecretKey(d.env);
  const checks: ValidationCheck[] = await optionsPing(d.socket, row.wssUrl, row.sipDomain);
  const { data: tests } = await admin.from("lemtel_pbx_extension_assignments").select("user_id,extension,auth_username,sip_password_ciphertext")
    .eq("organization_id", organizationId).eq("is_test", true).eq("state", "assigned").not("sip_password_ciphertext", "is", null).order("extension").limit(2);
  if (!key) checks.push({ key: "server_encryption_key", status: "failed", detail: "LEMTEL_PBX_SECRET_ENCRYPTION_KEY_missing" });
  else if (!tests?.length) checks.push({ key: "register_test_extension", status: "failed", detail: "no_test_extension_with_credential" });
  else if (checks[0].status === "ok") {
    for (const t of tests as Array<Record<string, string>>) {
      const password = await openSecret(key, t.sip_password_ciphertext, extensionAad(organizationId, t.user_id, t.extension));
      checks.push(password
        ? await registrationProbe(d.socket, row.wssUrl, row.sipDomain, t.extension, t.auth_username ?? t.extension, password)
        : { key: `register_${t.extension}`, status: "failed", detail: "credential_unreadable_reenter_it" });
    }
  } else checks.push({ key: "register_test_extension", status: "skipped", detail: "wss_not_open" });
  const turnSet = (await admin.from("lemtel_pbx_connection_secrets").select("secret_kind").eq("organization_id", organizationId).eq("secret_kind", "turn_shared_secret")).data?.length;
  checks.push(row.turnUrls.length && turnSet ? { key: "turn_relay", status: "ok", detail: "configured_short_lived_credentials" }
    : { key: "turn_relay", status: "skipped", detail: row.turnUrls.length ? "turn_secret_missing" : "turn_not_configured_media_may_fail_behind_nat" });
  const report = summarize(checks, new Date(d.now()));
  const patch: Record<string, unknown> = { last_validation: report, validated_at: report.passed ? report.checkedAt : null };
  if (row.state === "draft" && report.passed) patch.state = "validated";
  if (row.state === "validated" && !report.passed) patch.state = "draft";
  await admin.from("lemtel_pbx_connections").update(patch).eq("organization_id", organizationId);
  await audit(admin, organizationId, actor, "validation_run", null, { passed: report.passed, checks: checks.map((c) => `${c.key}:${c.status}`) });
  return { report };
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  let raw: unknown;
  try { raw = await req.json(); } catch { return respond({ error: "invalid_json" }, 400); }
  const body = validateBody(raw);
  if ("error" in body) return respond({ error: body.error }, 400);
  const actor = await authorized(d.admin, req, body.organizationId);
  if (typeof actor !== "string") return respond({ error: actor.error }, actor.status);
  const { admin } = d;
  const org = body.organizationId;

  if (body.action === "get_connection") return respond(await getConnection(d, org));

  if (body.action === "save_settings") {
    const s = body.settings;
    const values = { organization_id: org, vendor: "fusionpbx", sip_domain: s.sipDomain, pbx_host: s.pbxHost, sip_transport: s.sipTransport, sip_port: s.sipPort,
      wss_url: s.wssUrl, outbound_proxy: s.outboundProxy, stun_urls: s.stunUrls, turn_urls: s.turnUrls, registration_expires: s.registrationExpires,
      codecs: s.codecs, srtp_mode: s.srtpMode, management_mode: s.managementMode, management_base_url: s.managementBaseUrl, updated_by: actor };
    const { error } = await admin.from("lemtel_pbx_connections").upsert(values, { onConflict: "organization_id" });
    if (error) return respond({ error: "settings_save_failed" }, 503);
    await audit(admin, org, actor, "settings_saved", null, { sipDomain: s.sipDomain, wssHost: new URL(s.wssUrl).host });
    return respond({ ok: true, ...(await getConnection(d, org)) });
  }

  if (body.action === "set_secret" || body.action === "clear_secret") {
    const { data: conn } = await admin.from("lemtel_pbx_connections").select("organization_id").eq("organization_id", org).maybeSingle();
    if (!conn) return respond({ error: "save_settings_first" }, 409);
    if (body.action === "clear_secret") {
      await admin.from("lemtel_pbx_connection_secrets").delete().eq("organization_id", org).eq("secret_kind", body.kind);
      await audit(admin, org, actor, "secret_cleared", null, { kind: body.kind });
      return respond({ ok: true });
    }
    const key = await loadSecretKey(d.env);
    if (!key) return respond({ error: "server_encryption_key_missing" }, 503);
    const ciphertext = await sealSecret(key, body.value, secretAad(org, body.kind));
    const { error } = await admin.from("lemtel_pbx_connection_secrets").upsert({ organization_id: org, secret_kind: body.kind, ciphertext, set_at: new Date(d.now()).toISOString(), set_by: actor }, { onConflict: "organization_id,secret_kind" });
    if (error) return respond({ error: "secret_save_failed" }, 503);
    await audit(admin, org, actor, "secret_set", null, { kind: body.kind });
    return respond({ ok: true, kind: body.kind, set: true });
  }

  if (body.action === "assign_extension") {
    const a = body.assignment as Exclude<ReturnType<typeof parseAssignment>, { error: string }>;
    const { data: member } = await admin.from("lemtel_organization_memberships").select("user_id").eq("organization_id", org).eq("user_id", a.userId).eq("status", "active").maybeSingle();
    if (!member?.user_id) return respond({ error: "user_not_active_member" }, 409);
    const { data: taken } = await admin.from("lemtel_pbx_extension_assignments").select("user_id").eq("organization_id", org).eq("extension", a.extension).maybeSingle();
    if (taken?.user_id && taken.user_id !== a.userId) return respond({ error: "extension_already_assigned" }, 409);
    const { data: previous } = await admin.from("lemtel_pbx_extension_assignments").select("extension,sip_password_ciphertext,credential_revision").eq("organization_id", org).eq("user_id", a.userId).maybeSingle();
    const values: Record<string, unknown> = { organization_id: org, user_id: a.userId, extension: a.extension, auth_username: a.authUsername, display_name: a.displayName,
      is_test: a.isTest, state: "assigned", updated_by: actor, updated_at: new Date(d.now()).toISOString() };
    // A credential is bound to (organization, user, extension): changing the extension without a new password drops it.
    if (previous && previous.extension !== a.extension && !body.sipPassword) { values.sip_password_ciphertext = null; values.credential_set_at = null; }
    if (body.sipPassword) {
      const key = await loadSecretKey(d.env);
      if (!key) return respond({ error: "server_encryption_key_missing" }, 503);
      values.sip_password_ciphertext = await sealSecret(key, body.sipPassword, extensionAad(org, a.userId, a.extension));
      values.credential_set_at = new Date(d.now()).toISOString();
      values.credential_revision = Number(previous?.credential_revision ?? 0) + 1;
    }
    const { error } = await admin.from("lemtel_pbx_extension_assignments").upsert(values, { onConflict: "organization_id,user_id" });
    if (error) return respond({ error: "assignment_save_failed" }, 503);
    await audit(admin, org, actor, body.sipPassword ? "extension_credential_set" : "extension_assigned", a.userId, { extension: a.extension, isTest: a.isTest });
    return respond({ ok: true, ...(await getConnection(d, org)) });
  }

  if (body.action === "unassign_extension") {
    await admin.from("lemtel_pbx_extension_assignments").delete().eq("organization_id", org).eq("user_id", body.userId);
    await audit(admin, org, actor, "extension_unassigned", body.userId);
    return respond({ ok: true, ...(await getConnection(d, org)) });
  }

  if (body.action === "validate") {
    const r = await runValidation(d, org, actor);
    if ("error" in r) return respond({ error: r.error }, r.status);
    return respond({ ok: true, report: r.report, ...(await getConnection(d, org)) });
  }

  // set_state
  const { data: conn } = await admin.from("lemtel_pbx_connections").select("*").eq("organization_id", org).maybeSingle();
  const row = rowFromDb(conn ?? null);
  if (body.state === "active") {
    const blocker = activationBlocker(row, d.now());
    if (blocker) return respond({ error: blocker }, 409);
    await admin.from("lemtel_pbx_connections").update({ state: "active", activated_at: new Date(d.now()).toISOString() }).eq("organization_id", org);
    await audit(admin, org, actor, "connection_activated", null);
  } else {
    if (!row) return respond({ error: "connection_not_configured" }, 409);
    await admin.from("lemtel_pbx_connections").update({ state: body.state === "suspended" ? "suspended" : "draft" }).eq("organization_id", org);
    await audit(admin, org, actor, "connection_suspended", null, { to: body.state });
  }
  return respond({ ok: true, ...(await getConnection(d, org)) });
}

if (import.meta.main) {
  Deno.serve((req) => {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !serviceRoleKey) return respond({ error: "server_not_configured" }, 503);
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return handle(req, { admin, env: (n) => Deno.env.get(n), socket: (u, p) => new WebSocket(u, p) as unknown as ReturnType<SocketFactory>, now: Date.now });
  });
}
