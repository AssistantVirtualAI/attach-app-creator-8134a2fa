// pp-sync-answering-rules — Apply the standard Planiprêt answering rule
// (simultaneously ring {ext}_mobile, 25s timeout, then voicemail) to
// brokers in NetSapiens.
//
// Modes:
//   POST { "broker_id": "<uuid>" }           → single broker
//   POST { "bulk": true, "batch_size": 10 }  → all brokers with ns_extension
//   POST { "dry_run": true, ... }            → do not call NS, return payloads

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function nsRead(res: Response) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const NS_API_KEY = Deno.env.get("NS_API_KEY");
  const NS_API_BASE_URL = Deno.env.get("NS_API_BASE_URL") ?? "https://voice.ava-telecom.ca/ns-api/v2";
  const NS_DEFAULT_DOMAIN = Deno.env.get("NS_DEFAULT_DOMAIN") ?? "planipret.ca";

  if (!SUPABASE_URL || !SERVICE_ROLE || !NS_API_KEY) {
    return json({ error: "missing_config", detail: "SUPABASE_SERVICE_ROLE_KEY / NS_API_KEY required" }, 500);
  }

  try {
    const body: any = await req.json().catch(() => ({}));
    const broker_id: string | null = body?.broker_id ?? null;
    const bulk: boolean = !!body?.bulk;
    const dry_run: boolean = !!body?.dry_run;
    const batch_size: number = Math.max(1, Math.min(20, Number(body?.batch_size ?? 10)));
    const ring_timeout: number = Math.max(5, Math.min(120, Number(body?.ring_timeout ?? 25)));

    // Auth: admin only (single/bulk)
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY ?? SERVICE_ROLE, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const caller = userData?.user;
    if (!caller) return json({ error: "not_authenticated" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    let isAdmin = false;
    try { const { data } = await admin.rpc("is_planipret_admin", { _user_id: caller.id }); if (data) isAdmin = true; } catch { /* ignore */ }
    if (!isAdmin) { try { const { data } = await admin.rpc("is_super_admin", { _user_id: caller.id }); if (data) isAdmin = true; } catch { /* ignore */ } }
    if (!isAdmin) return json({ error: "forbidden", detail: "admin role required" }, 403);

    const nsHeaders = {
      Authorization: `Bearer ${NS_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const buildRulePayload = (ext: string, domain: string) => {
      const mobileAor = `sip:${ext}_mobile@${domain}`;
      // NS-API v2 answering rule schema — standard "default" time-frame rule.
      return {
        "time-frame": "Default",
        "simultaneous-ring-enabled": "yes",
        "simultaneous-ring-list": [mobileAor],
        "simultaneous-ring-confirm": "no",
        "ring-timeout": ring_timeout,
        "forward-no-answer-enabled": "yes",
        "forward-no-answer-target": `vmail:${ext}`,
        "do-not-disturb": "no",
      };
    };

    const applyRule = async (broker: any) => {
      const ext = broker.ns_extension ?? broker.extension;
      const domain = broker.ns_domain || NS_DEFAULT_DOMAIN;
      if (!ext) return { broker_id: broker.id ?? broker.user_id, success: false, error: "no_extension" };

      const payload = buildRulePayload(ext, domain);
      if (dry_run) {
        return { broker_id: broker.id ?? broker.user_id, extension: ext, domain, dry_run: true, payload, success: true };
      }

      const base = `${NS_API_BASE_URL}/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(ext)}/answering-rules`;

      // 1) List existing rules
      const listRes = await fetch(base, { headers: nsHeaders });
      const existing: any = listRes.ok ? await nsRead(listRes) : null;
      const arr: any[] = Array.isArray(existing) ? existing : (existing?.data ?? existing?.items ?? []);
      const defaultRule = arr.find((r: any) => {
        const tf = String(r?.["time-frame"] ?? r?.timeframe ?? r?.time_frame ?? "").toLowerCase();
        return tf === "default" || tf === "*" || tf === "always";
      });

      // 2) Upsert
      let opRes: Response;
      let mode: "created" | "updated";
      if (defaultRule) {
        const ruleId = encodeURIComponent(String(defaultRule?.id ?? defaultRule?.["time-frame"] ?? "Default"));
        opRes = await fetch(`${base}/${ruleId}`, { method: "PUT", headers: nsHeaders, body: JSON.stringify(payload) });
        mode = "updated";
      } else {
        opRes = await fetch(base, { method: "POST", headers: nsHeaders, body: JSON.stringify(payload) });
        mode = "created";
      }
      const opBody = await nsRead(opRes);

      return {
        broker_id: broker.id ?? broker.user_id,
        broker_name: broker.full_name,
        extension: ext,
        domain,
        success: opRes.ok,
        mode,
        status: opRes.status,
        payload,
        response: opBody,
        list_status: listRes.status,
      };
    };

    // Single
    if (broker_id && !bulk) {
      const { data: broker } = await admin.from("planipret_profiles")
        .select("id, user_id, full_name, email, extension, ns_extension, ns_domain")
        .or(`user_id.eq.${broker_id},id.eq.${broker_id}`).maybeSingle();
      if (!broker) return json({ error: "broker_not_found", broker_id }, 404);
      const result = await applyRule(broker);
      return json({ success: result.success, result });
    }

    // Bulk
    if (bulk) {
      const { data: brokers } = await admin.from("planipret_profiles")
        .select("id, user_id, full_name, email, extension, ns_extension, ns_domain")
        .not("ns_extension", "is", null);
      const list = brokers ?? [];
      if (list.length === 0) return json({ success: true, message: "Aucun courtier avec extension NS", total: 0 });

      const all: any[] = [];
      let succeeded = 0, failed = 0;
      for (let i = 0; i < list.length; i += batch_size) {
        const batch = list.slice(i, i + batch_size);
        const res = await Promise.all(batch.map((b) => applyRule(b).catch((e) => ({
          broker_id: b.id ?? b.user_id, success: false, error: e?.message ?? String(e),
        }))));
        all.push(...res);
        succeeded += res.filter((r: any) => r.success).length;
        failed += res.filter((r: any) => !r.success).length;
        if (i + batch_size < list.length) await new Promise((r) => setTimeout(r, 400));
      }
      return json({
        success: failed === 0,
        total: list.length,
        processed: all.length,
        succeeded,
        failed,
        dry_run,
        ring_timeout,
        results: all,
      });
    }

    return json({ error: "provide broker_id or bulk:true" }, 400);
  } catch (e: any) {
    console.error("pp-sync-answering-rules RUNTIME", e?.message, e?.stack);
    return json({ error: e?.message ?? String(e), stack: e?.stack }, 500);
  }
});
