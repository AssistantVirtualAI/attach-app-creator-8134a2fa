import { describe, expect, it } from "vitest";
import {
  periodVolume,
  periodDeals,
  periodCommission,
  volumeTranches,
  type RegisterRow,
} from "../../supabase/functions/_shared/commission-engine";

const window = { start: "2026-01-01", end: "2026-12-31" };

const row = (overrides: Partial<RegisterRow>): RegisterRow => ({
  number: "PLPR-1",
  loan_amt: 300_000,
  institution: "Prêteur A",
  amount: 2_000,
  mortgage_type: "Renouvellement",
  term: "5 ans",
  agent_name: "Courtier",
  date_trans: "2026-04-10",
  commission_type: "base",
  source_row: 1,
  broker_user_id: "broker-1",
  ...overrides,
});

describe("commission volume rules", () => {
  it("counts every funding row, including two products on the same contract", () => {
    const rows = [
      row({ source_row: 1, loan_amt: 200_000 }),
      row({ source_row: 2, mortgage_type: "Marge Hypothécaire", loan_amt: 100_000 }),
    ];

    expect(volumeTranches(rows, window)).toHaveLength(2);
    expect(periodVolume(rows, window)).toBe(300_000);
    expect(periodDeals(rows, window)).toBe(1); // one unique contract number
  });

  it("excludes adjustment rows from volume and deals but keeps them in commissions", () => {
    const rows = [
      row({ source_row: 1, loan_amt: 200_000, amount: 1_000 }),
      row({ source_row: 2, number: "PLPR-2", loan_amt: 150_000, amount: 800, is_adjustment: "1" }),
    ];

    expect(periodVolume(rows, window)).toBe(200_000);
    expect(periodDeals(rows, window)).toBe(1);
    expect(periodCommission(rows, window)).toBe(1_800);
  });

  it("excludes insurance payouts everywhere", () => {
    const rows = [
      row({ source_row: 1, loan_amt: 200_000, amount: 1_000 }),
      row({ source_row: 2, number: "PLPR-3", loan_amt: 0, amount: 158.86, institution: "Lepelco Assurances Inc" }),
      row({ source_row: 3, number: "PLPR-4", loan_amt: 0, amount: 102.53, institution: "Desjardins Assurances" }),
    ];

    expect(periodVolume(rows, window)).toBe(200_000);
    expect(periodDeals(rows, window)).toBe(1);
    expect(periodCommission(rows, window)).toBe(1_000);
  });

  it("keeps identical contract numbers from different brokers distinct", () => {
    const rows = [
      row({ source_row: 1, broker_user_id: "broker-1" }),
      row({ source_row: 2, broker_user_id: "broker-2", loan_amt: 400_000 }),
    ];

    expect(periodVolume(rows, window)).toBe(700_000);
  });
});
