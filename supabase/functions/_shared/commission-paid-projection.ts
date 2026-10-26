import { num, type CommissionDepositRow } from "./commission-reports.ts";

const dated = (r: CommissionDepositRow) => /^\d{4}-\d{2}-\d{2}/.test(String(r.date_trans ?? "").trim());
const cents = (n: number) => Math.round(n * 100) / 100;

/** Amounts keep all categories; units = distinct received Base contracts, volume = distinct contract+loan. */
export function paidBrokerProjection(rows: CommissionDepositRow[]) {
  const buckets = new Map<string, { users_id: number | null; name: string; total: number; count: number; files: Set<string>; loans: Map<string, number> }>();
  for (const r of rows) {
    if (!dated(r)) continue;
    const id = r.agent_name_id ?? null;
    const name = String(r.agent_name ?? r.target_name ?? "—").trim() || "—";
    const key = id == null ? `n:${name.toLowerCase()}` : `id:${id}`;
    const b = buckets.get(key) ?? { users_id: id, name, total: 0, count: 0, files: new Set<string>(), loans: new Map<string, number>() };
    b.total += num(r.amount); b.count++;
        const loan = num(r.loan_amt); const contract = String(r.number ?? "").trim();
    if (!String(r.date_trans).startsWith("0000") && String(r.commission_type ?? "base").toLowerCase() === "base" && Number(r.is_adjustment) !== 1 && loan > 0 && contract) {
      const tranche = `${contract}|${loan}`;
      b.files.add(contract); b.loans.set(tranche, loan);
    }
    buckets.set(key, b);
  }
  const agents = [...buckets.values()].map((b) => ({
    users_id: b.users_id, name: b.name, total: cents(b.total), count: b.count,
    files: b.files.size, loan_volume: cents([...b.loans.values()].reduce((t, x) => t + x, 0)),
    average: b.files.size ? cents(b.total / b.files.size) : 0,
  })).sort((a, b) => b.total - a.total);
  return { agents, totals: {
    total: agents.reduce((s, a) => s + Math.round(a.total * 100), 0) / 100,
    count: agents.reduce((s, a) => s + a.count, 0),
    loan_volume: agents.reduce((s, a) => s + Math.round(a.loan_volume * 100), 0) / 100,
    brokers: agents.length,
  } };
}

/** Both portal actions read one validated report, never independently collected figures. */
export function paidReportRequest(body: any) {
  return body?.action === "by_agent" ? { ...body, action: "summary" } : body;
}