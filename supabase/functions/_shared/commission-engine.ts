// Commission engine — implements the authoritative broker analytics logic.
// VOLUME: base rows, loan_amt > 0, in window; unique key number|institution|mortgage_type|loan_amt,
//         first row in source order wins, sum loan_amt.
// DEALS:  base rows in window, one row per contract number (first source-order row wins).
// COMMISSION: sum of `amount` for every row in window, all commission types, no dedup.

export interface RegisterRow {
  number: string | null;
  loan_amt: number | null;
  institution: string | null;
  amount: number | null;
  mortgage_type: string | null;
  term: string | null;
  agent_name: string | null;
  date_trans: string | null;
  commission_type: string | null;
  source_row: number;
  broker_user_id?: string | null;
}

export interface Window { start: string; end: string } // inclusive yyyy-mm-dd

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const isBase = (r: RegisterRow) => (r.commission_type ?? "").trim().toLowerCase() === "base";

export function inWindow(r: RegisterRow, w: Window): boolean {
  const d = r.date_trans;
  if (!d) return false;
  return d >= w.start && d <= w.end;
}

export function sortSource<T extends { source_row: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.source_row - b.source_row);
}

export interface Criteria {
  institution?: string;
  mortgage_type?: string;
  term?: string;
  broker?: string; // agent_name
}

function matches(r: RegisterRow, c: Criteria): boolean {
  if (c.institution !== undefined && (r.institution ?? "") !== c.institution) return false;
  if (c.mortgage_type !== undefined && (r.mortgage_type ?? "") !== c.mortgage_type) return false;
  if (c.term !== undefined && (r.term ?? "") !== c.term) return false;
  if (c.broker !== undefined && (r.agent_name ?? "") !== c.broker) return false;
  return true;
}

/** Unique volume tranches retained for a window (attribution = first base row of the key). */
export function volumeTranches(rows: RegisterRow[], w: Window): RegisterRow[] {
  const seen = new Set<string>();
  const out: RegisterRow[] = [];
  for (const r of sortSource(rows)) {
    if (!isBase(r) || n(r.loan_amt) <= 0 || !inWindow(r, w)) continue;
    const key = `${r.number ?? ""}|${r.institution ?? ""}|${r.mortgage_type ?? ""}|${n(r.loan_amt).toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Unique contracts retained for a window (attribution = first base row of the contract). */
export function dealContracts(rows: RegisterRow[], w: Window): RegisterRow[] {
  const seen = new Set<string>();
  const out: RegisterRow[] = [];
  for (const r of sortSource(rows)) {
    if (!isBase(r) || !inWindow(r, w)) continue;
    const key = r.number ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function periodVolume(rows: RegisterRow[], w: Window, c: Criteria = {}): number {
  return volumeTranches(rows, w).filter((r) => matches(r, c)).reduce((s, r) => s + n(r.loan_amt), 0);
}

export function periodDeals(rows: RegisterRow[], w: Window, c: Criteria = {}): number {
  return dealContracts(rows, w).filter((r) => matches(r, c)).length;
}

export function periodCommission(rows: RegisterRow[], w: Window, c: Criteria = {}): number {
  return rows.filter((r) => inWindow(r, w) && matches(r, c)).reduce((s, r) => s + n(r.amount), 0);
}

export interface Metrics {
  volume: number;
  deals: number;
  commission: number;
  avgDeal: number;
  bps: number;
  commissionPerDeal: number;
}

export function metrics(rows: RegisterRow[], w: Window, c: Criteria = {}): Metrics {
  const volume = periodVolume(rows, w, c);
  const deals = periodDeals(rows, w, c);
  const commission = periodCommission(rows, w, c);
  return {
    volume,
    deals,
    commission,
    avgDeal: deals ? volume / deals : 0,
    bps: volume ? (commission / volume) * 10000 : 0,
    commissionPerDeal: deals ? commission / deals : 0,
  };
}

export function yoy(cy: number, py: number): number | "—" | "New" {
  if (!py) return cy ? "New" : "—";
  return (cy - py) / py;
}

const pad = (x: number) => String(x).padStart(2, "0");
export const dstr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const monthEndDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthWindow = (y: number, m: number): Window => ({
  start: dstr(y, m, 1),
  end: dstr(y, m, monthEndDay(y, m)),
});
export const ytdWindow = (y: number, throughMonth: number): Window => ({
  start: dstr(y, 1, 1),
  end: dstr(y, throughMonth, monthEndDay(y, throughMonth)),
});
export const quarterWindow = (y: number, q: number): Window => ({
  start: dstr(y, q * 3 - 2, 1),
  end: dstr(y, q * 3, monthEndDay(y, q * 3)),
});
/** Club Excellence season: Aug 1 (y) -> Jul 31 (y+1) */
export const seasonWindow = (y: number): Window => ({ start: dstr(y, 8, 1), end: dstr(y + 1, 7, 31) });
