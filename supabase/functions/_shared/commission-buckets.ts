// Per-broker / per-year pre-shaped commission rows kept server-side.
//
// The admin "all brokers" view used to page through the whole register and
// the whole live Maestro cache (~70k rows, ~70 queries) on every rebuild,
// which regularly blew the function budget. Rows are now packed once into
// small buckets (`reg:<year>`, `live:<owner>:<year>`); only buckets whose
// source rows changed (updated_at moved, or a row vanished) are rebuilt.
// Reading the global view is then a single query over ready-made buckets.
// The rows are byte-for-byte the same projection as before, so the figures
// computed from them are identical.
import { fastHash } from "./commission-version.ts";

export type BucketKind = "reg" | "live";

export const REG_COLS = [
  "number", "loan_amt", "institution", "amount", "mortgage_type", "term", "agent_name", "target_name",
  "date_trans", "commission_type", "is_adjustment", "source_row", "broker_user_id", "first_name", "last_name",
  "maestro_broker_id", "agent_key", "cabinet", "fiscal_year", "sheet_name",
] as const;
const REG_SELECT = REG_COLS.join(",");

export const LIVE_COLS = [
  "broker_user_id", "broker_label", "maestro_broker_id", "agent_name", "date_trans", "fiscal_year", "synced_at",
  "number", "loan_amt", "institution", "amount", "mortgage_type", "term", "target_name", "commission_type",
  "is_adjustment", "cabinet",
] as const;
const LIVE_SELECT = "broker_user_id, broker_label, maestro_broker_id, agent_name, date_trans, fiscal_year, synced_at, number:row_data->number, loan_amt:row_data->loan_amt, institution:row_data->institution, amount:row_data->amount, mortgage_type:row_data->mortgage_type, term:row_data->term, target_name:row_data->target_name, commission_type:row_data->commission_type, is_adjustment:row_data->is_adjustment, cabinet:row_data->cabinet";

const TABLE = "planipret_commission_broker_aggregates";
const SRC: Record<BucketKind, string> = { reg: "planipret_commission_register", live: "planipret_commission_live_cache" };
const COLS: Record<BucketKind, readonly string[]> = { reg: REG_COLS, live: LIVE_COLS };
const PAGE = 1000;

export const pack = (rows: any[], cols: readonly string[]) => rows.map((r) => cols.map((c) => r?.[c] ?? null));
export const unpack = (rows: unknown[][], cols: readonly string[]) =>
  rows.map((a) => { const o: Record<string, unknown> = {}; cols.forEach((c, i) => { o[c] = a?.[i] ?? null; }); return o; });

export function liveOwnerKey(r: { broker_user_id?: string | null; maestro_broker_id?: string | null }): string {
  if (r.broker_user_id) return `u:${r.broker_user_id}`;
  if (r.maestro_broker_id) return `m:${r.maestro_broker_id}`;
  return "none";
}

export function bucketKeyOf(kind: BucketKind, r: any): string | null {
  const y = Number(r?.fiscal_year);
  if (!Number.isFinite(y) || !y) return null;
  return kind === "reg" ? `reg:${y}` : `live:${liveOwnerKey(r)}:${y}`;
}

export function parseBucketKey(key: string): { kind: BucketKind; owner: string | null; year: number } | null {
  const m = /^reg:(\d{4})$/.exec(key);
  if (m) return { kind: "reg", owner: null, year: Number(m[1]) };
  const l = /^live:(.+):(\d{4})$/.exec(key);
  if (l) return { kind: "live", owner: l[1], year: Number(l[2]) };
  return null;
}

/** True when the stored meta still matches the source table signature. */
export function isFresh(meta: { row_count?: number; source_max_updated_at?: string | null } | null, count: number, maxUpdated: string | null) {
  if (!meta) return false;
  return Number(meta.row_count) === count && (meta.source_max_updated_at ?? null) === (maxUpdated ?? null);
}

function scoped(admin: any, kind: BucketKind, owner: string | null, year: number) {
  let q = admin.from(SRC[kind]).select(kind === "reg" ? REG_SELECT : LIVE_SELECT).eq("fiscal_year", year);
  if (kind === "live") {
    if (owner?.startsWith("u:")) q = q.eq("broker_user_id", owner.slice(2));
    else if (owner?.startsWith("m:")) q = q.is("broker_user_id", null).eq("maestro_broker_id", owner.slice(2));
    else q = q.is("broker_user_id", null).is("maestro_broker_id", null);
  }
  return q.order(kind === "reg" ? "source_row" : "id", { ascending: true });
}

async function writeBucket(admin: any, kind: BucketKind, key: string, owner: string | null, year: number, rows: any[]) {
  const packed = pack(rows, COLS[kind]);
  await admin.from(TABLE).upsert({
    bucket_key: key, kind, owner_key: owner, fiscal_year: year, rows: packed, row_count: packed.length,
    data_hash: fastHash(JSON.stringify(packed)), built_at: new Date().toISOString(),
  }, { onConflict: "bucket_key" });
}

