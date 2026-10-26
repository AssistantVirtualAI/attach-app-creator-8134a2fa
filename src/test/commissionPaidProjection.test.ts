import { describe, expect, it } from "vitest";
import { paidBrokerProjection, paidReportRequest } from "../../supabase/functions/_shared/commission-paid-projection";
import { summarize } from "../../supabase/functions/_shared/commission-reports";

describe("one validated paid report for every screen", () => {
  const base = { number: "fixture", amount: 100, loan_amt: 300000, agent_name_id: 1, target_name_id: 1, date_trans: "2026-10-26", commission_type: "base" };
  it("keeps the 1316 commission contribution identical in both projections", () => {
    const rows = [base, { ...base, amount: 1316, commission_type: "bonus" }] as any;
    expect(paidBrokerProjection(rows).totals.total).toBe(1416);
    expect(paidBrokerProjection(rows).totals.total).toBe(summarize(rows).total_commission);
  });
  it("retains legitimate equal lines and all categories without widening own files", () => {
    const rows = [base, base, { ...base, number: "peer", target_name_id: 2, amount: 30 }, { ...base, amount: -20, is_adjustment: 1 }, { ...base, amount: 10, commission_type: "bonus2" }] as any;
    const p = paidBrokerProjection(rows);
    expect(p.totals.total).toBe(220);
    expect(p.agents[0].files).toBe(1);
    expect(p.totals.loan_volume).toBe(300000);
    expect(p.totals.total).toBe(summarize(rows).total_commission);
  });
  it("shares the action identity without mixing pending or broker scope", () => {
    const filters = { users_id: "93135", date_from: "2026-01-01", date_to: "2026-10-26" };
    expect(paidReportRequest({ action: "by_agent", filters })).toEqual({ action: "summary", filters });
    expect(paidReportRequest({ action: "pending", filters }).action).toBe("pending");
  });
});