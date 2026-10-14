// Global commission data version: changes only when the 15-minute change probe
// detects new/modified/removed Maestro rows. Caches keyed on it never expire
// on time alone, so unchanged figures cost no Maestro call and no AI tokens.
export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function stableJson(v: unknown): string {
  const sort = (x: any): any => Array.isArray(x) ? x.map(sort)
    : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x;
  return JSON.stringify(sort(v));
}

/** Current global version, or null before the first probe has run. */
export async function commissionDataVersion(admin: any): Promise<string | null> {
  try {
    const { data } = await admin.from("planipret_commission_source_state")
      .select("set_hash").eq("maestro_broker_id", "*").eq("source", "global").maybeSingle();
    return (data as any)?.set_hash ?? null;
  } catch { return null; }
}

/** Cheap non-crypto row fingerprint (FNV-1a, two lanes) for change detection. */
export function fastHash(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export type RowDiff = { added: number; changed: number; removed: number; setHash: string };

/** Pure diff of a fetched row set against stored hashes. */
export async function diffRows(
  fetched: { key: string; data: unknown }[],
  stored: Map<string, string>,
): Promise<{ diff: RowDiff; upserts: { key: string; hash: string; data: unknown }[]; removedKeys: string[] }> {
  const upserts: { key: string; hash: string; data: unknown }[] = [];
  const seen = new Set<string>();
  const pairs: string[] = [];
  let added = 0, changed = 0;
  for (const r of fetched) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    const hash = fastHash(stableJson(r.data));
    pairs.push(`${r.key}:${hash}`);
    const prev = stored.get(r.key);
    if (prev === undefined) { added++; upserts.push({ key: r.key, hash, data: r.data }); }
    else if (prev !== hash) { changed++; upserts.push({ key: r.key, hash, data: r.data }); }
  }
  const removedKeys = [...stored.keys()].filter((k) => !seen.has(k));
  pairs.sort();
  const setHash = fastHash(pairs.join("\n")) + ":" + pairs.length;
  return { diff: { added, changed, removed: removedKeys.length, setHash }, upserts, removedKeys };
}

/** Order-independent identity: one key per distinct row content. */
export function contentKeyed(datas: unknown[]): { key: string; data: unknown }[] {
  const m = new Map<string, unknown>();
  for (const d of datas) { const h = fastHash(stableJson(d)); if (!m.has(h)) m.set(h, d); }
  return [...m.entries()].map(([key, data]) => ({ key, data }));
}

/**
 * Maestro pagination can drop a row on one read and return it on the next.
 * A new row is a change immediately; a missing row only once it is missing
 * on two consecutive probes. Pure, so it is unit-tested.
 */
export function decideChange(fetchedKeys: string[], storedKeys: Set<string>, prevMisses: Set<string>) {
  const seen = new Set(fetchedKeys);
  const added = fetchedKeys.filter((k) => !storedKeys.has(k));
  const missing = [...storedKeys].filter((k) => !seen.has(k));
  const confirmedRemoved = missing.filter((k) => prevMisses.has(k));
  const newMisses = missing.filter((k) => !prevMisses.has(k));
  return { added, confirmedRemoved, newMisses, changed: added.length > 0 || confirmedRemoved.length > 0 };
}
