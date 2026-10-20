// Lemtel ↔ FusionPBX management primitives (server only). One Lemtel organization = one FusionPBX domain_uuid.
// - Reads use the FusionPBX v7 REST API (Authorization: Basic <api key>), writes use ?key=&username= (v7 contract).
// - Every resource is declared in RESOURCES: path, uuid field, scope, readable fields and typed writable fields.
//   Anything not declared is never read out, never written, never forwarded.
// - Tenant isolation: domain_uuid is always forced on create; update/delete first read the row and refuse when it
//   does not belong to the organization's domain (FusionPBX's generic API would otherwise accept any uuid).
// - Secrets (extension password, voicemail PIN, agent password, gateway password) are write-only: reads return
//   `<field>_set: boolean`, never the value.
// - FreeSWITCH commands are a closed set built here from validated parts; no caller-supplied command text.

export type Fetch = typeof fetch;
export type PbxTarget = { baseUrl: string; apiKey: string; username: string | null; domainUuid: string; domainName: string | null; webPassword?: string | null };
export type FieldType =
  | { t: "str"; max: number; pattern?: RegExp }
  | { t: "int"; min: number; max: number }
  | { t: "bool" }
  | { t: "enum"; values: readonly string[] }
  | { t: "uuid" }
  | { t: "secret"; min: number; max: number; pattern?: RegExp };
export type Scope = "domain" | "global";
export type Resource = {
  key: string;
  path: string;
  uuid: string;
  scope: Scope;
  label: string; // field used for search / display
  read: readonly string[];
  write: Readonly<Record<string, FieldType>>;
  required?: readonly string[];
  ops: ReadonlyArray<"list" | "get" | "create" | "update" | "delete">;
  parent?: { field: string; resource: string };
  fixedFilter?: Readonly<Record<string, string>>;
  reloadXml?: boolean;
};

