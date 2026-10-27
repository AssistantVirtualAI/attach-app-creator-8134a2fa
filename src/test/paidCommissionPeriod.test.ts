import { describe, expect, it } from "vitest";
import { paidCommissionPeriod } from "../lib/planipret/paidCommissionPeriod";

describe("paid period parity across commissions, broker charts and mobile", () => {
  const now = new Date("2026-10-26T19:49:00Z");
  it("Scott's 2026 annual report starts December 30, 2025 through Toronto today", () => {
    expect(paidCommissionPeriod(2026, "year", 1, now)).toEqual({ date_from: "2025-12-30", date_to: "2026-10-26" });
  });
  it("a completed year remains complete", () => {
    expect(paidCommissionPeriod(2025, "year", 1, now)).toEqual({ date_from: "2025-01-01", date_to: "2025-12-31" });
  });
  it("current quarter uses the same cutoff, not future deposits", () => {
    expect(paidCommissionPeriod(2026, "quarter", 4, now)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-26" });
  });
  it("current month uses the same cutoff", () => {
    expect(paidCommissionPeriod(2026, "month", 10, now)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-26" });
  });
});