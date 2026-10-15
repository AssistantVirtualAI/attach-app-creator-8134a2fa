import { assert, assertEquals } from "jsr:@std/assert@1";
import { bucketKeyOf, isFresh, LIVE_COLS, liveOwnerKey, pack, parseBucketKey, REG_COLS, unpack } from "./commission-buckets.ts";

Deno.test("pack/unpack keeps every projected field identical", () => {
  const row = Object.fromEntries(REG_COLS.map((c, i) => [c, c === "loan_amt" ? 250000.5 : `v${i}`]));
  const back = unpack(pack([row], REG_COLS), REG_COLS)[0];
  assertEquals(back, row);
  const live = Object.fromEntries(LIVE_COLS.map((c) => [c, null]));
  assertEquals(unpack(pack([live], LIVE_COLS), LIVE_COLS)[0], live);
});

Deno.test("live rows are bucketed by owner then year, never mixed", () => {
  assertEquals(liveOwnerKey({ broker_user_id: "u1", maestro_broker_id: "9" }), "u:u1");
  assertEquals(liveOwnerKey({ broker_user_id: null, maestro_broker_id: "9" }), "m:9");
  assertEquals(liveOwnerKey({}), "none");
  assertEquals(bucketKeyOf("live", { broker_user_id: "u1", fiscal_year: 2026 }), "live:u:u1:2026");
  assertEquals(bucketKeyOf("reg", { fiscal_year: 2025 }), "reg:2025");
  assertEquals(bucketKeyOf("reg", { fiscal_year: null }), null);
});

Deno.test("bucket keys round-trip", () => {
  assertEquals(parseBucketKey("reg:2024"), { kind: "reg", owner: null, year: 2024 });
  assertEquals(parseBucketKey("live:m:93135:2026"), { kind: "live", owner: "m:93135", year: 2026 });
  assertEquals(parseBucketKey("meta:live"), null);
});

Deno.test("unchanged source => fresh (no rebuild); any change => stale", () => {
  const meta = { row_count: 10, source_max_updated_at: "2026-10-15T21:00:00Z" };
  assert(isFresh(meta, 10, "2026-10-15T21:00:00Z"));
  assert(!isFresh(meta, 11, "2026-10-15T21:00:00Z"));
  assert(!isFresh(meta, 9, "2026-10-15T21:00:00Z"));
  assert(!isFresh(meta, 10, "2026-10-15T21:15:00Z"));
  assert(!isFresh(null, 0, null));
});