const S = (max: number, pattern?: RegExp): FieldType => ({ t: "str", max, pattern });
const I = (min: number, max: number): FieldType => ({ t: "int", min, max });
const B: FieldType = { t: "bool" };
const E = (...values: string[]): FieldType => ({ t: "enum", values });
const U: FieldType = { t: "uuid" };
const DIAL = /^[0-9*#+]{1,32}$/;
const EXT = /^[0-9]{2,8}$/;
const DEST = /^[A-Za-z0-9_*#+:@.\- ]{0,128}$/; // FusionPBX action data ("transfer 1001 XML domain")
const NAME = /^[^<>\r\n]{0,128}$/;
const FORWARD = ["forward_all_enabled", "forward_all_destination", "forward_busy_enabled", "forward_busy_destination",
  "forward_no_answer_enabled", "forward_no_answer_destination", "forward_user_not_registered_enabled", "forward_user_not_registered_destination", "do_not_disturb"] as const;
const FORWARD_FIELDS: Record<string, FieldType> = {
  forward_all_enabled: B, forward_all_destination: S(32, /^[0-9*#+]{0,32}$/), forward_busy_enabled: B, forward_busy_destination: S(32, /^[0-9*#+]{0,32}$/),
  forward_no_answer_enabled: B, forward_no_answer_destination: S(32, /^[0-9*#+]{0,32}$/), forward_user_not_registered_enabled: B,
  forward_user_not_registered_destination: S(32, /^[0-9*#+]{0,32}$/), do_not_disturb: B,
};
export const SELF_FORWARD_FIELDS = FORWARD;

export const TIME_CONDITION_APP_UUID = "4b821450-926b-175a-af93-a03c441818b1";

export const RESOURCES: Readonly<Record<string, Resource>> = Object.freeze({
  extensions: {
    key: "extensions", path: "extensions", uuid: "extension_uuid", scope: "domain", label: "extension", reloadXml: true,
    read: ["extension_uuid", "extension", "number_alias", "effective_caller_id_name", "effective_caller_id_number", "outbound_caller_id_name", "outbound_caller_id_number",
      "directory_full_name", "call_group", "call_timeout", "user_record", "limit_max", "toll_allow", "enabled", "description", ...FORWARD],
    write: {
      extension: S(8, EXT), number_alias: S(16, /^[0-9]{0,16}$/), effective_caller_id_name: S(64, NAME), effective_caller_id_number: S(32, /^[0-9+]{0,32}$/),
      outbound_caller_id_name: S(64, NAME), outbound_caller_id_number: S(32, /^[0-9+]{0,32}$/), directory_full_name: S(96, NAME), call_group: S(64, /^[A-Za-z0-9_,-]{0,64}$/),
      call_timeout: I(5, 300), user_record: E("", "all", "local", "inbound", "outbound"), limit_max: I(1, 50), toll_allow: S(64, /^[a-z,]{0,64}$/), enabled: B, description: S(255, NAME),
      password: { t: "secret", min: 10, max: 64, pattern: /^[A-Za-z0-9!@#%^*_+=.-]+$/ }, ...FORWARD_FIELDS,
    },
    required: ["extension"], ops: ["list", "get", "create", "update", "delete"],
  },
  voicemails: {
    key: "voicemails", path: "voicemails", uuid: "voicemail_uuid", scope: "domain", label: "voicemail_id",
    read: ["voicemail_uuid", "voicemail_id", "voicemail_mail_to", "voicemail_file", "voicemail_local_after_email", "voicemail_transcription_enabled", "voicemail_enabled", "voicemail_description"],
    write: {
      voicemail_id: S(16, /^[0-9]{2,16}$/), voicemail_mail_to: S(254, /^([^\s@<>,]+@[^\s@<>,]+)?$/), voicemail_file: E("", "attach", "link", "listen"),
      voicemail_local_after_email: B, voicemail_transcription_enabled: B, voicemail_enabled: B, voicemail_description: S(255, NAME),
      voicemail_password: { t: "secret", min: 4, max: 10, pattern: /^[0-9]+$/ },
    },
    required: ["voicemail_id"], ops: ["list", "get", "create", "update", "delete"],
  },
  devices: {
    key: "devices", path: "devices", uuid: "device_uuid", scope: "domain", label: "device_mac_address",
    read: ["device_uuid", "device_mac_address", "device_label", "device_vendor", "device_model", "device_template", "device_enabled", "device_description"],
    write: { device_mac_address: S(17, /^([0-9a-f]{12}|([0-9a-f]{2}[:-]){5}[0-9a-f]{2})$/i), device_label: S(64, NAME), device_vendor: S(32, /^[a-z0-9_-]{0,32}$/), device_model: S(64, NAME),
      device_template: S(96, /^[a-z0-9_./-]{0,96}$/), device_enabled: B, device_description: S(255, NAME) },
    required: ["device_mac_address"], ops: ["list", "get", "create", "update", "delete"],
  },
  destinations: {
    key: "destinations", path: "destinations", uuid: "destination_uuid", scope: "domain", label: "destination_number", reloadXml: true,
    read: ["destination_uuid", "destination_number", "destination_type", "destination_caller_id_name", "destination_caller_id_number", "destination_app", "destination_data", "destination_enabled", "destination_description"],
    write: { destination_number: S(32, /^[0-9+]{1,32}$/), destination_type: E("inbound", "outbound", "local"), destination_caller_id_name: S(64, NAME), destination_caller_id_number: S(32, /^[0-9+]{0,32}$/),
      destination_app: E("transfer", "bridge", "hangup", ""), destination_data: S(128, DEST), destination_enabled: B, destination_description: S(255, NAME) },
    required: ["destination_number"], ops: ["list", "get", "create", "update", "delete"],
  },
  ivr_menus: {
    key: "ivr_menus", path: "ivr_menus", uuid: "ivr_menu_uuid", scope: "domain", label: "ivr_menu_name", reloadXml: true,
    read: ["ivr_menu_uuid", "ivr_menu_name", "ivr_menu_extension", "ivr_menu_greet_long", "ivr_menu_greet_short", "ivr_menu_timeout", "ivr_menu_exit_app", "ivr_menu_exit_data",
      "ivr_menu_max_failures", "ivr_menu_max_timeouts", "ivr_menu_digit_len", "ivr_menu_direct_dial", "ivr_menu_enabled", "ivr_menu_description"],
    write: { ivr_menu_name: S(64, NAME), ivr_menu_extension: S(8, EXT), ivr_menu_greet_long: S(255, /^[^<>\r\n]{0,255}$/), ivr_menu_greet_short: S(255, /^[^<>\r\n]{0,255}$/), ivr_menu_timeout: I(1000, 60000),
      ivr_menu_exit_app: E("transfer", "hangup", ""), ivr_menu_exit_data: S(128, DEST), ivr_menu_max_failures: I(0, 10), ivr_menu_max_timeouts: I(0, 10), ivr_menu_digit_len: I(1, 8),
      ivr_menu_direct_dial: B, ivr_menu_enabled: B, ivr_menu_description: S(255, NAME) },
    required: ["ivr_menu_name", "ivr_menu_extension"], ops: ["list", "get", "create", "update", "delete"],
  },
  ivr_menu_options: {
    key: "ivr_menu_options", path: "ivr_menu_options", uuid: "ivr_menu_option_uuid", scope: "domain", label: "ivr_menu_option_digits", reloadXml: true,
    read: ["ivr_menu_option_uuid", "ivr_menu_uuid", "ivr_menu_option_digits", "ivr_menu_option_action", "ivr_menu_option_param", "ivr_menu_option_order", "ivr_menu_option_description"],
    write: { ivr_menu_uuid: U, ivr_menu_option_digits: S(8, /^[0-9*#]{1,8}$/), ivr_menu_option_action: E("menu-exec-app"), ivr_menu_option_param: S(128, DEST),
      ivr_menu_option_order: I(0, 999), ivr_menu_option_description: S(255, NAME) },
    required: ["ivr_menu_uuid", "ivr_menu_option_digits", "ivr_menu_option_param"], ops: ["list", "create", "update", "delete"], parent: { field: "ivr_menu_uuid", resource: "ivr_menus" },
  },
  ring_groups: {
    key: "ring_groups", path: "ring_groups", uuid: "ring_group_uuid", scope: "domain", label: "ring_group_name", reloadXml: true,
    read: ["ring_group_uuid", "ring_group_name", "ring_group_extension", "ring_group_strategy", "ring_group_call_timeout", "ring_group_timeout_app", "ring_group_timeout_data",
      "ring_group_caller_id_name", "ring_group_greeting", "ring_group_enabled", "ring_group_description"],
    write: { ring_group_name: S(64, NAME), ring_group_extension: S(8, EXT), ring_group_strategy: E("simultaneous", "sequence", "enterprise", "rollover", "random"),
      ring_group_call_timeout: I(5, 600), ring_group_timeout_app: E("transfer", "hangup", ""), ring_group_timeout_data: S(128, DEST), ring_group_caller_id_name: S(64, NAME),
      ring_group_greeting: S(255, /^[^<>\r\n]{0,255}$/), ring_group_enabled: B, ring_group_description: S(255, NAME) },
    required: ["ring_group_name", "ring_group_extension"], ops: ["list", "get", "create", "update", "delete"],
  },
  ring_group_destinations: {
    key: "ring_group_destinations", path: "ring_group_destinations", uuid: "ring_group_destination_uuid", scope: "domain", label: "destination_number", reloadXml: true,
    read: ["ring_group_destination_uuid", "ring_group_uuid", "destination_number", "destination_delay", "destination_timeout", "destination_prompt"],
    write: { ring_group_uuid: U, destination_number: S(32, DIAL), destination_delay: I(0, 300), destination_timeout: I(5, 300), destination_prompt: E("", "1") },
    required: ["ring_group_uuid", "destination_number"], ops: ["list", "create", "update", "delete"], parent: { field: "ring_group_uuid", resource: "ring_groups" },
  },
  call_center_queues: {
    key: "call_center_queues", path: "call_center_queues", uuid: "call_center_queue_uuid", scope: "domain", label: "queue_name", reloadXml: true,
    read: ["call_center_queue_uuid", "queue_name", "queue_extension", "queue_strategy", "queue_moh_sound", "queue_record_template", "queue_max_wait_time",
      "queue_max_wait_time_with_no_agent", "queue_tier_rules_apply", "queue_timeout_action", "queue_description"],
    write: { queue_name: S(64, /^[A-Za-z0-9 _-]{1,64}$/), queue_extension: S(8, EXT), queue_strategy: E("ring-all", "longest-idle-agent", "round-robin", "top-down", "agent-with-least-talk-time", "agent-with-fewest-calls", "sequentially-by-agent-order", "random"),
      queue_moh_sound: S(255, /^[^<>\r\n]{0,255}$/), queue_record_template: S(255, /^[^<>\r\n]{0,255}$/), queue_max_wait_time: I(0, 86400), queue_max_wait_time_with_no_agent: I(0, 86400),
      queue_tier_rules_apply: B, queue_timeout_action: S(128, DEST), queue_description: S(255, NAME) },
    required: ["queue_name", "queue_extension"], ops: ["list", "get", "create", "update", "delete"],
  },
  call_center_agents: {
    key: "call_center_agents", path: "call_center_agents", uuid: "call_center_agent_uuid", scope: "domain", label: "agent_name",
    read: ["call_center_agent_uuid", "agent_name", "agent_type", "agent_id", "agent_contact", "agent_status", "agent_call_timeout", "agent_max_no_answer", "agent_wrap_up_time", "agent_reject_delay_time", "agent_busy_delay_time"],
    write: { agent_name: S(64, /^[A-Za-z0-9 ._-]{1,64}$/), agent_type: E("callback", "uuid-standby"), agent_id: S(16, /^[0-9]{0,16}$/), agent_contact: S(128, DEST),
      agent_status: E("Available", "Available (On Demand)", "On Break", "Logged Out"), agent_call_timeout: I(5, 300), agent_max_no_answer: I(0, 100), agent_wrap_up_time: I(0, 3600),
      agent_reject_delay_time: I(0, 3600), agent_busy_delay_time: I(0, 3600), agent_password: { t: "secret", min: 4, max: 16, pattern: /^[0-9]+$/ } },
    required: ["agent_name", "agent_contact"], ops: ["list", "get", "create", "update", "delete"],
  },
  call_center_tiers: {
    key: "call_center_tiers", path: "call_center_tiers", uuid: "call_center_tier_uuid", scope: "domain", label: "call_center_agent_uuid",
    read: ["call_center_tier_uuid", "call_center_queue_uuid", "call_center_agent_uuid", "tier_level", "tier_position"],
    write: { call_center_queue_uuid: U, call_center_agent_uuid: U, tier_level: I(0, 99), tier_position: I(0, 99) },
    required: ["call_center_queue_uuid", "call_center_agent_uuid"], ops: ["list", "create", "update", "delete"], parent: { field: "call_center_queue_uuid", resource: "call_center_queues" },
  },
  conferences: {
    key: "conferences", path: "conferences", uuid: "conference_uuid", scope: "domain", label: "conference_name", reloadXml: true,
    read: ["conference_uuid", "conference_name", "conference_extension", "conference_profile", "conference_flags", "conference_enabled", "conference_description"],
    write: { conference_name: S(64, /^[A-Za-z0-9 _-]{1,64}$/), conference_extension: S(8, EXT), conference_profile: E("default", "wideband", "ultrawideband", "cdquality"),
      conference_flags: S(64, /^[a-z|-]{0,64}$/), conference_enabled: B, conference_description: S(255, NAME), conference_pin_number: { t: "secret", min: 3, max: 12, pattern: /^[0-9]+$/ } },
    required: ["conference_name", "conference_extension"], ops: ["list", "get", "create", "update", "delete"],
  },
  call_flows: {
    key: "call_flows", path: "call_flows", uuid: "call_flow_uuid", scope: "domain", label: "call_flow_name", reloadXml: true,
    read: ["call_flow_uuid", "call_flow_name", "call_flow_extension", "call_flow_feature_code", "call_flow_status", "call_flow_label", "call_flow_alternate_label", "call_flow_enabled", "call_flow_description"],
    write: { call_flow_status: B, call_flow_label: S(64, NAME), call_flow_alternate_label: S(64, NAME), call_flow_enabled: B, call_flow_description: S(255, NAME) },
    ops: ["list", "get", "update"],
  },
  time_conditions: {
    key: "time_conditions", path: "dialplans", uuid: "dialplan_uuid", scope: "domain", label: "dialplan_name", reloadXml: true, fixedFilter: { app_uuid: TIME_CONDITION_APP_UUID },
    read: ["dialplan_uuid", "dialplan_name", "dialplan_number", "dialplan_order", "dialplan_enabled", "dialplan_description"],
    write: { dialplan_enabled: B, dialplan_description: S(255, NAME) },
    ops: ["list", "get", "update"],
  },
  dialplans: {
    key: "dialplans", path: "dialplans", uuid: "dialplan_uuid", scope: "domain", label: "dialplan_name", reloadXml: true,
    read: ["dialplan_uuid", "app_uuid", "dialplan_name", "dialplan_number", "dialplan_context", "dialplan_order", "dialplan_enabled", "dialplan_description"],
    write: { dialplan_enabled: B, dialplan_description: S(255, NAME) },
    ops: ["list", "get", "update"],
  },
  music_on_hold: {
    key: "music_on_hold", path: "music_on_hold", uuid: "music_on_hold_uuid", scope: "domain", label: "music_on_hold_name",
    read: ["music_on_hold_uuid", "music_on_hold_name", "music_on_hold_rate", "music_on_hold_shuffle", "music_on_hold_channels", "music_on_hold_timer_name"],
    write: {}, ops: ["list"],
  },
  pbx_users: {
    key: "pbx_users", path: "users", uuid: "user_uuid", scope: "domain", label: "username",
    read: ["user_uuid", "username", "user_email", "user_enabled"],
    write: { user_enabled: B }, ops: ["list", "update"],
  },
  gateways: {
    key: "gateways", path: "gateways", uuid: "gateway_uuid", scope: "global", label: "gateway",
    read: ["gateway_uuid", "gateway", "proxy", "realm", "register", "expire_seconds", "retry_seconds", "profile", "context", "enabled", "description"],
    write: { gateway: S(64, /^[A-Za-z0-9 ._-]{1,64}$/), proxy: S(128, /^[A-Za-z0-9.:-]{1,128}$/), realm: S(128, /^[A-Za-z0-9.:-]{0,128}$/), register: B,
      expire_seconds: I(60, 86400), retry_seconds: I(5, 3600), profile: E("external", "internal"), context: S(64, /^[A-Za-z0-9._-]{1,64}$/), enabled: B, description: S(255, NAME),
      username: S(64, /^[A-Za-z0-9._@+-]{0,64}$/), password: { t: "secret", min: 4, max: 128 } },
    required: ["gateway", "proxy"], ops: ["list", "get", "create", "update", "delete"],
  },
  sip_profiles: {
    key: "sip_profiles", path: "sip_profiles", uuid: "sip_profile_uuid", scope: "global", label: "sip_profile_name",
    read: ["sip_profile_uuid", "sip_profile_name", "sip_profile_hostname", "sip_profile_enabled", "sip_profile_description"],
    write: { sip_profile_enabled: B, sip_profile_description: S(255, NAME) }, ops: ["list", "get", "update"],
  },
  domains: {
    key: "domains", path: "domains", uuid: "domain_uuid", scope: "global", label: "domain_name",
    read: ["domain_uuid", "domain_name", "domain_enabled", "domain_description"],
    write: { domain_name: S(253, /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/), domain_enabled: B, domain_description: S(255, NAME) },
    required: ["domain_name"], ops: ["list", "get", "create", "update"],
  },
});

export const SECRET_FIELDS = new Set(Object.values(RESOURCES).flatMap((r) => Object.entries(r.write).filter(([, f]) => f.t === "secret").map(([k]) => k)));
const ALWAYS_REDACT = /(^|_)(password|pin_number|secret|api_key|token)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Projects a FusionPBX row to the declared read fields; secrets become `<field>_set`. */
export function projectRow(resource: Resource, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of resource.read) {
    if (ALWAYS_REDACT.test(f)) continue;
    const v = row[f];
    if (v === undefined) continue;
    out[f] = v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : String(v);
  }
  for (const [k, spec] of Object.entries(resource.write)) if (spec.t === "secret") out[`${k}_set`] = typeof row[k] === "string" && (row[k] as string).length > 0;
  return out;
}

export type Invalid = { error: string };
const invalid = (error: string): Invalid => ({ error });
export const isInvalid = (v: unknown): v is Invalid => typeof v === "object" && v !== null && "error" in v && Object.keys(v as object).length === 1;

/** Typed validation of a write payload: unknown fields refused, FusionPBX booleans as "true"/"false" strings. */
export function validateValues(resource: Resource, raw: unknown, mode: "create" | "update", allowed?: readonly string[]): Record<string, string> | Invalid {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return invalid("invalid_values");
  const out: Record<string, string> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return invalid("no_values");
  for (const [k, v] of entries) {
    const spec = resource.write[k];
    if (!spec || (allowed && !allowed.includes(k))) return invalid(`field_not_writable_${k.replace(/[^a-z_]/g, "").slice(0, 48)}`);
    const bad = invalid(`invalid_${k.replace(/[^a-z_]/g, "").slice(0, 48)}`);
    switch (spec.t) {
      case "bool": if (typeof v !== "boolean") return bad; out[k] = v ? "true" : "false"; break;
      case "int": if (typeof v !== "number" || !Number.isInteger(v) || v < spec.min || v > spec.max) return bad; out[k] = String(v); break;
      case "enum": if (typeof v !== "string" || !spec.values.includes(v)) return bad; out[k] = v; break;
      case "uuid": if (!isUuid(v)) return bad; out[k] = v.toLowerCase(); break;
      case "str": { if (typeof v !== "string") return bad; const s = v.trim(); if (s.length > spec.max || /[\u0000-\u001f\u007f]/.test(s) || (spec.pattern && !spec.pattern.test(s))) return bad; out[k] = s; break; }
      case "secret": { if (typeof v !== "string" || v.length < spec.min || v.length > spec.max || /\s/.test(v) || (spec.pattern && !spec.pattern.test(v))) return bad; out[k] = v; break; }
    }
  }
  if (mode === "create") for (const r of resource.required ?? []) if (!(r in out) || out[r] === "") return invalid(`missing_${r}`);
  return out;
}

// ─── HTTP client ──────────────────────────────────────────────────────────────────────────────────────────────
export class PbxError extends Error { constructor(public readonly code: string, public readonly status = 502) { super(code); } }

function collectionOf(data: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((x) => typeof x === "object" && x !== null) as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of [key, "data", "rows", "results"]) if (Array.isArray(d[k])) return (d[k] as unknown[]).filter((x) => typeof x === "object" && x !== null) as Record<string, unknown>[];
    if (Object.keys(d).some((k) => k.endsWith("_uuid"))) return [d];
  }
  return [];
}

export class FusionPbxClient {
  private origin: string;
  constructor(private target: PbxTarget, private fetchFn: Fetch = fetch, private timeoutMs = 15_000) {
    const u = new URL(target.baseUrl);
    if (u.protocol !== "https:" || u.username || u.password) throw new PbxError("management_base_url_invalid", 409);
    this.origin = u.origin;
  }
  get domainUuid() { return this.target.domainUuid; }
  get domainName() { return this.target.domainName; }

  private async request(url: string, init: RequestInit): Promise<{ status: number; data: unknown; text: string }> {
    let res: Response;
    try { res = await this.fetchFn(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs) }); }
    catch { throw new PbxError("pbx_unreachable", 502); }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new PbxError("pbx_forbidden_check_api_key_and_permissions", 424);
    if (res.status === 404) throw new PbxError("pbx_resource_not_found", 404);
    if (res.status >= 300 && res.status < 400) throw new PbxError("pbx_redirected_check_base_url", 502);
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (res.status >= 400) throw new PbxError(res.status === 422 || res.status === 400 ? "pbx_rejected_values" : "pbx_error", res.status === 422 || res.status === 400 ? 422 : 502);
    return { status: res.status, data, text };
  }

  private readUrl(path: string, query: Record<string, string> = {}) {
    const u = new URL(`${this.origin}/app/api/7/${path}`);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u.toString();
  }
  private writeUrl(path: string) {
    if (!this.target.username) throw new PbxError("management_username_required_for_writes", 409);
    const u = new URL(`${this.origin}/app/api/7/${path}`);
    u.searchParams.set("key", this.target.apiKey);
    u.searchParams.set("username", this.target.username);
    return u.toString();
  }

  async list(path: string, collection: string, query: Record<string, string>): Promise<Record<string, unknown>[]> {
    const r = await this.request(this.readUrl(path, query), { headers: { Authorization: `Basic ${this.target.apiKey}`, Accept: "application/json" } });
    return collectionOf(r.data, collection);
  }
  async get(path: string, collection: string, uuid: string): Promise<Record<string, unknown> | null> {
    if (!isUuid(uuid)) throw new PbxError("invalid_uuid", 400);
    try {
      const rows = await this.list(`${path}/${uuid}`, collection, {});
      return rows[0] ?? null;
    } catch (e) { if (e instanceof PbxError && e.code === "pbx_resource_not_found") return null; throw e; }
  }
  async write(method: "POST" | "PUT" | "DELETE", path: string, collection: string, row?: Record<string, string>): Promise<Record<string, unknown>> {
    const r = await this.request(this.writeUrl(path), {
      method, headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: row ? JSON.stringify({ [collection]: [row] }) : undefined,
    });
    const d = (r.data ?? {}) as Record<string, unknown>;
    const details = Array.isArray(d.details) ? d.details as Array<Record<string, unknown>> : [];
    const code = d.code ?? details[0]?.code;
    if (code !== undefined && String(code) !== "200") throw new PbxError("pbx_rejected_values", 422);
    return collectionOf(r.data, collection)[0] ?? d;
  }
  /** FreeSWITCH API command through FusionPBX; `command` and `args` come only from the builders below. */
  async command(command: string, args: string): Promise<string> {
    const r = await this.request(this.writeUrl("commands"), {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ commands: [{ command, arguments: args }] }),
    });
    const d = r.data as Record<string, unknown> | null;
    const details = d && Array.isArray(d.details) ? d.details as Array<Record<string, unknown>> : [];
    const response = details[0]?.response ?? d?.response ?? r.text;
    return typeof response === "string" ? response : JSON.stringify(response ?? "");
  }

  // Web session (recording download only): FusionPBX serves recordings through PHP pages, not the REST API.
  private session: { cookie: string; until: number } | null = null;
  private async webSession(): Promise<string> {
    if (this.session && this.session.until > Date.now()) return this.session.cookie;
    const username = this.target.username, password = this.target.webPassword;
    if (!username || !password) throw new PbxError("fusionpbx_web_password_required_for_recordings", 409);
    const first = await this.fetchFn(`${this.origin}/login.php`, { redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs) }).catch(() => { throw new PbxError("pbx_unreachable", 502); });
    let cookie = (first.headers.get("set-cookie") ?? "").match(/PHPSESSID=[^;]+/i)?.[0] ?? "";
    const html = await first.text().catch(() => "");
    const form = new URLSearchParams({ username, password, path: "/" });
    for (const tag of html.match(/<input\b[^>]*type=["']hidden["'][^>]*>/gi) ?? []) {
      const n = tag.match(/\bname=["']([^"']+)["']/i)?.[1], v = tag.match(/\bvalue=["']([^"']*)["']/i)?.[1];
      if (n && v !== undefined && !/^(username|password|path|persistent)$/i.test(n) && /^[A-Za-z0-9_-]{1,128}$/.test(n)) form.set(n, v);
    }
    const login = await this.fetchFn(`${this.origin}/login.php`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs),
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) }, body: form.toString() }).catch(() => { throw new PbxError("pbx_unreachable", 502); });
    cookie = (login.headers.get("set-cookie") ?? "").match(/PHPSESSID=[^;]+/i)?.[0] ?? cookie;
    await login.body?.cancel();
    if (!cookie || login.status >= 400 || /login\.php/i.test(login.headers.get("location") ?? "")) throw new PbxError("fusionpbx_web_login_failed", 424);
    this.session = { cookie, until: Date.now() + 20 * 60_000 };
    return cookie;
  }
  /** Downloads one recording's audio by CDR id; returns bytes + content type, refuses anything that is not audio. */
  async recording(xmlCdrUuid: string, recordName: string | null, maxBytes = 60 * 1024 * 1024): Promise<{ body: Uint8Array; contentType: string }> {
    if (!isUuid(xmlCdrUuid)) throw new PbxError("invalid_uuid", 400);
    const cookie = await this.webSession();
    const ids = [recordName?.replace(/\.(mp3|wav|ogg)$/i, ""), xmlCdrUuid].filter((x): x is string => Boolean(x) && /^[A-Za-z0-9._-]{1,128}$/.test(x!));
    const urls = [...new Set(ids)].flatMap((id) => [`${this.origin}/app/xml_cdr/download.php?id=${encodeURIComponent(id)}&t=bin`, `${this.origin}/app/xml_cdr/xml_cdr_download.php?id=${encodeURIComponent(id)}&t=bin`]);
    for (const url of urls) {
      const res = await this.fetchFn(url, { headers: { Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(30_000) }).catch(() => null);
      if (!res || res.status !== 200) { await res?.body?.cancel(); continue; }
      const type = res.headers.get("content-type") ?? "";
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > maxBytes) continue;
      const head = new TextDecoder().decode(buf.slice(0, 8)).toLowerCase();
      const audio = /^audio\//i.test(type) || head.startsWith("id3") || head.startsWith("riff") || head.startsWith("oggs") || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
      if (!audio) continue;
      return { body: buf, contentType: /^audio\/[a-z0-9.+-]+$/i.test(type) ? type : head.startsWith("riff") ? "audio/wav" : head.startsWith("oggs") ? "audio/ogg" : "audio/mpeg" };
    }
    throw new PbxError("recording_not_available", 404);
  }
}

// ─── Tenant-scoped resource operations ────────────────────────────────────────────────────────────────────────
export async function listResource(c: FusionPbxClient, resource: Resource, opts: { limit: number; offset: number; parentUuid?: string; search?: string }) {
  const query: Record<string, string> = { limit: String(opts.limit), offset: String(opts.offset), ...(resource.fixedFilter ?? {}) };
  if (resource.scope === "domain") query.domain_uuid = c.domainUuid;
  if (resource.parent && opts.parentUuid) {
    await assertInDomain(c, RESOURCES[resource.parent.resource], opts.parentUuid);
    query[resource.parent.field] = opts.parentUuid;
  }
  const rows = await c.list(resource.path, resource.path, query);
  // Defense in depth: never return a row of another domain even if the API ignored the filter.
  const own = resource.scope === "domain" ? rows.filter((r) => r.domain_uuid === undefined || r.domain_uuid === c.domainUuid) : rows;
  const fixed = resource.fixedFilter ? own.filter((r) => Object.entries(resource.fixedFilter!).every(([k, v]) => r[k] === undefined || r[k] === v)) : own;
  const q = opts.search?.trim().toLowerCase();
  const found = q ? fixed.filter((r) => resource.read.some((f) => typeof r[f] === "string" && (r[f] as string).toLowerCase().includes(q))) : fixed;
  return found.map((r) => projectRow(resource, r));
}

export async function assertInDomain(c: FusionPbxClient, resource: Resource, uuid: string): Promise<Record<string, unknown>> {
  if (!isUuid(uuid)) throw new PbxError("invalid_uuid", 400);
  const row = await c.get(resource.path, resource.path, uuid);
  if (!row) throw new PbxError("not_found", 404);
  if (resource.scope === "domain" && row.domain_uuid !== c.domainUuid) throw new PbxError("not_found", 404); // other tenants are invisible
  if (resource.fixedFilter && Object.entries(resource.fixedFilter).some(([k, v]) => row[k] !== undefined && row[k] !== v)) throw new PbxError("not_found", 404);
  return row;
}

export async function getResource(c: FusionPbxClient, resource: Resource, uuid: string) {
  return projectRow(resource, await assertInDomain(c, resource, uuid));
}

export async function createResource(c: FusionPbxClient, resource: Resource, values: Record<string, string>) {
  if (resource.parent) await assertInDomain(c, RESOURCES[resource.parent.resource], values[resource.parent.field]);
  const row = { ...values, ...(resource.scope === "domain" ? { domain_uuid: c.domainUuid } : {}) };
  const created = await c.write("POST", resource.path, resource.path, row);
  if (resource.reloadXml) await c.command("reloadxml", "").catch(() => "");
  const uuid = typeof created[resource.uuid] === "string" ? created[resource.uuid] as string : null;
  return { uuid };
}

export async function updateResource(c: FusionPbxClient, resource: Resource, uuid: string, values: Record<string, string>) {
  await assertInDomain(c, resource, uuid);
  if (resource.parent && values[resource.parent.field]) await assertInDomain(c, RESOURCES[resource.parent.resource], values[resource.parent.field]);
  await c.write("PUT", `${resource.path}/${uuid}`, resource.path, { ...values, [resource.uuid]: uuid, ...(resource.scope === "domain" ? { domain_uuid: c.domainUuid } : {}) });
  if (resource.reloadXml) await c.command("reloadxml", "").catch(() => "");
  return { uuid };
}

export async function deleteResource(c: FusionPbxClient, resource: Resource, uuid: string) {
  await assertInDomain(c, resource, uuid);
  await c.write("DELETE", `${resource.path}/${uuid}`, resource.path);
  if (resource.reloadXml) await c.command("reloadxml", "").catch(() => "");
  return { uuid };
}

// ─── Live operations (FreeSWITCH) ─────────────────────────────────────────────────────────────────────────────
export type LiveChannel = { uuid: string; direction: string; createdAt: string | null; callerName: string; callerNumber: string; destination: string; state: string; application: string; presence: string; secure: boolean };

function parseRows(text: string): Record<string, unknown>[] {
  try { const j = JSON.parse(text); return Array.isArray(j?.rows) ? j.rows : []; } catch { return []; }
}

/** Channels of THIS domain only (FreeSWITCH lists every tenant; filtering is by context / presence realm). */
export async function liveChannels(c: FusionPbxClient): Promise<LiveChannel[]> {
  const domain = c.domainName;
  if (!domain) throw new PbxError("domain_name_unknown_test_management_first", 409);
  const rows = parseRows(await c.command("show", "channels as json"));
  const mine = rows.filter((r) => r.context === domain || String(r.presence_id ?? "").toLowerCase().endsWith(`@${domain}`) || String(r.accountcode ?? "") === domain);
  return mine.filter((r) => isUuid(r.uuid)).map((r) => ({
    uuid: String(r.uuid), direction: String(r.direction ?? ""), createdAt: typeof r.created_epoch === "string" && /^\d+$/.test(r.created_epoch) ? new Date(Number(r.created_epoch) * 1000).toISOString() : null,
    callerName: String(r.cid_name ?? ""), callerNumber: String(r.cid_num ?? ""), destination: String(r.dest ?? r.callee_num ?? ""), state: String(r.callstate ?? r.state ?? ""),
    application: String(r.application ?? ""), presence: String(r.presence_id ?? ""), secure: Boolean(r.secure),
  }));
}

async function assertOwnChannel(c: FusionPbxClient, uuid: string) {
  if (!isUuid(uuid)) throw new PbxError("invalid_uuid", 400);
  if (!(await liveChannels(c)).some((ch) => ch.uuid === uuid)) throw new PbxError("call_not_found", 404);
}

export async function hangup(c: FusionPbxClient, uuid: string) {
  await assertOwnChannel(c, uuid);
  const r = await c.command("uuid_kill", uuid);
  if (/^-ERR/.test(r.trim())) throw new PbxError("call_not_found", 404);
}

export async function transfer(c: FusionPbxClient, uuid: string, destination: string) {
  if (!DIAL.test(destination)) throw new PbxError("invalid_destination", 400);
  await assertOwnChannel(c, uuid);
  const r = await c.command("uuid_transfer", `${uuid} ${destination} XML ${c.domainName}`);
  if (/^-ERR/.test(r.trim())) throw new PbxError("transfer_failed", 409);
}

/** Rings the actor's own extension first, then connects it to `destination` (click-to-call) or to a live call (eavesdrop). */
export async function originate(c: FusionPbxClient, fromExtension: string, target: { destination: string } | { eavesdrop: string; mode: "listen" | "whisper" | "barge" }) {
  if (!EXT.test(fromExtension)) throw new PbxError("invalid_extension", 400);
  const domain = c.domainName;
  if (!domain) throw new PbxError("domain_name_unknown_test_management_first", 409);
  let tail: string;
  if ("destination" in target) {
    if (!DIAL.test(target.destination)) throw new PbxError("invalid_destination", 400);
    tail = `${target.destination} XML ${domain}`;
  } else {
    await assertOwnChannel(c, target.eavesdrop);
    const vars = target.mode === "barge" ? "eavesdrop_enable_dtmf=false,eavesdrop_bridge_aleg=true,eavesdrop_bridge_bleg=true" : target.mode === "whisper" ? "eavesdrop_whisper_aleg=true" : "eavesdrop_enable_dtmf=false";
    tail = `&eavesdrop(${target.eavesdrop})`;
    const r = await c.command("originate", `{${vars},origination_caller_id_name=Lemtel,origination_caller_id_number=${fromExtension}}user/${fromExtension}@${domain} ${tail}`);
    if (/^-ERR/.test(r.trim())) throw new PbxError("originate_failed", 409);
    return;
  }
  const r = await c.command("originate", `{origination_caller_id_name=Lemtel,origination_caller_id_number=${fromExtension}}user/${fromExtension}@${domain} ${tail}`);
  if (/^-ERR/.test(r.trim())) throw new PbxError("originate_failed", 409);
}

export type Registration = { user: string; agent: string; expiresAt: string | null; networkIp: string; status: string };
export async function registrations(c: FusionPbxClient): Promise<Registration[]> {
  const domain = c.domainName;
  if (!domain) throw new PbxError("domain_name_unknown_test_management_first", 409);
  const rows = parseRows(await c.command("show", "registrations as json"));
  return rows.filter((r) => String(r.realm ?? "").toLowerCase() === domain).map((r) => ({
    user: String(r.reg_user ?? ""), agent: String(r.user_agent ?? r.agent ?? "").slice(0, 128),
    expiresAt: typeof r.expires === "string" && /^\d+$/.test(r.expires) ? new Date(Number(r.expires) * 1000).toISOString() : null,
    networkIp: String(r.network_ip ?? ""), status: String(r.status ?? "registered"),
  }));
}

export async function gatewayControl(c: FusionPbxClient, gatewayUuid: string, op: "start" | "stop") {
  const row = await assertInDomain(c, RESOURCES.gateways, gatewayUuid);
  const profile = row.profile === "internal" ? "internal" : "external";
  const r = await c.command("sofia", `profile ${profile} ${op === "start" ? "startgw" : "killgw"} ${gatewayUuid}`);
  if (/^-ERR/.test(r.trim()) && !/already/i.test(r)) throw new PbxError("gateway_command_failed", 409);
}

export async function gatewayStatus(c: FusionPbxClient): Promise<Record<string, string>> {
  const text = await c.command("sofia", "status gateway");
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*\S+::([0-9a-f-]{36})\s+\S+\s+\S+\s+(\S+)/i);
    if (m && isUuid(m[1])) out[m[1].toLowerCase()] = m[2].slice(0, 32);
  }
  return out;
}

