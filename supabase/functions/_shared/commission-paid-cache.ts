import { commissionDataVersion, sha256Hex, stableJson } from "./commission-version.ts";
import { paidSourceFilters, reusableCommissionSnapshot } from "./commission-snapshot-policy.ts";
import { collectPaidDeposits, type NormalizedFilters } from "./commission-reports.ts";

const inflight = new Map<string, Promise<Awaited<ReturnType<typeof collectPaidDeposits>>>>();

/** Already-authorized broker credential only; tokens never enter keys or payloads. */
export async function cachedPaidDeposits(admin: any, userId: string, brokerId: string, token: string, filters: NormalizedFilters, cid: string) {
  const financial = paidSourceFilters(filters, brokerId);
  const key = `paid-rows:${await sha256Hex(stableJson({ userId, brokerId, financial }))}`;
  const version = await commissionDataVersion(admin);
  const { data: snap } = await admin.from("planipret_commission_snapshots")
    .select("payload,fetched_at,data_version").eq("cache_key", key).maybeSingle();
  if (reusableCommissionSnapshot(snap, version, 15 * 60_000) && Array.isArray(snap.payload.rows)) {
    return { rows: snap.payload.rows, total: snap.payload.rows.length, truncated: false, fatal: null };
  }
  const hit = inflight.get(key);
  if (hit) return hit;
  const job = (async () => {
    const result = await collectPaidDeposits(token, financial as NormalizedFilters, cid);
    if (!result.fatal && !result.truncated) {
      await admin.from("planipret_commission_snapshots").upsert({
        cache_key: key, user_id: userId,
        request_body: { action: "paid_rows_internal", filters: financial },
        payload: { ok: true, rows: result.rows }, data_version: version,
        fetched_at: new Date().toISOString(), last_accessed_at: new Date().toISOString(), refreshing_until: null,
      });
    }
    return result;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}