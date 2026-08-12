import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).replace(/[$\s,\u00a0]/g, "").replace(/[()]/g, (m) => (m === "(" ? "-" : ""));
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null);
const isoDate = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === "number") {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userData } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const { data: isAdminData } = await admin.rpc("is_planipret_admin", { _user_id: user.id });
    const { data: isSuperData } = await admin.rpc("is_super_admin", { _user_id: user.id });
    if (!isAdminData && !isSuperData) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "import");

    if (action === "summary") {
      const { data } = await admin
        .from("planipret_commission_register")
        .select("fiscal_year,broker_user_id,agent_name")
        .limit(200000);
      const rows = (data ?? []) as any[];
      const byYear: Record<string, number> = {};
      const unmatched = new Set<string>();
      for (const r of rows) {
        byYear[r.fiscal_year] = (byYear[r.fiscal_year] ?? 0) + 1;
        if (!r.broker_user_id && r.agent_name) unmatched.add(r.agent_name);
      }
      const { data: imports } = await admin
        .from("planipret_commission_imports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      return json({ ok: true, total: rows.length, byYear, unmatched: [...unmatched].sort(), imports: imports ?? [] });
    }

    if (action === "purge") {
      const year = Number(body?.year);
      const q = admin.from("planipret_commission_register").delete();
      const { error } = year ? await q.eq("fiscal_year", year) : await q.neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // action === "import"
    const rawRows: any[] = Array.isArray(body?.rows) ? body.rows : [];
    if (!rawRows.length) return json({ error: "no_rows" }, 400);
    const fileName = String(body?.fileName ?? "registre.xlsx");
    const replaceYears: boolean = body?.replaceYears !== false;

    // Broker directory for name -> user_id resolution
    const { data: profiles } = await admin.from("planipret_profiles").select("user_id,full_name,email");
    const byName = new Map<string, string>();
    for (const p of (profiles ?? []) as any[]) {
      if (p.full_name) byName.set(String(p.full_name).trim().toLowerCase(), p.user_id);
      if (p.email) byName.set(String(p.email).trim().toLowerCase(), p.user_id);
    }

    const prepared = rawRows.map((r, i) => {
      const date = isoDate(r.date_trans);
      const agent = str(r.agent_name);
      return {
        number: str(r.number),
        loan_amt: num(r.loan_amt),
        primary_client_name: str(r.primary_client_name),
        secondary_client_name: str(r.secondary_client_name),
        institution: str(r.institution),
        financial_inst_id: str(r.financial_inst_id),
        is_adjustment: str(r.is_adjustment),
        points: r.points === undefined ? null : num(r.points),
        buy_down: r.buy_down === undefined ? null : num(r.buy_down),
        amount: num(r.amount),
        mortgage_type: str(r.mortgage_type),
        term: str(r.term),
        agent_name: agent,
        target_name: str(r.target_name),
        date_trans: date,
        commission_type: str(r.commission_type)?.toLowerCase() ?? null,
        split_type: str(r.split_type),
        agent_company: str(r.agent_company),
        cabinet: str(r.cabinet),
        source_row: Number(r.source_row ?? i + 2),
        fiscal_year: date ? Number(date.slice(0, 4)) : null,
        ym_key: date ? date.slice(0, 7) : null,
        broker_user_id: agent ? byName.get(agent.toLowerCase()) ?? null : null,
      };
    }).filter((r) => r.date_trans);

    const years = Array.from(new Set(prepared.map((r) => r.fiscal_year!))).sort();

    const { data: imp, error: impErr } = await admin
      .from("planipret_commission_imports")
      .insert({ file_name: fileName, row_count: prepared.length, years, created_by: user.id, status: "running" })
      .select()
      .single();
    if (impErr) return json({ error: impErr.message }, 500);

    if (replaceYears && years.length) {
      const { error: delErr } = await admin.from("planipret_commission_register").delete().in("fiscal_year", years);
      if (delErr) return json({ error: delErr.message }, 500);
    }

    const CHUNK = 1000;
    let inserted = 0;
    for (let i = 0; i < prepared.length; i += CHUNK) {
      const slice = prepared.slice(i, i + CHUNK).map((r) => ({ ...r, import_batch_id: imp.id }));
      const { error } = await admin.from("planipret_commission_register").insert(slice);
      if (error) {
        await admin.from("planipret_commission_imports").update({ status: "failed", notes: { error: error.message } }).eq("id", imp.id);
        return json({ error: error.message, inserted }, 500);
      }
      inserted += slice.length;
    }

    const unmatched = Array.from(new Set(prepared.filter((r) => !r.broker_user_id && r.agent_name).map((r) => r.agent_name!)));
    await admin
      .from("planipret_commission_imports")
      .update({ status: "completed", row_count: inserted, notes: { unmatched } })
      .eq("id", imp.id);

    return json({ ok: true, inserted, years, unmatched, importId: imp.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
