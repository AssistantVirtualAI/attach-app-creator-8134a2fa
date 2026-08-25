// Commission engine — implements the authoritative broker analytics logic.
// Reference: Maestro "Broker Analytics Dashboard".
// EXCLUDED EVERYWHERE: insurance payouts (institution containing "assurance").
// VOLUME: base rows, loan_amt > 0, in window, excluding adjustment rows (is_adjustment = 1).
// DEALS:  distinct contract number over those same base rows.
// COMMISSION: sum of `amount` for every row in window, all commission types,
//             adjustments included, no dedup.

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
  is_adjustment?: unknown;
}

export interface Window { start: string; end: string } // inclusive yyyy-mm-dd

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const isBase = (r: RegisterRow) => (r.commission_type ?? "").trim().toLowerCase() === "base";

/** Maestro flags reversals/corrections with `is_adjustment = 1`; they never count as volume or deals. */
export const isAdjustment = (r: RegisterRow) => {
  const v = r.is_adjustment;
  if (v === null || v === undefined || v === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "y" || s === "yes" || s === "oui";
};

/** Insurance payouts (Lepelco, Desjardins Assurances, ...) are outside broker analytics. */
export const isInsurance = (r: RegisterRow) => /assurance/i.test(r.institution ?? "");

/**
 * A row is only usable for KPIs when Maestro gave it a transaction date.
 * Undated rows (adjustments pushed without `date_trans`) are excluded from
 * volume, deals, commissions and YoY everywhere.
 */
export function hasTransactionDate(r: { date_trans?: string | null }): boolean {
  const d = (r.date_trans ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(d);
}

/** Splits rows into the dated ones (used in calculations) and the undated ones. */
export function splitUndated<T extends { date_trans?: string | null }>(rows: T[]): { dated: T[]; undated: T[] } {
  const dated: T[] = []; const undated: T[] = [];
  for (const r of rows) (hasTransactionDate(r) ? dated : undated).push(r);
  return { dated, undated };
}

export function inWindow(r: RegisterRow, w: Window): boolean {
  if (!hasTransactionDate(r)) return false;
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

const normalizedKeyPart = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase("fr-CA");

/** Base funding rows counted in volume (no adjustments, no insurance). */
export function volumeTranches(rows: RegisterRow[], w: Window): RegisterRow[] {
  return sortSource(rows).filter(
    (r) => isBase(r) && !isAdjustment(r) && !isInsurance(r) && n(r.loan_amt) > 0 && inWindow(r, w),
  );
}

/** Unique contracts retained for a window (attribution = first funding row of the contract). */
export function dealContracts(rows: RegisterRow[], w: Window): RegisterRow[] {
  const seen = new Set<string>();
  const out: RegisterRow[] = [];
  for (const r of volumeTranches(rows, w)) {
    const key = normalizedKeyPart(r.number);
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
  return rows
    .filter((r) => inWindow(r, w) && !isInsurance(r) && matches(r, c))
    .reduce((s, r) => s + n(r.amount), 0);
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

export const yearWindow = (y: number): Window => ({ start: dstr(y, 1, 1), end: dstr(y, 12, 31) });

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Monday of ISO week `w` of year `y`. */
function isoWeekMonday(y: number, w: number): Date {
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const dow = jan4.getUTCDay() || 7; // 1..7 (Mon..Sun)
  const week1Mon = new Date(jan4.getTime() - (dow - 1) * 86400000);
  return new Date(week1Mon.getTime() + (w - 1) * 7 * 86400000);
}

/** ISO week window (Mon → Sun). */
export function weekWindow(y: number, w: number): Window {
  const mon = isoWeekMonday(y, w);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  return { start: iso(mon), end: iso(sun) };
}

/** Number of ISO weeks in a year (52 or 53). */
export function isoWeeksInYear(y: number): number {
  const dec28 = new Date(Date.UTC(y, 11, 28));
  const dow = dec28.getUTCDay() || 7;
  const thu = new Date(dec28.getTime() + (4 - dow) * 86400000);
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  return Math.ceil(((thu.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
}

export type Granularity = "week" | "month" | "quarter" | "year" | "ytd";

/** Resolve the analysis window for a granularity + index, plus its prior-year twin. */
export function resolveWindow(
  granularity: Granularity,
  year: number,
  index: number,
): { window: Window; priorWindow: Window; label: string } {
  switch (granularity) {
    case "week": {
      const w = Math.min(isoWeeksInYear(year), Math.max(1, index));
      const pyW = Math.min(isoWeeksInYear(year - 1), w);
      return { window: weekWindow(year, w), priorWindow: weekWindow(year - 1, pyW), label: `S${w}` };
    }
    case "month": {
      const m = Math.min(12, Math.max(1, index));
      return { window: monthWindow(year, m), priorWindow: monthWindow(year - 1, m), label: `M${m}` };
    }
    case "quarter": {
      const q = Math.min(4, Math.max(1, index));
      return { window: quarterWindow(year, q), priorWindow: quarterWindow(year - 1, q), label: `Q${q}` };
    }
    case "year":
      return { window: yearWindow(year), priorWindow: yearWindow(year - 1), label: String(year) };
    default: {
      const m = Math.min(12, Math.max(1, index || 12));
      return { window: ytdWindow(year, m), priorWindow: ytdWindow(year - 1, m), label: `YTD ${m}` };
    }
  }
}

