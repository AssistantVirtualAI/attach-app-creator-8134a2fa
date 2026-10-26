/** A refresh must not fork unchanged financial versions. */
export function reusableCommissionSnapshot(snap: any, version: string | null, freshMs: number, now = Date.now()) {
  if (snap?.payload?.ok !== true) return false;
  const sameVersion = Boolean(version && snap.data_version === version);
  return sameVersion || now - new Date(snap.fetched_at).getTime() < freshMs;
}

/** One worker per snapshot; compare-and-set avoids concurrent rebuild storms. */
export async function claimCommissionRefresh(admin: any, key: string, previousUntil: string | null, now = Date.now()) {
  if (previousUntil && new Date(previousUntil).getTime() > now) return false;
  let q = admin.from("planipret_commission_snapshots").update({
    refreshing_until: new Date(now + 10 * 60_000).toISOString(),
    last_accessed_at: new Date(now).toISOString(),
  }).eq("cache_key", key);
  q = previousUntil ? q.eq("refreshing_until", previousUntil) : q.is("refreshing_until", null);
  const { data, error } = await q.select("cache_key");
  return !error && Array.isArray(data) && data.length === 1;
}

/** Request ordering/paging doesn't change the complete paid row set. */
export function paidSourceFilters(filters: Record<string, unknown>, usersId?: string | null) {
  const out = { ...filters };
  for (const k of ["page", "per_page", "order_by", "sort"]) delete out[k];
  if (usersId) out.users_id = usersId;
  return out;
}