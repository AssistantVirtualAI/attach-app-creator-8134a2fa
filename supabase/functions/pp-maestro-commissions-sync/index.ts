import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getMaestroTelecomConfig, isMaestroTelecomConfigured, maestroTelecomFetch } from "../_shared/maestro-telecom.ts";
import { getMaestroOAuthEnv, getUserMaestroAccessToken, fetchMaestroUserProfile } from "../_shared/maestro-oauth.ts";
import { resolveRevenue, isStrictMappingEnabled } from "../_shared/maestro-commission-map.ts";

/**
 * Single entry point that feeds the commission register from Maestro.
 *
 * The dashboards always read `planipret_commission_register`; this function is
 * the only writer once the Maestro deals endpoint is wired. No file import.
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

const pick = (o: any, keys: string[]): any => {
  for (const k of keys) if (o && o[k] != null && o[k] !== "") return o[k];
  return null;
};

const COMMISSION_FALLBACK_FIELDS = ["commission", "commission_amount", "total_commission", "broker_commission", "revenue", "Case amount"];

const DEAL_PATHS = (uid: string) => [
  `/users/${uid}/deals`,
  `/users/${uid}/mortgages`,
  `/users/${uid}/commissions`,
  `/users/${uid}/files`,
  `/users/${uid}/applications`,
];

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

/** Maps a Maestro deal payload to a `planipret_commission_register` row. */
function mapDeal(d: any, i: number, prof: BrokerProfile, maestroId: string, strict: boolean, fallbackYear: number) {
  const dateRaw = pick(d, ["funding_date", "funded_at", "closing_date", "close_date", "completion_date", "date", "created_at"]);
  const date = dateRaw ? new Date(String(dateRaw)) : null;
  const valid = date && !Number.isNaN(date.getTime());
  const provenance = resolveRevenue(d, COMMISSION_FALLBACK_FIELDS);
  const dealId = String(pick(d, ["id", "deal_id", "number", "file_number", "reference"]) ?? `${i}`);
  const brokerName = displayName(prof);
  return {
    row_key: `maestro:${maestroId}:${dealId}`,
    number: String(pick(d, ["number", "file_number", "reference", "id"]) ?? ""),
    loan_amt: num(pick(d, ["mortgage_amount", "loan_amount", "amount", "volume", "financing_amount", "principal"])),
    institution: String(pick(d, ["lender", "lender_name", "institution", "bank", "financial_institution"]) ?? "").trim() || null,
    amount: num(provenance.revenue_raw),
    mortgage_type: String(pick(d, ["product_type", "product", "rate_type", "mortgage_type", "type"]) ?? "").trim() || null,
    term: String(pick(d, ["term", "term_years", "term_length", "duration"]) ?? "").trim() || null,
    agent_name: brokerName,
    target_name: brokerName,
    date_trans: valid ? date!.toISOString().slice(0, 10) : null,
    commission_type: String(pick(d, ["commission_type", "revenue_type"]) ?? "Commission"),
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
    map_status: strict && !provenance.rule_matched ? "unmapped" : "ok",
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

    const tCfg = await getMaestroTelecomConfig(admin);
    if (!isMaestroTelecomConfigured(tCfg)) {
      return j({ success: false, code: "not_configured", error: "Intégration Maestro non configurée." });
    }

    const strict = isStrictMappingEnabled();
    const report: Array<Record<string, unknown>> = [];
    const unlinked: string[] = [];
    let totalWritten = 0;
    let totalCandidates = 0;
    let anyEndpoint = false;

    for (const prof of targets) {
      const name = displayName(prof);
      let maestroId = prof.maestro_broker_id ? String(prof.maestro_broker_id).trim() : null;

      if ((!maestroId || !/^\d+$/.test(maestroId)) && (prof.user_id || prof.id)) {
        try {
          const tok = await getUserMaestroAccessToken(admin, (prof.user_id ?? prof.id) as string);
          if (tok) {
            const me = await fetchMaestroUserProfile(getMaestroOAuthEnv(), tok);
            const mid = (me as any)?.id ?? (me as any)?.user?.id ?? (me as any)?.user_id ?? null;
            if (mid && /^\d+$/.test(String(mid))) {
              maestroId = String(mid);
              await admin.from("planipret_profiles")
                .update({ maestro_broker_id: maestroId, maestro_connected: true })
                .eq("id", prof.id);
            }
          }
        } catch { /* not connected */ }
      }

      if (!maestroId || !/^\d+$/.test(maestroId)) {
        unlinked.push(name);
        report.push({ broker: name, profile_id: prof.id, code: "maestro_not_connected", written: 0 });
        continue;
      }

      let raw: any[] = [];
      let usedPath: string | null = null;
      const attempts: Array<{ path: string; status: number | null }> = [];
      for (const path of DEAL_PATHS(maestroId)) {
        const r = await maestroTelecomFetch(tCfg, path, { method: "GET", timeoutMs: 15000 });
        attempts.push({ path, status: r.status ?? null });
        if (!r.ok) continue;
        const d: any = r.data;
        const list = Array.isArray(d) ? d : (d?.deals ?? d?.mortgages ?? d?.commissions ?? d?.files ?? d?.applications ?? d?.data ?? d?.results ?? []);
        if (Array.isArray(list) && list.length) { raw = list; usedPath = path; break; }
      }

      if (!usedPath) {
        report.push({ broker: name, profile_id: prof.id, code: "no_endpoint", attempts, written: 0 });
        continue;
      }
      anyEndpoint = true;

      const rows = raw
        .map((d, i) => mapDeal(d, i, prof, maestroId!, strict, fallbackYear))
        .filter((r) => yearSet.has(r.fiscal_year));
      totalCandidates += rows.length;

      if (dryRun) {
        report.push({ broker: name, profile_id: prof.id, path: usedPath, candidates: rows.length, written: 0 });
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
      report.push({ broker: name, profile_id: prof.id, path: usedPath, written, ...(failed ? { error: failed } : {}) });
    }

    if (!anyEndpoint) {
      // Endpoint not wired yet: leave the existing register untouched.
      return j({
        success: false,
        code: "no_endpoint",
        error: "Aucun endpoint de dossiers Maestro n'a répondu.",
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
