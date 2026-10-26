import { describe, expect, it } from "vitest";
import { reusableCommissionSnapshot, paidSourceFilters, claimCommissionRefresh } from "../../supabase/functions/_shared/commission-snapshot-policy";

describe("commission snapshot CPU guard", () => {
  it("unchanged version reuses stored figures regardless of age", () => {
    expect(reusableCommissionSnapshot({ payload: { ok: true }, data_version: "v1", fetched_at: "2025-01-01" }, "v1", 900000)).toBe(true);
  });
  it("changed old version cannot masquerade as fresh", () => {
    expect(reusableCommissionSnapshot({ payload: { ok: true }, data_version: "v1", fetched_at: "2025-01-01" }, "v2", 900000)).toBe(false);
  });
  it("failure is never reusable", () => {
    expect(reusableCommissionSnapshot({ payload: { ok: false }, data_version: "v1" }, "v1", 900000)).toBe(false);
  });
  it("different paid actions share financial filters without widening broker scope", () => {
    expect(paidSourceFilters({ users_id: "93135", date_from: "2026-01-01", commission_type: "bonus2", page: 2, sort: "desc" })).toEqual({ users_id: "93135", date_from: "2026-01-01", commission_type: "bonus2" });
  });
  it("active lease starts no second recalculation", async () => {
    let writes = 0;
    const admin = { from: () => { writes++; throw new Error("must not write"); } };
    expect(await claimCommissionRefresh(admin, "stats:test", "2026-10-26T20:10:00Z", Date.parse("2026-10-26T20:00:00Z"))).toBe(false);
    expect(writes).toBe(0);
  });
});