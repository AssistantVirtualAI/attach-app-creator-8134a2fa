import { describe, expect, it } from "vitest";
import { commissionReportRequest } from "../lib/planipret/commissionReportRequest";

describe("one report request across portal and mobile", () => {
  it("identical broker and period share a financial request despite display sorting", () => {
    const filters = { date_from: "2026-01-01", date_to: "2026-10-26", users_id: "93135" };
    expect(commissionReportRequest({ action: "summary", filters: { ...filters, sort: "desc", order_by: "date_trans" } })).toEqual({ action: "summary", filters });
  });
  it("preserves broker, financial category and explicit refresh", () => {
    const body = { action: "pending", force: true, filters: { users_id: "93135", commission_type: "bonus2" } };
    expect(commissionReportRequest(body)).toEqual(body);
  });
  it("never strips deposit pagination or sorting", () => {
    const body = { action: "deposits", filters: { users_id: "93135", page: 2, per_page: 25, sort: "desc" } };
    expect(commissionReportRequest(body)).toEqual(body);
  });
});