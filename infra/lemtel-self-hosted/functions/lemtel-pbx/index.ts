// Lemtel telephony gateway — the only path from the portal / apps to FusionPBX management (phases 8.1–8.7).
// Roles: platform administrator (every organization + global resources: gateways, SIP profiles, domains),
// organization owner/admin (their domain only), member (self-service on their own extension only).
// FusionPBX credentials stay server-side (decrypted per request from lemtel_pbx_connection_secrets).
// Writes are refused until a platform administrator switches "management writes" on for the organization
// (agreement of the PBX owners, phase 8.8). Every write, live action and refusal is audited (never a value).
import { createClient } from "npm:@supabase/supabase-js@2";
import { extensionAad, isInvalid as isInvalidSetting, loadSecretKey, openSecret, rowFromDb, sealSecret, secretAad } from "../_shared/lemtelPbxConnection.ts";
import {
  createResource, deleteResource, deleteVoicemailMessage, FusionPbxClient, gatewayControl, gatewayStatus, getResource, hangup, isInvalid, isUuid,
  listResource, liveChannels, normalizeCdr, originate, PbxError, projectRow, registrations, resetVoicemail, RESOURCES, SELF_FORWARD_FIELDS, transfer,
  updateResource, validateValues, voicemailMessages, type Fetch, type Resource,
} from "../_shared/lemtelFusionPbx.ts";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
void isInvalidSetting;

// deno-lint-ignore no-explicit-any
type Admin = any;
export type Deps = { admin: Admin; env: (n: string) => string | undefined; fetch: Fetch; now: () => number };
export type Role = "platform" | "owner" | "admin" | "member";
type Actor = { userId: string; role: Role };

const ACTIONS = new Set([
  "capabilities", "test_management", "set_management_writes",
  "resource_list", "resource_get", "resource_create", "resource_update", "resource_delete",
  "voicemail_messages", "voicemail_message_delete", "voicemail_reset",
  "cdr_sync", "cdr_list", "cdr_export", "cdr_stats", "recording_audio", "voicemail_audio",
  "live_calls", "call_hangup", "call_transfer", "call_eavesdrop", "registrations", "gateways_status", "gateway_control",
  "self_overview", "self_update_forwarding", "self_voicemail_pin", "self_voicemail_delete", "self_click_to_call",
]);
const ADMIN_ACTIONS = new Set(["test_management", "resource_list", "resource_get", "resource_create", "resource_update", "resource_delete", "voicemail_messages",
  "voicemail_message_delete", "voicemail_reset", "cdr_sync", "cdr_export", "cdr_stats", "live_calls", "call_hangup", "call_transfer", "call_eavesdrop", "registrations"]);
const PLATFORM_ACTIONS = new Set(["set_management_writes", "gateways_status", "gateway_control"]);
const WRITE_ACTIONS = new Set(["resource_create", "resource_update", "resource_delete", "voicemail_message_delete", "voicemail_reset", "call_hangup", "call_transfer",
  "call_eavesdrop", "gateway_control", "self_update_forwarding", "self_voicemail_pin", "self_voicemail_delete", "self_click_to_call"]);

