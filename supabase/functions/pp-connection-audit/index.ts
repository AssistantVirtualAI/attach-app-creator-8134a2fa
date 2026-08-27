// pp-connection-audit — audit des postes sans jeton Maestro / Microsoft actif
// et déclenchement du workflow de reconnexion (notification in-app + push).
//
// POST { notify?: boolean, limit?: number, user_id?: string, dry_run?: boolean }
// GET  → audit seul (aucune notification)
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pp-cron-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const expired = (iso: string | null) => !iso || Date.parse(iso) <= Date.now();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const CRON_SECRET = Deno.env.get("PP_CRON_TOKEN") ?? Deno.env.get("PP_CRON_SECRET") ?? "";
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const isCron = !!CRON_SECRET && req.headers.get("x-pp-cron-secret") === CRON_SECRET;
  const isService = !!token && token === SERVICE_ROLE;
  if (!isCron && !isService) {
    if (!token) return json({ error: "unauthorized" }, 401);
    const { data: userData } = await admin.auth.getUser(token);
    if (!userData?.user) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin } = await admin.rpc("is_planipret_admin", { _user_id: userData.user.id });
    if (isAdmin !== true) return json({ error: "forbidden" }, 403);
  }

  const body = req.method === "POST" ? await req.json().catch(() => ({} as any)) : {};
  const notify = body?.notify === true && body?.dry_run !== true;
  const limit = Math.min(Math.max(Number(body?.limit) || 200, 1), 500);

  let q = admin
    .from("planipret_profiles")
    .select("id, full_name, email, extension, maestro_broker_id, maestro_connected, maestro_refresh_token, maestro_token_expires_at, maestro_last_sync_at, maestro_telecom_user_id, ms365_email, ms365_refresh_token, ms365_token_expiry")
    .limit(limit);
  if (body?.user_id) q = q.eq("id", body.user_id);
  const { data: profiles, error } = await q;
  if (error) return json({ error: error.message }, 500);

  // Enregistrements SIP connus (device provisionné mais jamais enregistré).
  const { data: devices } = await admin
    .from("pbx_softphone_users")
    .select("user_id, extension, last_registered_at")
    .limit(1000);
  const lastReg = new Map<string, string | null>();
  for (const d of devices ?? []) {
    if (d.user_id) lastReg.set(String(d.user_id), (d as any).last_registered_at ?? null);
  }

  const rows = (profiles ?? []).map((p: any) => {
    const maestroOk = !!p.maestro_refresh_token && !!p.maestro_broker_id && p.maestro_connected !== false;
    const maestroStale = maestroOk && expired(p.maestro_token_expires_at) && !p.maestro_refresh_token;
    const msOk = !!p.ms365_refresh_token;
    const reg = lastReg.get(String(p.id)) ?? null;
    const sipOk = !!reg && Date.now() - Date.parse(reg) < 7 * 24 * 3600_000;
    const issues: string[] = [];
    if (!maestroOk) issues.push("maestro_disconnected");
    if (maestroStale) issues.push("maestro_token_expired");
    if (!p.maestro_telecom_user_id) issues.push("maestro_telecom_user_id_missing");
    if (!msOk) issues.push("microsoft_disconnected");
    if (p.extension && !sipOk) issues.push("sip_not_registered");
    return {
      user_id: p.id,
      name: p.full_name,
      email: p.email,
      extension: p.extension,
      maestro_broker_id: p.maestro_broker_id,
      maestro_last_sync_at: p.maestro_last_sync_at,
      last_sip_registration: reg,
      issues,
    };
  });

  const needsAction = rows.filter((r) => r.issues.length > 0);

  let notified = 0;
  if (notify) {
    for (const r of needsAction) {
      const needsMaestro = r.issues.some((i) => i.startsWith("maestro"));
      const needsMs = r.issues.includes("microsoft_disconnected");
      const needsSip = r.issues.includes("sip_not_registered");
      const actions = [
        needsMaestro ? "reconnecter Maestro" : null,
        needsMs ? "se reconnecter à Microsoft 365" : null,
        needsSip ? "rouvrir l'application pour réenregistrer le poste SIP" : null,
      ].filter(Boolean).join(", ");
      const { error: nerr } = await admin.from("planipret_ava_notifications").insert({
        user_id: r.user_id,
        type: "connection_required",
        title: "Reconnexion requise",
        body: `Votre compte doit être reconnecté : ${actions}.`,
        metadata: { issues: r.issues, extension: r.extension, source: "pp-connection-audit" },
      });
      if (!nerr) notified++;

      // Push mobile best-effort (réveille l'app → réenregistrement SIP auto).
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/pp-send-push`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({
            user_id: r.user_id,
            title: "Reconnexion requise",
            body: `Action requise : ${actions}.`,
            data: { kind: "reconnect", issues: r.issues },
          }),
        });
      } catch { /* best-effort */ }
    }
  }

  return json({
    success: true,
    audited: rows.length,
    needs_action: needsAction.length,
    notified,
    breakdown: {
      maestro_disconnected: rows.filter((r) => r.issues.includes("maestro_disconnected")).length,
      maestro_token_expired: rows.filter((r) => r.issues.includes("maestro_token_expired")).length,
      telecom_id_missing: rows.filter((r) => r.issues.includes("maestro_telecom_user_id_missing")).length,
      microsoft_disconnected: rows.filter((r) => r.issues.includes("microsoft_disconnected")).length,
      sip_not_registered: rows.filter((r) => r.issues.includes("sip_not_registered")).length,
    },
    results: needsAction,
  });
});
