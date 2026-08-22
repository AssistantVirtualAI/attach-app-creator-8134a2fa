import { describe, it, expect } from "vitest";
import {
  normalizeFilters,
  buildDepositQuery,
  summarize,
} from "../../supabase/functions/_shared/commission-reports";

describe("commission report filters", () => {
  it("rejects non-numeric users_id and unknown commission types", () => {
    const { errors } = normalizeFilters({ users_id: "abc'; drop--", commission_type: "hack" });
    expect(errors.users_id).toBeTruthy();
    expect(errors.commission_type).toBeTruthy();
  });

  it("requires both dates and a valid order", () => {
    expect(normalizeFilters({ date_from: "2026-01-01" }).errors.date_to).toBeTruthy();
    expect(normalizeFilters({ date_from: "2026-05-01", date_to: "2026-01-01" }).errors.date_to).toBeTruthy();
  });

  it("expands a valid range to full days", () => {
    const { filters, errors } = normalizeFilters({ date_from: "2026-01-01", date_to: "2026-01-31" });
    expect(errors).toEqual({});
    expect(filters.date_from).toBe("2026-01-01 00:00:00");
    expect(filters.date_to).toBe("2026-01-31 23:59:59");
  });

  it("caps per_page and defaults the deposit query", () => {
    expect(normalizeFilters({ per_page: 5000 }).errors.per_page).toBeTruthy();
    const qs = buildDepositQuery({ users_id: "93135" });
    expect(qs.get("users_id")).toBe("93135");
    expect(qs.get("commission_type")).toBe("base");
    expect(qs.get("order_by")).toBe("date_trans");
    expect(qs.get("per_page")).toBe("50");
  });
});

describe("commission summary", () => {
  it("aggregates totals, institutions and dates", () => {
    const s = summarize([
      { amount: "1500.50", loan_amt: "300000", institution: "BNC", date_trans: "2026-01-05", is_adjustment: 0 },
      { amount: "500", loan_amt: "100000", institution: "BNC", date_trans: "2026-01-05", is_adjustment: 1 },
      { amount: "1000", loan_amt: "250000", institution: "Desjardins", date_trans: "2026-02-01", is_adjustment: 0 },
    ] as any);
    expect(s.total_commission).toBe(3000.5);
    expect(s.deposit_count).toBe(3);
    expect(s.total_loan_volume).toBe(650000);
    expect(s.adjustments).toBe(1);
    expect(s.top_institutions[0]).toEqual({ institution: "BNC", amount: 2000.5, count: 2 });
    expect(s.by_date.map((d) => d.date)).toEqual(["2026-01-05", "2026-02-01"]);
  });
});
