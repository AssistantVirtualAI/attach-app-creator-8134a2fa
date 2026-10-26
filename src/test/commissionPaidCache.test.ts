import { describe, expect, it, vi } from "vitest";
import { cachedPaidDeposits } from "../../supabase/functions/_shared/commission-paid-cache";

describe("stored paid rows reuse", () => {
  it("summary and deposits reuse identical broker rows without a Maestro request", async () => {
    const rows = [{ number: "C1", amount: 100.25, commission_type: "base", date_trans: "2026-10-26" }];
    const keys: string[] = [];
    const admin = { from: (table: string) => {
      const q: any = {
        select: () => q,
        eq: (field: string, value: string) => { if (field === "cache_key") keys.push(value); return q; },
        maybeSingle: async () => ({ data: table === "planipret_commission_source_state" ? { set_hash: "v1" } : { payload: { ok: true, rows }, data_version: "v1", fetched_at: "2025-01-01" } }),
      };
      return q;
    } };
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected Maestro read"));
    try {
      const s = await cachedPaidDeposits(admin, "user", "93135", "test-token", { date_from: "2026-01-01", sort: "asc" }, "test");
      const d = await cachedPaidDeposits(admin, "user", "93135", "test-token", { date_from: "2026-01-01", sort: "desc", page: 2 }, "test");
      expect(s.rows).toEqual(rows);
      expect(d.rows).toEqual(s.rows);
      expect(keys[0]).toBe(keys[1]);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});