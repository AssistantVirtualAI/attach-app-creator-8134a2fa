// pp-admin-sip-ops — admin-only SIP monitoring + per-broker outbound calling.
//
// POST { action: "status", extensions?: string[], limit?: number }
//   → per-extension SIP registration state, expiry, contact, last NS errors.
// POST { action: "reprovision", broker_id }
//   → forwards to ns-provision-broker-devices (force) for that broker.
// POST { action: "call", broker_id, to_number }
//   → originates an outbound call from the broker's device (click-to-call).
//
// Never touches PJSIP/CallKit/audio/AOR ownership: read-only on NS devices,
// call origination uses the same REST contract as pp-ns-calls.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requirePlanipretAdmin } from "../_shared/require-planipret-admin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NS_API_KEY = Deno.env.get("NS_API_KEY") ?? "";
const NS_API_BASE_URL = (Deno.env.get("NS_API_BASE_URL") ?? "https://voice.ava-telecom.ca/ns-api/v2").replace(/\/$/, "");
const NS_DOMAIN = Deno.env.get("NS_DEFAULT_DOMAIN") ?? "planipret.ca";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function ns(path: string, init: RequestInit = {}) {
  const res = await fetch(`${NS_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${NS_API_KEY}`,
      Connection: "close",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data } as { ok: boolean; status: number; data: any };
}