async function rebuildOne(admin: any, key: string) {
  const p = parseBucketKey(key);
  if (!p) return;
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await scoped(admin, p.kind, p.owner, p.year).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  if (rows.length === 0) { await admin.from(TABLE).delete().eq("bucket_key", key); return; }
  await writeBucket(admin, p.kind, key, p.owner, p.year, rows);
}

async function rebuildAll(admin: any, kind: BucketKind) {
  const groups = new Map<string, any[]>();
  const select = kind === "reg" ? REG_SELECT : LIVE_SELECT;
  for (let from = 0; from < 300000; from += PAGE) {
    const { data, error } = await admin.from(SRC[kind]).select(select).not("fiscal_year", "is", null)
      .order(kind === "reg" ? "source_row" : "id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const k = bucketKeyOf(kind, r);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    if (!data || data.length < PAGE) break;
  }
  for (const [k, rows] of groups) {
    const p = parseBucketKey(k)!;
    await writeBucket(admin, kind, k, p.owner, p.year, rows);
  }
  const { data: existing } = await admin.from(TABLE).select("bucket_key").eq("kind", kind);
  const stale = ((existing ?? []) as any[]).map((e) => e.bucket_key).filter((k) => !groups.has(k));
  for (let i = 0; i < stale.length; i += 200) await admin.from(TABLE).delete().in("bucket_key", stale.slice(i, i + 200));
}

async function signature(admin: any, kind: BucketKind) {
  const [{ count, error }, { data: last }] = await Promise.all([
    admin.from(SRC[kind]).select("id", { count: "exact", head: true }).not("fiscal_year", "is", null),
    admin.from(SRC[kind]).select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  return { count: Number(count ?? 0), maxUpdated: (last as any)?.updated_at ?? null };
}

/**
 * Makes the buckets of one kind match their source table. Unchanged source =>
 * three tiny reads and nothing else. Changed rows => only their buckets are
 * rebuilt. A vanished row (count mismatch) => full rebuild of that kind.
 */
export async function ensureBuckets(admin: any, kind: BucketKind): Promise<{ fresh: boolean; rebuilt: number; full: boolean }> {
  const metaKey = `meta:${kind}`;
  const [{ data: meta }, sig] = await Promise.all([
    admin.from(TABLE).select("row_count, source_max_updated_at").eq("bucket_key", metaKey).maybeSingle(),
    signature(admin, kind),
  ]);
  if (isFresh(meta as any, sig.count, sig.maxUpdated)) return { fresh: true, rebuilt: 0, full: false };

  let rebuilt = 0, full = !meta;
  if (meta && (meta as any).source_max_updated_at) {
    const keys = new Set<string>();
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await admin.from(SRC[kind])
        .select(kind === "reg" ? "fiscal_year" : "fiscal_year, broker_user_id, maestro_broker_id")
        .gt("updated_at", (meta as any).source_max_updated_at).not("fiscal_year", "is", null)
        .order("updated_at", { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) { const k = bucketKeyOf(kind, r); if (k) keys.add(k); }
      if (!data || data.length < PAGE) break;
    }
    for (const k of keys) { await rebuildOne(admin, k); rebuilt++; }
    const { data: sums } = await admin.from(TABLE).select("row_count").eq("kind", kind);
    const total = ((sums ?? []) as any[]).reduce((s, r) => s + Number(r.row_count ?? 0), 0);
    if (total !== sig.count) full = true;
  } else full = true;

  if (full) { await rebuildAll(admin, kind); rebuilt = -1; }
  await admin.from(TABLE).upsert({
    bucket_key: metaKey, kind: `meta_${kind}`, owner_key: null, fiscal_year: null, rows: [],
    row_count: sig.count, source_max_updated_at: sig.maxUpdated, built_at: new Date().toISOString(),
  }, { onConflict: "bucket_key" });
  return { fresh: false, rebuilt, full };
}

/** Reads every bucket of a kind for the given years; null when never built. */
export async function readBuckets(admin: any, kind: BucketKind, years: number[]): Promise<Record<string, unknown>[] | null> {
  const { data: meta } = await admin.from(TABLE).select("bucket_key").eq("bucket_key", `meta:${kind}`).maybeSingle();
  if (!meta) return null;
  const { data, error } = await admin.from(TABLE).select("rows").eq("kind", kind).in("fiscal_year", years);
  if (error) throw new Error(error.message);
  const out: Record<string, unknown>[] = [];
  for (const b of (data ?? []) as any[]) out.push(...unpack(Array.isArray(b.rows) ? b.rows : [], COLS[kind]));
  return out;
}