type Body = Record<string, unknown> & { action: string; organizationId: string };
const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number, dflt: number) => (v === undefined ? dflt : typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : NaN);
const isoOr = (v: unknown, dflt: Date) => (v === undefined ? dflt : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

export function parseBody(raw: unknown): Body | { error: string } {
  if (!plain(raw) || typeof raw.action !== "string" || !ACTIONS.has(raw.action)) return { error: "invalid_action" };
  if (!isUuid(raw.organizationId)) return { error: "invalid_organization" };
  if (JSON.stringify(raw).length > 20_000) return { error: "request_too_large" };
  return { ...raw, organizationId: raw.organizationId.toLowerCase() } as Body;
}

async function resolveActor(admin: Admin, req: Request, organizationId: string): Promise<Actor | { error: string; status: number }> {
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return { error: "unauthorized", status: 401 };
  const { data, error } = await admin.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return { error: "unauthorized", status: 401 };
  const { data: org } = await admin.from("lemtel_organizations").select("id").eq("id", organizationId).eq("status", "active").maybeSingle();
  if (!org?.id) return { error: "organization_not_active", status: 404 };
  const { data: platform } = await admin.from("lemtel_platform_administrators").select("user_id").eq("user_id", userId).eq("status", "active").maybeSingle();
  if (platform?.user_id) return { userId, role: "platform" };
  const { data: member } = await admin.from("lemtel_organization_memberships").select("role").eq("organization_id", organizationId).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (!member?.role) return { error: "forbidden", status: 403 };
  return { userId, role: member.role as Role };
}

type Connection = { row: NonNullable<ReturnType<typeof rowFromDb>>; writesEnabled: boolean; verifiedAt: string | null; domainName: string | null };
async function loadConnection(admin: Admin, organizationId: string): Promise<Connection | null> {
  const { data } = await admin.from("lemtel_pbx_connections").select("*").eq("organization_id", organizationId).maybeSingle();
  const row = rowFromDb(data ?? null);
  if (!row) return null;
  return { row, writesEnabled: data.management_writes_enabled === true, verifiedAt: data.management_verified_at ?? null, domainName: data.management_domain_name ?? null };
}

async function clientFor(d: Deps, organizationId: string, conn: Connection | null): Promise<FusionPbxClient> {
  if (!conn || conn.row.managementMode !== "fusionpbx_api" || !conn.row.managementBaseUrl || !conn.row.managementDomainUuid) throw new PbxError("management_not_configured", 409);
  const key = await loadSecretKey(d.env);
  if (!key) throw new PbxError("server_encryption_key_missing", 503);
  const { data: secrets } = await d.admin.from("lemtel_pbx_connection_secrets").select("secret_kind,ciphertext").eq("organization_id", organizationId)
    .in("secret_kind", ["fusionpbx_api_key", "fusionpbx_web_password"]);
  const sealed = (kind: string) => ((secrets ?? []) as Array<{ secret_kind: string; ciphertext: string }>).find((s) => s.secret_kind === kind)?.ciphertext;
  const apiSealed = sealed("fusionpbx_api_key");
  if (!apiSealed) throw new PbxError("fusionpbx_api_key_missing", 409);
  const apiKey = await openSecret(key, apiSealed, secretAad(organizationId, "fusionpbx_api_key"));
  if (!apiKey) throw new PbxError("fusionpbx_api_key_unreadable_reenter_it", 409);
  const webSealed = sealed("fusionpbx_web_password");
  const webPassword = webSealed ? await openSecret(key, webSealed, secretAad(organizationId, "fusionpbx_web_password")) : null;
  return new FusionPbxClient({ baseUrl: conn.row.managementBaseUrl, apiKey, username: conn.row.managementUsername, domainUuid: conn.row.managementDomainUuid, domainName: conn.domainName, webPassword }, d.fetch);
}

async function audit(admin: Admin, organizationId: string, actor: string, action: string, outcome: "ok" | "refused" | "failed", resource: string | null = null, resourceUuid: string | null = null, metadata: Record<string, unknown> = {}) {
  await admin.from("lemtel_pbx_operation_audit").insert({ organization_id: organizationId, actor_id: actor, action: action.slice(0, 48), resource, resource_uuid: isUuid(resourceUuid) ? resourceUuid : null, outcome, metadata });
}

function resourceFor(key: unknown, actor: Actor): Resource | { error: string; status: number } {
  if (typeof key !== "string" || !Object.hasOwn(RESOURCES, key)) return { error: "unknown_resource", status: 400 };
  const r = RESOURCES[key];
  if (r.scope === "global" && actor.role !== "platform") return { error: "forbidden", status: 403 };
  return r;
}

async function ownAssignment(admin: Admin, organizationId: string, userId: string): Promise<{ extension: string } | null> {
  const { data } = await admin.from("lemtel_pbx_extension_assignments").select("extension,state").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
  return data?.extension && data.state === "assigned" ? { extension: String(data.extension) } : null;
}

async function findByNumber(c: FusionPbxClient, resource: Resource, field: string, value: string) {
  const rows = await c.list(resource.path, resource.path, { domain_uuid: c.domainUuid, [field]: value, limit: "5", offset: "0" });
  return rows.find((r) => r[field] === value && (r.domain_uuid === undefined || r.domain_uuid === c.domainUuid)) ?? null;
}

/** Refuses a binding before anything is written to FusionPBX (inactive member, extension bound to someone else). */
async function bindPrecheck(d: Deps, org: string, extension: string | null, userId: string) {
  const { data: member } = await d.admin.from("lemtel_organization_memberships").select("user_id").eq("organization_id", org).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (!member?.user_id) throw new PbxError("user_not_active_member", 409);
  if (!extension) return;
  const { data: taken } = await d.admin.from("lemtel_pbx_extension_assignments").select("user_id").eq("organization_id", org).eq("extension", extension).maybeSingle();
  if (taken?.user_id && taken.user_id !== userId) throw new PbxError("extension_already_assigned", 409);
}

/** Keeps the apps' provisioning in step with FusionPBX: an extension created / re-keyed here is (re)bound to its Lemtel
 *  user with the same SIP password sealed for that (organization, user, extension) — so Mobile / Desktop just work. */
async function bindExtension(d: Deps, org: string, actor: string, extension: string, password: string | null, assignUserId: string | null): Promise<string | null> {
  const now = new Date(d.now()).toISOString();
  let userId = assignUserId;
  if (userId) {
    await bindPrecheck(d, org, extension, userId);
  } else {
    const { data: bound } = await d.admin.from("lemtel_pbx_extension_assignments").select("user_id").eq("organization_id", org).eq("extension", extension).maybeSingle();
    userId = bound?.user_id ?? null;
    if (!userId || !password) return null;
  }
  const { data: previous } = await d.admin.from("lemtel_pbx_extension_assignments").select("extension,credential_revision").eq("organization_id", org).eq("user_id", userId).maybeSingle();
  const values: Record<string, unknown> = { organization_id: org, user_id: userId, extension, state: "assigned", updated_by: actor, updated_at: now };
  if (previous && previous.extension !== extension && !password) { values.sip_password_ciphertext = null; values.credential_set_at = null; }
  if (password) {
    const key = await loadSecretKey(d.env);
    if (!key) throw new PbxError("server_encryption_key_missing", 503);
    values.sip_password_ciphertext = await sealSecret(key, password, extensionAad(org, userId, extension));
    values.credential_set_at = now;
    values.credential_revision = Number(previous?.credential_revision ?? 0) + 1;
  }
  await d.admin.from("lemtel_pbx_extension_assignments").upsert(values, { onConflict: "organization_id,user_id" });
  return userId;
}

// ─── CDR synchronization and queries (local copy) ─────────────────────────────────────────────────────────────
export async function syncCdr(d: Deps, organizationId: string, c: FusionPbxClient, budgetMs = 15_000, pageSize = 500) {
  const started = d.now();
  const { data: st } = await d.admin.from("lemtel_pbx_sync_state").select("cursor_offset,rows_seen").eq("organization_id", organizationId).eq("resource", "cdr").maybeSingle();
  let offset = Number(st?.cursor_offset ?? 0), seen = 0, wrapped = false, pages = 0;
  while (d.now() - started < budgetMs && pages < 20) {
    const rows = await c.list("xml_cdr", "xml_cdr", { domain_uuid: c.domainUuid, limit: String(pageSize), offset: String(offset) });
    pages++;
    const normalized = rows.map((r) => normalizeCdr(organizationId, r, c.domainUuid)).filter((x): x is NonNullable<typeof x> => x !== null);
    if (normalized.length) await d.admin.from("lemtel_pbx_cdr").upsert(normalized.map((n) => ({ ...n, synced_at: new Date(d.now()).toISOString() })), { onConflict: "organization_id,xml_cdr_uuid" });
    seen += normalized.length;
    if (rows.length < pageSize) { offset = 0; wrapped = true; break; }
    offset += pageSize;
  }
  await d.admin.from("lemtel_pbx_sync_state").upsert({ organization_id: organizationId, resource: "cdr", cursor_offset: offset, last_run_at: new Date(d.now()).toISOString(),
    last_outcome: wrapped ? "complete_pass" : "partial_pass", rows_seen: seen }, { onConflict: "organization_id,resource" });
  return { rowsSeen: seen, pages, completePass: wrapped };
}

const CDR_COLUMNS = "xml_cdr_uuid,direction,caller_id_name,caller_id_number,destination_number,start_at,answer_at,end_at,duration,billsec,hangup_cause,missed_call,record_name";
type CdrFilter = { from: Date; to: Date; direction?: string; search?: string; missedOnly?: boolean; recordedOnly?: boolean; number?: string; limit: number; offset: number };

export function parseCdrFilter(b: Record<string, unknown>, now: number, maxLimit = 500): CdrFilter | { error: string } {
  const to = isoOr(b.to, new Date(now)); const from = isoOr(b.from, new Date(now - 7 * 86400_000));
  if (!to || !from || from >= to || to.getTime() - from.getTime() > 400 * 86400_000) return { error: "invalid_period" };
  const limit = intIn(b.limit, 1, maxLimit, 100), offset = intIn(b.offset, 0, 1_000_000, 0);
  if (Number.isNaN(limit) || Number.isNaN(offset)) return { error: "invalid_paging" };
  if (b.direction !== undefined && !["inbound", "outbound", "local"].includes(String(b.direction))) return { error: "invalid_direction" };
  if (b.search !== undefined && (typeof b.search !== "string" || !/^[0-9A-Za-z+ ._-]{0,40}$/.test(b.search))) return { error: "invalid_search" };
  return { from, to, direction: b.direction as string | undefined, search: (b.search as string | undefined)?.trim() || undefined, missedOnly: b.missedOnly === true, recordedOnly: b.recordedOnly === true, limit, offset };
}

async function queryCdr(admin: Admin, organizationId: string, f: CdrFilter) {
  let q = admin.from("lemtel_pbx_cdr").select(CDR_COLUMNS, { count: "exact" }).eq("organization_id", organizationId)
    .gte("start_at", f.from.toISOString()).lt("start_at", f.to.toISOString()).order("start_at", { ascending: false }).range(f.offset, f.offset + f.limit - 1);
  if (f.direction) q = q.eq("direction", f.direction);
  if (f.missedOnly) q = q.eq("missed_call", true);
  if (f.recordedOnly) q = q.not("record_name", "is", null);
  if (f.number) q = q.or(`caller_id_number.eq.${f.number},destination_number.eq.${f.number}`);
  if (f.search) { const s = f.search.replace(/[%,()]/g, ""); q = q.or(`caller_id_number.ilike.%${s}%,destination_number.ilike.%${s}%,caller_id_name.ilike.%${s}%`); }
  const { data, count, error } = await q;
  if (error) throw new PbxError("cdr_query_failed", 503);
  return { records: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.xml_cdr_uuid, direction: r.direction, callerName: r.caller_id_name, callerNumber: r.caller_id_number, destination: r.destination_number,
    startAt: r.start_at, answerAt: r.answer_at, endAt: r.end_at, duration: r.duration, billsec: r.billsec, hangupCause: r.hangup_cause,
    missed: r.missed_call === true, hasRecording: Boolean(r.record_name),
  })), total: count ?? 0 };
}

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
export function cdrCsv(records: Array<Record<string, unknown>>) {
  const cols = ["startAt", "direction", "callerName", "callerNumber", "destination", "duration", "billsec", "hangupCause", "missed", "hasRecording"];
  return [cols.join(","), ...records.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
}

async function maybeAutoSync(d: Deps, organizationId: string, conn: Connection | null) {
  const { data: st } = await d.admin.from("lemtel_pbx_sync_state").select("last_run_at").eq("organization_id", organizationId).eq("resource", "cdr").maybeSingle();
  if (st?.last_run_at && d.now() - Date.parse(st.last_run_at) < 120_000) return null;
  try { return await syncCdr(d, organizationId, await clientFor(d, organizationId, conn), 6_000); } catch { return null; }
}

// ─── Handler ──────────────────────────────────────────────────────────────────────────────────────────────────
const liveCache = new Map<string, { at: number; value: unknown }>();

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  let raw: unknown;
  try { raw = await req.json(); } catch { return respond({ error: "invalid_json" }, 400); }
  const body = parseBody(raw);
  if ("error" in body) return respond({ error: body.error }, 400);
  const actor = await resolveActor(d.admin, req, body.organizationId);
  if ("error" in actor) return respond({ error: actor.error }, actor.status);
  const org = body.organizationId;
  const isAdmin = actor.role === "platform" || actor.role === "owner" || actor.role === "admin";
  if (PLATFORM_ACTIONS.has(body.action) && actor.role !== "platform") { await audit(d.admin, org, actor.userId, body.action, "refused"); return respond({ error: "forbidden" }, 403); }
  if (ADMIN_ACTIONS.has(body.action) && !isAdmin) { await audit(d.admin, org, actor.userId, body.action, "refused"); return respond({ error: "forbidden" }, 403); }
  const conn = await loadConnection(d.admin, org);

  // Every FusionPBX write (admin, live action or self-service) needs the platform switch (PBX owners' agreement).
  const selfService = body.action.startsWith("self_");
  if (WRITE_ACTIONS.has(body.action) && !selfService && body.action !== "gateway_control" && !conn?.writesEnabled) {
    await audit(d.admin, org, actor.userId, body.action, "refused", null, null, { reason: "management_writes_disabled" });
    return respond({ error: "management_writes_disabled" }, 409);
  }
  if (selfService && body.action !== "self_overview" && !conn?.writesEnabled) return respond({ error: "management_writes_disabled" }, 409);

  try {
    switch (body.action) {
      case "capabilities": {
        const assignment = await ownAssignment(d.admin, org, actor.userId);
        const { data: sync } = await d.admin.from("lemtel_pbx_sync_state").select("last_run_at,last_outcome").eq("organization_id", org).eq("resource", "cdr").maybeSingle();
        const catalog = Object.values(RESOURCES).filter((r) => r.scope === "domain" || actor.role === "platform").map((r) => ({
          key: r.key, scope: r.scope, label: r.label, uuid: r.uuid, ops: r.ops, read: r.read, parent: r.parent ?? null, required: r.required ?? [],
          write: Object.fromEntries(Object.entries(r.write).map(([k, f]) => [k, f.t === "enum" ? { t: f.t, values: f.values } : f.t === "int" ? { t: f.t, min: f.min, max: f.max } : f.t === "str" ? { t: f.t, max: f.max } : { t: f.t }])),
        }));
        return respond({
          role: actor.role, configured: Boolean(conn), managementMode: conn?.row.managementMode ?? "none",
          managementReady: Boolean(conn?.row.managementMode === "fusionpbx_api" && conn.row.managementBaseUrl && conn.row.managementDomainUuid),
          verifiedAt: conn?.verifiedAt ?? null, domainName: conn?.domainName ?? null, writesEnabled: Boolean(conn?.writesEnabled),
          connectionState: conn?.row.state ?? null, selfExtension: assignment?.extension ?? null, cdrSync: sync ?? null, catalog: isAdmin ? catalog : [],
        });
      }
      case "test_management": {
        const c = await clientFor(d, org, conn);
        const domain = await c.get("domains", "domains", c.domainUuid);
        const name = typeof domain?.domain_name === "string" ? domain.domain_name.toLowerCase() : null;
        if (!name || !/^[a-z0-9.-]{3,253}$/.test(name)) throw new PbxError("domain_uuid_not_found_on_pbx", 409);
        const ext = await c.list("extensions", "extensions", { domain_uuid: c.domainUuid, limit: "1", offset: "0" });
        await d.admin.from("lemtel_pbx_connections").update({ management_verified_at: new Date(d.now()).toISOString(), management_domain_name: name }).eq("organization_id", org);
        await audit(d.admin, org, actor.userId, "test_management", "ok");
        return respond({ ok: true, domainName: name, extensionsReadable: Array.isArray(ext), writesEnabled: Boolean(conn?.writesEnabled) });
      }
      case "set_management_writes": {
        if (typeof body.enabled !== "boolean" || (body.enabled && body.confirm !== "PBX_OWNERS_AGREED")) return respond({ error: "invalid_request" }, 400);
        if (body.enabled && !conn?.verifiedAt) return respond({ error: "test_management_first" }, 409);
        await d.admin.from("lemtel_pbx_connections").update({ management_writes_enabled: body.enabled }).eq("organization_id", org);
        await audit(d.admin, org, actor.userId, body.enabled ? "management_writes_enabled" : "management_writes_disabled", "ok");
        return respond({ ok: true, writesEnabled: body.enabled });
      }

      case "resource_list": case "resource_get": case "resource_create": case "resource_update": case "resource_delete": {
        const r = resourceFor(body.resource, actor);
        if ("error" in r) return respond({ error: r.error }, r.status);
        const op = body.action.slice("resource_".length) as Resource["ops"][number];
        if (!r.ops.includes(op)) return respond({ error: "operation_not_supported" }, 400);
        const c = await clientFor(d, org, conn);
        if (op === "list") {
          const limit = intIn(body.limit, 1, 500, 200), offset = intIn(body.offset, 0, 100_000, 0);
          if (Number.isNaN(limit) || Number.isNaN(offset)) return respond({ error: "invalid_paging" }, 400);
          if (body.parentUuid !== undefined && !isUuid(body.parentUuid)) return respond({ error: "invalid_parent" }, 400);
          if (r.parent && body.parentUuid === undefined) return respond({ error: "parent_required" }, 400);
          if (body.search !== undefined && (typeof body.search !== "string" || body.search.length > 64)) return respond({ error: "invalid_search" }, 400);
          return respond({ items: await listResource(c, r, { limit, offset, parentUuid: body.parentUuid as string | undefined, search: body.search as string | undefined }) });
        }
        if (op === "get") { if (!isUuid(body.uuid)) return respond({ error: "invalid_uuid" }, 400); return respond({ item: await getResource(c, r, body.uuid) }); }
        if (op === "delete") {
          if (!isUuid(body.uuid) || body.confirm !== "DELETE") return respond({ error: "confirmation_required" }, 400);
          const before = r.key === "extensions" ? await c.get("extensions", "extensions", body.uuid) : null;
          await deleteResource(c, r, body.uuid);
          // A deleted extension no longer provisions any app.
          if (typeof before?.extension === "string") await d.admin.from("lemtel_pbx_extension_assignments").delete().eq("organization_id", org).eq("extension", before.extension);
          await audit(d.admin, org, actor.userId, "resource_delete", "ok", r.key, body.uuid);
          return respond({ ok: true });
        }
        const values = validateValues(r, body.values, op);
        if (isInvalid(values)) return respond({ error: values.error }, 400);
        const fields = Object.keys(values);
        if (body.assignUserId !== undefined && (r.key !== "extensions" || !isUuid(body.assignUserId))) return respond({ error: "invalid_assign_user" }, 400);
        const assignUserId = isUuid(body.assignUserId) ? body.assignUserId.toLowerCase() : null;
        if (op === "create") {
          if (assignUserId) await bindPrecheck(d, org, values.extension, assignUserId);
          const created = await createResource(c, r, values);
          const bound = r.key === "extensions" ? await bindExtension(d, org, actor.userId, values.extension, values.password ?? null, assignUserId) : null;
          await audit(d.admin, org, actor.userId, "resource_create", "ok", r.key, created.uuid, { fields, boundToUser: Boolean(bound) });
          return respond({ ok: true, uuid: created.uuid, boundUserId: bound });
        }
        if (!isUuid(body.uuid)) return respond({ error: "invalid_uuid" }, 400);
        if (assignUserId) {
          const current = await c.get("extensions", "extensions", body.uuid);
          await bindPrecheck(d, org, values.extension ?? (typeof current?.extension === "string" ? current.extension : null), assignUserId);
        }
        await updateResource(c, r, body.uuid, values);
        let bound: string | null = null;
        if (r.key === "extensions" && (values.password || assignUserId)) {
          const current = await c.get("extensions", "extensions", body.uuid);
          const number = values.extension ?? (typeof current?.extension === "string" ? current.extension : null);
          if (number) bound = await bindExtension(d, org, actor.userId, number, values.password ?? null, assignUserId);
        }
        await audit(d.admin, org, actor.userId, "resource_update", "ok", r.key, body.uuid, { fields, boundToUser: Boolean(bound) });
        return respond({ ok: true, boundUserId: bound });
      }

      case "voicemail_messages": {
        if (!isUuid(body.voicemailUuid)) return respond({ error: "invalid_uuid" }, 400);
        return respond({ messages: await voicemailMessages(await clientFor(d, org, conn), body.voicemailUuid) });
      }
      case "voicemail_message_delete": {
        if (!isUuid(body.voicemailUuid) || !isUuid(body.messageUuid)) return respond({ error: "invalid_uuid" }, 400);
        await deleteVoicemailMessage(await clientFor(d, org, conn), body.voicemailUuid, body.messageUuid);
        await audit(d.admin, org, actor.userId, "voicemail_message_delete", "ok", "voicemails", body.voicemailUuid);
        return respond({ ok: true });
      }
      case "voicemail_reset": {
        if (!isUuid(body.voicemailUuid) || typeof body.purge !== "boolean") return respond({ error: "invalid_request" }, 400);
        const r = await resetVoicemail(await clientFor(d, org, conn), body.voicemailUuid, body.purge);
        await audit(d.admin, org, actor.userId, "voicemail_reset", "ok", "voicemails", body.voicemailUuid, { purged: r.purged });
        // The new PIN is shown once to the administrator who must hand it to the user; Lemtel never stores it.
        return respond({ ok: true, pin: r.pin, purged: r.purged });
      }

      case "cdr_sync": {
        const r = await syncCdr(d, org, await clientFor(d, org, conn));
        await audit(d.admin, org, actor.userId, "cdr_sync", "ok", "cdr", null, r);
        return respond({ ok: true, ...r });
      }
      case "cdr_list": case "cdr_export": {
        const f = parseCdrFilter(body, d.now(), body.action === "cdr_export" ? 10_000 : 500);
        if ("error" in f) return respond({ error: f.error }, 400);
        if (!isAdmin) {
          const own = await ownAssignment(d.admin, org, actor.userId);
          if (!own) return respond({ error: "no_extension_assigned" }, 409);
          f.number = own.extension;
        }
        // Server-side, throttled (2 min) refresh of the local copy for every caller (members see fresh history too).
        const synced = await maybeAutoSync(d, org, conn);
        const result = await queryCdr(d.admin, org, f);
        if (body.action === "cdr_export") {
          await audit(d.admin, org, actor.userId, "cdr_export", "ok", "cdr", null, { rows: result.records.length });
          return new Response(cdrCsv(result.records), { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="lemtel-cdr.csv"' } });
        }
        return respond({ ...result, autoSync: synced });
      }
      case "cdr_stats": {
        const f = parseCdrFilter(body, d.now());
        if ("error" in f) return respond({ error: f.error }, 400);
        await maybeAutoSync(d, org, conn);
        const { data, error } = await d.admin.rpc("lemtel_pbx_cdr_stats", { target_organization_id: org, from_at: f.from.toISOString(), to_at: f.to.toISOString(), tz: "America/Toronto" });
        if (error) throw new PbxError("stats_unavailable", 503);
        return respond({ stats: data, from: f.from.toISOString(), to: f.to.toISOString() });
      }
      case "recording_audio": {
        if (!isUuid(body.cdrId)) return respond({ error: "invalid_uuid" }, 400);
        const { data: cdr } = await d.admin.from("lemtel_pbx_cdr").select("xml_cdr_uuid,record_name,caller_id_number,destination_number").eq("organization_id", org).eq("xml_cdr_uuid", body.cdrId.toLowerCase()).maybeSingle();
        if (!cdr?.record_name) return respond({ error: "recording_not_available" }, 404);
        if (!isAdmin) {
          const own = await ownAssignment(d.admin, org, actor.userId);
          if (!own || (cdr.caller_id_number !== own.extension && cdr.destination_number !== own.extension)) return respond({ error: "forbidden" }, 403);
        }
        const audio = await (await clientFor(d, org, conn)).recording(cdr.xml_cdr_uuid, cdr.record_name);
        await audit(d.admin, org, actor.userId, "recording_played", "ok", "cdr", cdr.xml_cdr_uuid);
        return new Response(audio.body.slice().buffer as ArrayBuffer, { headers: { "Content-Type": audio.contentType, "Cache-Control": "no-store", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff" } });
      }

      case "voicemail_audio": {
        // Admin: any mailbox of the domain. Member: only the mailbox of their own extension.
        if (!isUuid(body.messageUuid) || (body.voicemailUuid !== undefined && !isUuid(body.voicemailUuid))) return respond({ error: "invalid_uuid" }, 400);
        const c = await clientFor(d, org, conn);
        let vm: Record<string, unknown> | null = null;
        if (isAdmin && isUuid(body.voicemailUuid)) vm = await c.get("voicemails", "voicemails", body.voicemailUuid);
        else {
          const own = await ownAssignment(d.admin, org, actor.userId);
          if (!own) return respond({ error: "no_extension_assigned" }, 409);
          vm = await findByNumber(c, RESOURCES.voicemails, "voicemail_id", own.extension);
        }
        if (!vm || !isUuid(vm.voicemail_uuid) || (vm.domain_uuid !== undefined && vm.domain_uuid !== c.domainUuid)) return respond({ error: "voicemail_not_found" }, 404);
        const messages = await voicemailMessages(c, vm.voicemail_uuid);
        if (!messages.some((m) => m.uuid === String(body.messageUuid).toLowerCase())) return respond({ error: "not_found" }, 404);
        const audio = await c.voicemailAudio(String(vm.voicemail_id), vm.voicemail_uuid, String(body.messageUuid).toLowerCase());
        await audit(d.admin, org, actor.userId, "voicemail_played", "ok", "voicemails", vm.voicemail_uuid);
        return new Response(audio.body.slice().buffer as ArrayBuffer, { headers: { "Content-Type": audio.contentType, "Cache-Control": "no-store", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff" } });
      }
      case "live_calls": case "registrations": {
        const key = `${org}:${body.action}`;
        const hit = liveCache.get(key);
        if (hit && d.now() - hit.at < (body.action === "live_calls" ? 3_000 : 15_000)) return respond(hit.value);
        const c = await clientFor(d, org, conn);
        const value = body.action === "live_calls" ? { calls: await liveChannels(c) } : { registrations: await registrations(c) };
        liveCache.set(key, { at: d.now(), value });
        return respond(value);
      }
      case "call_hangup": {
        if (!isUuid(body.uuid)) return respond({ error: "invalid_uuid" }, 400);
        await hangup(await clientFor(d, org, conn), body.uuid);
        liveCache.delete(`${org}:live_calls`);
        await audit(d.admin, org, actor.userId, "call_hangup", "ok", "live_call", body.uuid);
        return respond({ ok: true });
      }
      case "call_transfer": {
        if (!isUuid(body.uuid) || typeof body.destination !== "string") return respond({ error: "invalid_request" }, 400);
        await transfer(await clientFor(d, org, conn), body.uuid, body.destination);
        liveCache.delete(`${org}:live_calls`);
        await audit(d.admin, org, actor.userId, "call_transfer", "ok", "live_call", body.uuid);
        return respond({ ok: true });
      }
      case "call_eavesdrop": {
        if (!isUuid(body.uuid) || !["listen", "whisper", "barge"].includes(String(body.mode))) return respond({ error: "invalid_request" }, 400);
        const own = await ownAssignment(d.admin, org, actor.userId);
        if (!own) return respond({ error: "no_extension_assigned" }, 409);
        await originate(await clientFor(d, org, conn), own.extension, { eavesdrop: body.uuid, mode: body.mode as "listen" | "whisper" | "barge" });
        await audit(d.admin, org, actor.userId, "call_eavesdrop", "ok", "live_call", body.uuid, { mode: body.mode });
        return respond({ ok: true, ringing: own.extension });
      }
      case "gateways_status": return respond({ status: await gatewayStatus(await clientFor(d, org, conn)) });
      case "gateway_control": {
        if (!isUuid(body.uuid) || (body.op !== "start" && body.op !== "stop")) return respond({ error: "invalid_request" }, 400);
        await gatewayControl(await clientFor(d, org, conn), body.uuid, body.op);
        await audit(d.admin, org, actor.userId, `gateway_${body.op}`, "ok", "gateways", body.uuid);
        return respond({ ok: true });
      }

      // ─── Self-service (any active member with an assigned extension) ───
      case "self_overview": case "self_update_forwarding": case "self_voicemail_pin": case "self_voicemail_delete": case "self_click_to_call": {
        const own = await ownAssignment(d.admin, org, actor.userId);
        if (!own) return respond({ error: "no_extension_assigned" }, 409);
        const c = await clientFor(d, org, conn);
        const extRow = await findByNumber(c, RESOURCES.extensions, "extension", own.extension);
        if (!extRow || !isUuid(extRow.extension_uuid)) return respond({ error: "extension_not_found_on_pbx" }, 404);
        const vmRow = await findByNumber(c, RESOURCES.voicemails, "voicemail_id", own.extension);
        if (body.action === "self_overview") {
          const ext = projectRow(RESOURCES.extensions, extRow);
          const messages = vmRow && isUuid(vmRow.voicemail_uuid) ? await voicemailMessages(c, vmRow.voicemail_uuid) : [];
          const recent = await queryCdr(d.admin, org, { from: new Date(d.now() - 30 * 86400_000), to: new Date(d.now()), number: own.extension, limit: 50, offset: 0 });
          return respond({
            extension: own.extension, callerIdName: ext.effective_caller_id_name ?? null,
            forwarding: Object.fromEntries(SELF_FORWARD_FIELDS.map((f) => [f, ext[f] ?? null])),
            voicemail: vmRow ? { enabled: vmRow.voicemail_enabled !== "false", messages } : null,
            recentCalls: recent.records, writesEnabled: Boolean(conn?.writesEnabled),
          });
        }
        if (body.action === "self_update_forwarding") {
          const values = validateValues(RESOURCES.extensions, body.values, "update", SELF_FORWARD_FIELDS);
          if (isInvalid(values)) return respond({ error: values.error }, 400);
          await updateResource(c, RESOURCES.extensions, extRow.extension_uuid as string, values);
          await audit(d.admin, org, actor.userId, "self_update_forwarding", "ok", "extensions", extRow.extension_uuid as string, { fields: Object.keys(values) });
          return respond({ ok: true });
        }
        if (body.action === "self_voicemail_pin") {
          if (!vmRow || !isUuid(vmRow.voicemail_uuid)) return respond({ error: "voicemail_not_found" }, 404);
          const values = validateValues(RESOURCES.voicemails, { voicemail_password: body.pin }, "update", ["voicemail_password"]);
          if (isInvalid(values)) return respond({ error: "invalid_pin" }, 400);
          await updateResource(c, RESOURCES.voicemails, vmRow.voicemail_uuid, values);
          await audit(d.admin, org, actor.userId, "self_voicemail_pin", "ok", "voicemails", vmRow.voicemail_uuid);
          return respond({ ok: true });
        }
        if (body.action === "self_voicemail_delete") {
          if (!vmRow || !isUuid(vmRow.voicemail_uuid) || !isUuid(body.messageUuid)) return respond({ error: "invalid_request" }, 400);
          await deleteVoicemailMessage(c, vmRow.voicemail_uuid, body.messageUuid);
          await audit(d.admin, org, actor.userId, "self_voicemail_delete", "ok", "voicemails", vmRow.voicemail_uuid);
          return respond({ ok: true });
        }
        // self_click_to_call
        if (typeof body.destination !== "string") return respond({ error: "invalid_destination" }, 400);
        await originate(c, own.extension, { destination: body.destination });
        await audit(d.admin, org, actor.userId, "self_click_to_call", "ok");
        return respond({ ok: true, ringing: own.extension });
      }
    }
    return respond({ error: "invalid_action" }, 400);
  } catch (e) {
    if (e instanceof PbxError) {
      if (WRITE_ACTIONS.has(body.action)) await audit(d.admin, org, actor.userId, body.action, "failed", typeof body.resource === "string" && /^[a-z_]{2,48}$/.test(body.resource) ? body.resource : null, null, { code: e.code });
      return respond({ error: e.code }, e.status);
    }
    return respond({ error: "server_error" }, 500);
  }
}

if (import.meta.main) {
  Deno.serve((req) => {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !serviceRoleKey) return respond({ error: "server_not_configured" }, 503);
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return handle(req, { admin, env: (n) => Deno.env.get(n), fetch, now: Date.now });
  });
}