function deviceSummary(d: any) {
  const state = String(d?.["device-sip-registration-state"] ?? d?.["registration-state"] ?? "unknown").toLowerCase();
  return {
    aor: d?.["aor"] ?? d?.["device"] ?? null,
    transport: d?.["device-sip-transport-type"] ?? null,
    state,
    registered: state === "registered",
    expires_at: d?.["device-sip-registration-expires-datetime"] ?? null,
    registered_at: d?.["device-sip-registration-datetime"] ?? d?.["device-sip-registration-start-datetime"] ?? null,
    contact: d?.["device-sip-registration-uri"] ?? d?.["device-sip-registration-contact"] ?? null,
    user_agent: d?.["device-sip-registration-user-agent"] ?? d?.["user-agent"] ?? null,
    server: d?.["device-sip-registration-server"] ?? d?.["core-server"] ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const denied = await requirePlanipretAdmin(req);
  if (denied) return denied;

  if (!NS_API_KEY) return json({ error: "missing_config", detail: "NS_API_KEY required" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const body: any = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "status");

  try {
    if (action === "status") {
      const limit = Math.max(1, Math.min(120, Number(body?.limit ?? 40)));
      let wanted: string[] = Array.isArray(body?.extensions) ? body.extensions.map(String) : [];

      let q = admin
        .from("planipret_profiles")
        .select("user_id, full_name, email, extension")
        .not("extension", "is", null)
        .order("extension", { ascending: true })
        .limit(limit);
      if (wanted.length) q = q.in("extension", wanted);
      const { data: profiles, error } = await q;
      if (error) return json({ error: error.message }, 500);

      const rows = (profiles ?? []).filter((p: any) => String(p.extension ?? "").trim());
      wanted = rows.map((p: any) => String(p.extension));

      const [{ data: errLogs }, { data: dids }] = await Promise.all([
        admin
          .from("planipret_ns_request_log")
          .select("path, status, error, created_at, function_name")
          .eq("ok", false)
          .order("created_at", { ascending: false })
          .limit(300),
        admin.from("planipret_did_assignments").select("extension, phone_number_e164, status").in("extension", wanted),
      ]);

      const out: any[] = [];
      for (let i = 0; i < rows.length; i += 6) {
        const chunk = rows.slice(i, i + 6);
        const res = await Promise.all(chunk.map(async (p: any) => {
          const ext = String(p.extension);
          const r = await ns(`/domains/${encodeURIComponent(NS_DOMAIN)}/users/${encodeURIComponent(ext)}/devices`);
          const list = Array.isArray(r.data) ? r.data : (r.data?.devices ?? r.data?.data ?? []);
          const devices = (Array.isArray(list) ? list : []).map(deviceSummary);
          const errors = (errLogs ?? [])
            .filter((l: any) => String(l.path ?? "").includes(`/${ext}`))
            .slice(0, 5);
          return {
            user_id: p.user_id,
            name: p.full_name ?? p.email ?? ext,
            email: p.email ?? null,
            extension: ext,
            ns_status: r.status,
            devices,
            registered_count: devices.filter((d) => d.registered).length,
            last_registered_at: devices.map((d) => d.registered_at).filter(Boolean).sort().pop() ?? null,
            dids: (dids ?? []).filter((d: any) => String(d.extension) === ext),
            errors,
          };
        }));
        out.push(...res);
      }

      return json({ ok: true, domain: NS_DOMAIN, count: out.length, extensions: out });
    }

    if (action === "reprovision") {
      const brokerId = String(body?.broker_id ?? "");
      if (!brokerId) return json({ error: "broker_id required" }, 400);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ns-provision-broker-devices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: req.headers.get("Authorization") ?? "",
          apikey: req.headers.get("apikey") ?? "",
        },
        body: JSON.stringify({ broker_id: brokerId, force: true }),
      });
      const text = await res.text();
      let parsed: unknown = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      return json({ ok: res.ok, status: res.status, result: parsed }, 200);
    }

    if (action === "call") {
      const brokerId = String(body?.broker_id ?? "");
      const raw = String(body?.to_number ?? "");
      if (!brokerId || !raw) return json({ success: false, error: "broker_id and to_number required" }, 400);

      const { data: profile } = await admin
        .from("planipret_profiles")
        .select("user_id, full_name, extension, ns_mobile_device_id")
        .eq("user_id", brokerId)
        .maybeSingle();
      const ext = String(profile?.extension ?? "").trim();
      if (!ext) return json({ success: false, error: "broker has no extension" }, 200);

      const { data: settings } = await admin
        .from("planipret_outbound_settings")
        .select("client_type, outbound_enabled, caller_id_number, caller_id_name")
        .eq("user_id", brokerId)
        .maybeSingle();
      if (settings && settings.outbound_enabled === false) {
        return json({ success: false, error: "outbound_disabled" }, 200);
      }

      let dest = raw.replace(/[^\d+]/g, "");
      const bare = dest.replace(/\D/g, "");
      if (bare.length >= 2 && bare.length <= 6) dest = bare;
      else if (!dest.startsWith("+")) dest = "+" + (bare.length === 10 ? "1" + bare : bare);

      const clientType = String(settings?.client_type ?? "mobile") === "web" ? "web" : "mobile";
      let deviceName = clientType === "mobile" && profile?.ns_mobile_device_id
        ? String(profile.ns_mobile_device_id)
        : `${ext}_${clientType}`;

      let callOrigUser = `${deviceName}@${NS_DOMAIN}`;
      let registered = false;
      let deviceState = "unknown";
      const dev = await ns(`/domains/${encodeURIComponent(NS_DOMAIN)}/users/${encodeURIComponent(ext)}/devices/${encodeURIComponent(deviceName)}`);
      if (dev.ok) {
        const d = Array.isArray(dev.data) ? dev.data[0] : dev.data;
        deviceState = String(d?.["device-sip-registration-state"] ?? "unknown").toLowerCase();
        registered = deviceState === "registered";
        const uri = d?.["device-sip-registration-uri"];
        if (typeof uri === "string" && uri) callOrigUser = uri.replace(/^sip:/i, "");
      }
      if (!registered) callOrigUser = `${ext}@${NS_DOMAIN}`;

      const clientCallId = crypto.randomUUID();
      const r = await ns(`/domains/${encodeURIComponent(NS_DOMAIN)}/users/${encodeURIComponent(ext)}/calls`, {
        method: "POST",
        body: JSON.stringify({
          "call-id": clientCallId,
          destination: dest,
          origination: callOrigUser,
          "call-orig-user": callOrigUser,
          "call-term-user": dest,
          "auto-answer-enabled": "no",
          synchronous: "yes",
        }),
      });

      const ok = r.ok || r.status === 202;
      if (ok) {
        const nsCallId = r.data?.["call-id"] ?? r.data?.call_id ?? r.data?.id ?? clientCallId;
        try {
          await admin.from("planipret_phone_calls").insert({
            user_id: brokerId,
            ns_call_id: nsCallId,
            ns_callid: nsCallId,
            ns_domain: NS_DOMAIN,
            extension: ext,
            direction: "outbound",
            from_number: settings?.caller_id_number ?? String(ext),
            to_number: dest,
            status: "outbound_ringing",
            started_at: new Date().toISOString(),
            maestro_call_id: null,
            metadata: { admin_originated: true, device_name: deviceName, call_orig_user: callOrigUser, client_type: clientType },
          });
        } catch { /* non-fatal */ }
        return json({
          success: true,
          call_id: nsCallId,
          destination: dest,
          extension: ext,
          device_name: deviceName,
          device_registered: registered,
          device_state: deviceState,
        });
      }

      return json({
        success: false,
        error: (typeof r.data === "object" && r.data?.message) || `NS-API error ${r.status}`,
        ns_status: r.status,
        device_state: deviceState,
      }, 200);
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
