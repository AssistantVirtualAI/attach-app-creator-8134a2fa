// Live Maestro deposits merged into the register-based dashboards.
//
// The official Commission Reports API is strictly token-owner scoped: a token
// only ever returns its own broker's deposits (verified — passing another
// broker's `users_id` returns zero rows). So the only way to widen the live
// view is to fan out over every broker who connected their Maestro account.
// Whatever the API can't cover stays covered by the imported register.

import { getUserMaestroAccessToken } from "./maestro-oauth.ts";
import { buildDepositQuery, commissionGet, type CommissionDepositRow } from "./commission-reports.ts";

const MAX_PAGES = 10; // 10 × 200 rows per broker

export type LiveRegisterRow = {
  number: string | null;
  loan_amt: number | null;
  institution: string | null;
  amount: number | null;
  mortgage_type: string | null;
  term: string | null;
  agent_name: string | null;
  target_name: string | null;
  date_trans: string | null;
  commission_type: string | null;
  source_row: number;
  broker_user_id: string | null;
  maestro_broker_id: string | null;
  cabinet: string | null;
  fiscal_year: number | null;
  agent_key: string | null;
  first_name: string | null;
  last_name: string | null;
  sheet_name: string;
  provenance: "maestro";
};

export type LiveResult = {
  rows: LiveRegisterRow[];
  coverage: { connected: number; total: number };
  failures: { broker: string; status: number; message: string }[];
  brokers: string[];
};

/** `number|date|amount|type` — stable across the register and the API. */
export const dedupeKey = (r: {
  number?: string | null;
  date_trans?: string | null;
  amount?: unknown;
  commission_type?: string | null;
}) =>
  [
    String(r.number ?? "").trim().toUpperCase(),
    String(r.date_trans ?? "").slice(0, 10),
    Number(
      typeof r.amount === "number" ? r.amount : parseFloat(String(r.amount ?? "").replace(/[^0-9.-]/g, "")),
    ).toFixed(2),
    String(r.commission_type ?? "").trim().toLowerCase(),
  ].join("|");

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Pulls live deposits for the caller (and, for admins, every broker with a
 * connected Maestro account) and shapes them like register rows.
 */
export async function fetchLiveRegisterRows(
  admin: any,
  userId: string,
  isAdmin: boolean,
  years: number[],
  cid: string,
  agentFilter?: string | null,
): Promise<LiveResult> {
  const failures: LiveResult["failures"] = [];
  const brokers: string[] = [];
  const out: LiveRegisterRow[] = [];

  const from = `${Math.min(...years)}-01-01 00:00:00`;
  const to = `${Math.max(...years)}-12-31 23:59:59`;

  type Src = { token: string; label: string; user_id: string; maestro_id: string | null };
  const sources: Src[] = [];

  const { data: me } = await admin
    .from("planipret_profiles")
    .select("user_id, full_name, email, maestro_broker_id")
    .eq("user_id", userId)
    .maybeSingle();

  const myToken = await getUserMaestroAccessToken(admin, userId).catch(() => null);
  if (myToken) {
    sources.push({
      token: myToken,
      label: String(me?.full_name ?? me?.email ?? "moi"),
      user_id: userId,
      maestro_id: me?.maestro_broker_id != null ? String(me.maestro_broker_id) : null,
    });
  }

  let total = 1;
  if (isAdmin) {
    const [{ data: peers }, { count }] = await Promise.all([
      admin
        .from("planipret_profiles")
        .select("id, user_id, full_name, email, maestro_broker_id")
        .eq("maestro_connected", true)
        .limit(300),
      admin.from("planipret_profiles").select("id", { count: "exact", head: true }),
    ]);
    total = Number(count ?? 0) || 1;
    for (const p of peers ?? []) {
      const pid = (p as any).user_id ?? (p as any).id;
      if (!pid || pid === userId) continue;
      const label = String((p as any).full_name ?? (p as any).email ?? pid);
      const t = await getUserMaestroAccessToken(admin, pid).catch(() => null);
      if (!t) {
        failures.push({ broker: label, status: 409, message: "maestro_not_connected" });
        continue;
      }
      sources.push({
        token: t,
        label,
        user_id: pid,
        maestro_id: (p as any).maestro_broker_id != null ? String((p as any).maestro_broker_id) : null,
      });
    }
  }

  let seq = -1;
  for (const src of sources) {
    brokers.push(src.label);
    let page = 1;
    while (page <= MAX_PAGES) {
      const qs = buildDepositQuery({ date_from: from, date_to: to, page, per_page: 200 });
      const r = await commissionGet(`/api/main/commissions/reports/deposits?${qs}`, src.token, cid);
      if (!r.ok) {
        failures.push({ broker: src.label, status: r.status, message: String(r.data?.message ?? `HTTP ${r.status}`) });
        break;
      }
      const rows: CommissionDepositRow[] = Array.isArray(r.data?.data) ? r.data.data : [];
      for (const row of rows) {
        const date = row.date_trans ? String(row.date_trans).slice(0, 10) : null;
        const name = String(row.agent_name ?? row.target_name ?? src.label ?? "").trim() || src.label;
        if (agentFilter && name.toLowerCase() !== agentFilter.toLowerCase()) continue;
        out.push({
          number: row.number ?? null,
          loan_amt: num(row.loan_amt),
          institution: row.institution ?? null,
          amount: num(row.amount),
          mortgage_type: row.mortgage_type ?? null,
          term: row.term != null ? String(row.term) : null,
          agent_name: name,
          target_name: row.target_name ?? null,
          date_trans: date,
          commission_type: row.commission_type ?? "base",
          source_row: seq--,
          broker_user_id: src.user_id,
          maestro_broker_id: row.agent_name_id != null ? String(row.agent_name_id) : src.maestro_id,
          cabinet: row.cabinet ?? null,
          fiscal_year: date ? Number(date.slice(0, 4)) : null,
          agent_key: null,
          first_name: null,
          last_name: null,
          sheet_name: "maestro",
          provenance: "maestro",
        });
      }
      const meta = r.data?.meta ?? {};
      const lastPage = Number(meta.last_page ?? 1);
      if (page >= lastPage || rows.length === 0) break;
      page += 1;
    }
  }

  return {
    rows: out,
    coverage: { connected: sources.length, total: Math.max(total, sources.length) },
    failures,
    brokers,
  };
}
