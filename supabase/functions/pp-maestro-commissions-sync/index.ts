import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getMaestroOAuthEnv, getUserMaestroAccessToken, fetchMaestroUserProfile } from "../_shared/maestro-oauth.ts";
import { fetchCommissionDeposits, type CommissionDeposit } from "../_shared/maestro-commissions-api.ts";

/**
 * Single entry point that feeds the commission register from Maestro's
 * OFFICIAL Commission Reports API (GET /api/main/commissions/reports/deposits).
 *
 * The dashboards always read `planipret_commission_register`; this function is
 * the only writer for the Maestro source.
 *
 * POST {
 *   mode?: "self" | "all" | "brokers",   // "all"/"brokers" require a Planiprêt admin
 *   broker_ids?: string[],               // profile ids or user ids, for mode "brokers"
 *   years?: number[],                    // defaults to 2022..current year
 *   dry_run?: boolean
 * }
 */

const START_YEAR = 2022;

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

type BrokerProfile = {
  id: string;
  user_id: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  maestro_broker_id: string | null;
};

const displayName = (p: BrokerProfile) =>
  String(p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ") ?? p.email ?? "Courtier").trim() || "Courtier";

/** Maps an official Maestro deposit row to a `planipret_commission_register` row. */
function mapDeposit(d: CommissionDeposit, i: number, prof: BrokerProfile, maestroId: string, fallbackYear: number) {
  const dateRaw = d.date_trans ? String(d.date_trans).slice(0, 10) : null;
  const date = dateRaw ? new Date(`${dateRaw}T00:00:00Z`) : null;
  const valid = date && !Number.isNaN(date.getTime());
  const brokerName = displayName(prof);
  const dealId = String(d.number ?? d.agent_name_id ?? `${i}`);
  return {
    row_key: `maestro:${maestroId}:${dealId}`,
    number: String(d.number ?? ""),
    loan_amt: num(d.loan_amt),
    institution: String(d.institution ?? "").trim() || null,
    amount: num(d.amount),
    mortgage_type: String(d.mortgage_type ?? "").trim() || null,
    term: d.term == null ? null : String(d.term).trim(),
    agent_name: String(d.agent_name ?? brokerName).trim() || brokerName,
    target_name: String(d.target_name ?? brokerName).trim() || brokerName,
    date_trans: valid ? date!.toISOString().slice(0, 10) : null,
    commission_type: String(d.commission_type ?? "Commission").trim() || "Commission",
    fiscal_year: valid ? date!.getUTCFullYear() : fallbackYear,
    ym_key: valid ? date!.toISOString().slice(0, 7) : null,
    broker_user_id: (prof.user_id ?? prof.id ?? null) as string | null,
    first_name: prof.first_name ?? null,
    last_name: prof.last_name ?? null,
    maestro_broker_id: maestroId,
    agent_key: brokerName.toLowerCase().replace(/\s+/g, " ").trim(),
    match_method: "maestro_sync",
    sheet_name: "maestro",
    source_row: i + 1,
    raw: d,
    map_status: "ok",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean(body?.dry_run);
    const mode: "self" | "all" | "brokers" =
      body?.mode === "all" ? "all" : body?.mode === "brokers" ? "brokers" : "self";

    const nowYear = new Date().getUTCFullYear();
    const years: number[] = Array.isArray(body?.years) && body.years.length
      ? body.years.map((y: unknown) => Number(y)).filter((y: number) => Number.isFinite(y))
      : Array.from({ length: Math.max(1, nowYear - START_YEAR + 1) }, (_, i) => START_YEAR + i);
    const yearSet = new Set(years);
    const fallbackYear = Number(body?.fiscal_year) || nowYear;
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const dateFrom = `${minYear}-01-01 00:00:00`;
    const dateTo = `${maxYear}-12-31 23:59:59`;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return j({ success: false, error: "unauthorized", code: "unauthorized" }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    // Scheduled runs authenticate with the service role key (admin privileges).
    const isService = token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const { data: u } = isService ? { data: null as any } : await admin.auth.getUser(token);
    const callerId = isService ? null : (u?.user?.id ?? null);
    if (!isService && !callerId) return j({ success: false, error: "unauthorized", code: "unauthorized" }, 401);
    if (isService && mode === "self") return j({ success: false, error: "mode self requires a user", code: "bad_mode" }, 400);

    const SELECT = "id, user_id, full_name, first_name, last_name, email, maestro_broker_id";

    let targets: BrokerProfile[] = [];

    if (mode === "self") {
      const { data: prof } = await admin
        .from("planipret_profiles")
        .select(SELECT)
        .or(`user_id.eq.${callerId},id.eq.${callerId}`)
        .limit(1)
        .maybeSingle();
      if (!prof) return j({ success: false, error: "profil introuvable", code: "no_profile" });
      targets = [prof as BrokerProfile];
    } else {
      if (!isService) {
        const { data: isAdmin } = await admin.rpc("is_planipret_admin", { _user_id: callerId });
        if (!isAdmin) return j({ success: false, error: "forbidden", code: "forbidden" }, 403);
      }

      let q = admin.from("planipret_profiles").select(SELECT);
      if (mode === "brokers") {
        const ids: string[] = (Array.isArray(body?.broker_ids) ? body.broker_ids : []).map((x: unknown) => String(x));
        if (!ids.length) return j({ success: false, error: "broker_ids requis", code: "no_brokers" }, 400);
        q = q.or(`id.in.(${ids.join(",")}),user_id.in.(${ids.join(",")})`);
      }
      const { data: rows, error } = await q;
      if (error) return j({ success: false, error: error.message }, 500);
      targets = (rows ?? []) as BrokerProfile[];
    }

    const report: Array<Record<string, unknown>> = [];
    const unlinked: string[] = [];
    let totalWritten = 0;
    let totalCandidates = 0;
    let anySuccess = false;

    for (const prof of targets) {
      const name = displayName(prof);
      const keyId = (prof.user_id ?? prof.id) as string | null;

      // 1. Broker must have a live Maestro OAuth token.
      const oauthToken = keyId ? await getUserMaestroAccessToken(admin, keyId).catch(() => null) : null;
      if (!oauthToken) {
        unlinked.push(name);
        report.push({ broker: name, profile_id: prof.id, code: "maestro_not_connected", written: 0 });
        continue;
      }

      // 2. Always re-resolve the Maestro users_id from /user (the official
      // Commission API's users_id is the telecom/internal id, e.g. 93135 — NOT
      // the CRM id that may be cached on the profile).
      let maestroId: string | null = null;
      try {
        const me = await fetchMaestroUserProfile(getMaestroOAuthEnv(), oauthToken);
        const mid = (me as any)?.id ?? (me as any)?.user?.id ?? (me as any)?.user_id ?? null;
        if (mid && /^\d+$/.test(String(mid))) {
          maestroId = String(mid);
          await admin.from("planipret_profiles")
            .update({ maestro_broker_id: maestroId, maestro_connected: true })
            .eq("id", prof.id);
        }
      } catch { /* not connected */ }


      if (!maestroId || !/^\d+$/.test(maestroId)) {
        unlinked.push(name);
        report.push({ broker: name, profile_id: prof.id, code: "maestro_not_connected", written: 0 });
        continue;
      }

      // 3. Fetch the official commission deposit rows for this broker.
      const r = await fetchCommissionDeposits({
        token: oauthToken,
        usersId: maestroId,
        dateFrom,
        dateTo,
        perPage: 100,
        maxPages: 80,
      });
      if (!r.ok) {
        report.push({ broker: name, profile_id: prof.id, code: "api_error", status: r.status, error: r.error, written: 0 });
        continue;
      }
      anySuccess = true;

      const rows = r.rows
        .map((d, i) => mapDeposit(d, i, prof, maestroId!, fallbackYear))
        .filter((row) => yearSet.has(row.fiscal_year));
      totalCandidates += rows.length;

      if (dryRun) {
        report.push({ broker: name, profile_id: prof.id, users_id: maestroId, candidates: rows.length, written: 0 });
        continue;
      }

      let written = 0;
      let failed: string | null = null;
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await admin
          .from("planipret_commission_register")
          .upsert(chunk, { onConflict: "row_key" });
        if (error) { failed = error.message; break; }
        written += chunk.length;
      }
      totalWritten += written;
      report.push({ broker: name, profile_id: prof.id, users_id: maestroId, written, ...(failed ? { error: failed } : {}) });
    }

    if (!anySuccess) {
      return j({
        success: false,
        code: "no_data",
        error: "Aucune donnée de commission récupérée depuis Maestro.",
        mode, brokers: targets.length, unlinked, report, written: 0,
      });
    }

    return j({
      success: true,
      source: "maestro",
      mode,
      dry_run: dryRun,
      years,
      brokers: targets.length,
      candidates: totalCandidates,
      written: totalWritten,
      unlinked,
      report,
      synced_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("pp-maestro-commissions-sync error", e);
    return j({ success: false, error: e?.message ?? "server_error" }, 500);
  }
});
