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
 * POST { fiscal_year?: number, dry_run?: boolean }
 */

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const fiscalYear = Number(body?.fiscal_year) || new Date().getUTCFullYear();
    const dryRun = Boolean(body?.dry_run);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return j({ success: false, error: "unauthorized", code: "unauthorized" }, 401);
    const { data: u } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    const callerId = u?.user?.id ?? null;
    if (!callerId) return j({ success: false, error: "unauthorized", code: "unauthorized" }, 401);

    const { data: prof } = await admin
      .from("planipret_profiles")
      .select("id, user_id, full_name, first_name, last_name, email, maestro_broker_id")
      .or(`user_id.eq.${callerId},id.eq.${callerId}`)
      .limit(1)
      .maybeSingle();
    if (!prof) return j({ success: false, error: "profil introuvable", code: "no_profile" });

    let maestroId = prof.maestro_broker_id ? String(prof.maestro_broker_id).trim() : null;
    if (!maestroId || !/^\d+$/.test(maestroId)) {
      try {
        const tok = await getUserMaestroAccessToken(admin, callerId);
        if (tok) {
          const me = await fetchMaestroUserProfile(getMaestroOAuthEnv(), tok);
          const mid = (me as any)?.id ?? (me as any)?.user?.id ?? (me as any)?.user_id ?? null;
          if (mid && /^\d+$/.test(String(mid))) {
            maestroId = String(mid);
            await admin.from("planipret_profiles").update({ maestro_broker_id: maestroId, maestro_connected: true }).eq("id", prof.id);
          }
        }
      } catch { /* not connected */ }
    }
    if (!maestroId || !/^\d+$/.test(maestroId)) {
      return j({ success: false, code: "maestro_not_connected", error: "Connectez votre compte Maestro dans Réglages → Maestro." });
    }

    const tCfg = await getMaestroTelecomConfig(admin);
    if (!isMaestroTelecomConfigured(tCfg)) {
      return j({ success: false, code: "not_configured", error: "Intégration Maestro non configurée." });
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
      // Endpoint not wired yet: leave the existing register untouched.
      return j({ success: false, code: "no_endpoint", error: "Aucun endpoint de dossiers Maestro n'a répondu.", attempts, written: 0 });
    }

    const strict = isStrictMappingEnabled();
    const brokerName = String(prof.full_name ?? prof.email ?? "Courtier");
    const brokerUserId = (prof.user_id ?? prof.id ?? null) as string | null;

    const rows = raw.map((d: any, i: number) => {
      const dateRaw = pick(d, ["funding_date", "funded_at", "closing_date", "close_date", "completion_date", "date", "created_at"]);
      const date = dateRaw ? new Date(String(dateRaw)) : null;
      const valid = date && !Number.isNaN(date.getTime());
      const provenance = resolveRevenue(d, COMMISSION_FALLBACK_FIELDS);
      const dealId = String(pick(d, ["id", "deal_id", "number", "file_number", "reference"]) ?? `${i}`);
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
        fiscal_year: valid ? date!.getUTCFullYear() : fiscalYear,
        ym_key: valid ? date!.toISOString().slice(0, 7) : null,
        broker_user_id: brokerUserId,
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
    }).filter((r) => r.fiscal_year === fiscalYear);

    if (dryRun) return j({ success: true, dry_run: true, path: usedPath, candidates: rows.length });

    let written = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await admin
        .from("planipret_commission_register")
        .upsert(chunk, { onConflict: "row_key" });
      if (error) return j({ success: false, error: error.message, written }, 500);
      written += chunk.length;
    }

    return j({
      success: true,
      source: "maestro",
      path: usedPath,
      fiscal_year: fiscalYear,
      written,
      synced_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("pp-maestro-commissions-sync error", e);
    return j({ success: false, error: e?.message ?? "server_error" }, 500);
  }
});