// ─── Voicemail ────────────────────────────────────────────────────────────────────────────────────────────────
export async function voicemailMessages(c: FusionPbxClient, voicemailUuid: string) {
  await assertInDomain(c, RESOURCES.voicemails, voicemailUuid);
  const rows = await c.list("voicemail_messages", "voicemail_messages", { domain_uuid: c.domainUuid, voicemail_uuid: voicemailUuid, limit: "200", offset: "0" });
  return rows.filter((r) => (r.domain_uuid === undefined || r.domain_uuid === c.domainUuid) && (r.voicemail_uuid === undefined || r.voicemail_uuid === voicemailUuid) && isUuid(r.voicemail_message_uuid))
    .map((r) => ({
      uuid: String(r.voicemail_message_uuid), createdAt: /^\d+$/.test(String(r.created_epoch ?? "")) ? new Date(Number(r.created_epoch) * 1000).toISOString() : null,
      callerName: String(r.caller_id_name ?? ""), callerNumber: String(r.caller_id_number ?? ""), seconds: Number(r.message_length ?? 0) || 0,
      status: String(r.message_status ?? ""), transcription: typeof r.message_transcription === "string" ? r.message_transcription.slice(0, 2000) : null,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function deleteVoicemailMessage(c: FusionPbxClient, voicemailUuid: string, messageUuid: string) {
  if (!isUuid(messageUuid)) throw new PbxError("invalid_uuid", 400);
  const own = await voicemailMessages(c, voicemailUuid);
  if (!own.some((m) => m.uuid === messageUuid)) throw new PbxError("not_found", 404);
  await c.write("DELETE", `voicemail_messages/${messageUuid}`, "voicemail_messages");
}

/** New random numeric PIN (returned once to the caller, never stored by Lemtel) and optional purge of all messages. */
export async function resetVoicemail(c: FusionPbxClient, voicemailUuid: string, purge: boolean, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  await assertInDomain(c, RESOURCES.voicemails, voicemailUuid);
  const bytes = random(6);
  const pin = Array.from(bytes, (b) => String(b % 10)).join("");
  await c.write("PUT", `voicemails/${voicemailUuid}`, "voicemails", { voicemail_uuid: voicemailUuid, domain_uuid: c.domainUuid, voicemail_password: pin });
  let purged = 0;
  if (purge) for (const m of await voicemailMessages(c, voicemailUuid)) { await c.write("DELETE", `voicemail_messages/${m.uuid}`, "voicemail_messages"); purged++; }
  return { pin, purged };
}

// ─── CDR normalization (for the local copy) ───────────────────────────────────────────────────────────────────
const ts = (v: unknown): string | null => {
  if (typeof v === "number" || (typeof v === "string" && /^\d{9,11}$/.test(v))) { const n = Number(v); return n > 0 ? new Date(n * 1000).toISOString() : null; }
  if (typeof v === "string" && v && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return null;
};
const clip = (v: unknown, n: number) => typeof v === "string" && v ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, n) : null;
const nonNeg = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };

export function normalizeCdr(organizationId: string, r: Record<string, unknown>, domainUuid: string) {
  if (!isUuid(r.xml_cdr_uuid)) return null;
  if (r.domain_uuid !== undefined && r.domain_uuid !== domainUuid) return null;
  const direction = ["inbound", "outbound", "local"].includes(String(r.direction)) ? String(r.direction) : null;
  const cause = typeof r.hangup_cause === "string" && /^[A-Z_]{1,64}$/.test(r.hangup_cause) ? r.hangup_cause : null;
  const rn = typeof r.record_name === "string" ? r.record_name.split("/").pop() ?? "" : "";
  return {
    organization_id: organizationId, xml_cdr_uuid: r.xml_cdr_uuid.toLowerCase(), direction,
    caller_id_name: clip(r.caller_id_name, 128), caller_id_number: clip(r.caller_id_number, 64),
    destination_number: clip(r.destination_number ?? r.caller_destination, 64), extension_uuid: isUuid(r.extension_uuid) ? r.extension_uuid.toLowerCase() : null,
    start_at: ts(r.start_epoch ?? r.start_stamp), answer_at: ts(r.answer_epoch ?? r.answer_stamp), end_at: ts(r.end_epoch ?? r.end_stamp),
    duration: nonNeg(r.duration), billsec: nonNeg(r.billsec), hangup_cause: cause,
    missed_call: r.missed_call === true || r.missed_call === "true",
    record_name: /^[A-Za-z0-9._-]{1,128}$/.test(rn) ? rn : null,
  };
}
