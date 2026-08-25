import { describe, expect, it } from "vitest";
import {
  periodVolume,
  periodDeals,
  periodCommission,
  volumeTranches,
  metrics,
  helperFlags,
  yoy,
  yearWindow,
  resolveWindow,
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

  it("counts exact repeated amounts once and cancels negative reversals", () => {
    const rows = [
      row({ source_row: 1, loan_amt: 300_000, amount: 1_000 }),
      row({ source_row: 2, loan_amt: 300_000, amount: 0 }), // exact repeat -> ignored
      row({ source_row: 3, number: "PLPR-9", loan_amt: 250_000, amount: 500 }),
      row({ source_row: 4, number: "PLPR-9", loan_amt: -250_000, amount: 0 }), // reversal
    ];

    expect(periodVolume(rows, window)).toBe(300_000);
    expect(periodDeals(rows, window)).toBe(1);
    expect(periodCommission(rows, window)).toBe(1_500);
  });
});

describe("workbook spec conformance", () => {
  it("uses a calendar fiscal year (Jan 1 - Dec 31) with CY/PY twins", () => {
    expect(yearWindow(2026)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    const r = resolveWindow("ytd", 2026, 7);
    expect(r.window).toEqual({ start: "2026-01-01", end: "2026-07-31" });
    expect(r.priorWindow).toEqual({ start: "2025-01-01", end: "2025-07-31" });
  });

  it("applies the YoY rule IF(PY=0, IF(CY=0,'—','New'), (CY-PY)/PY)", () => {
    expect(yoy(0, 0)).toBe("—");
    expect(yoy(10, 0)).toBe("New");
    expect(yoy(150, 100)).toBeCloseTo(0.5);
  });

  it("computes BPS as commission / volume x 10000 and flags W/X columns", () => {
    const rows = [
      row({ source_row: 1, loan_amt: 500_000, amount: 5_000 }),
      row({ source_row: 2, commission_type: "bonus", loan_amt: 0, amount: 1_000 }),
    ];
    const m = metrics(rows, window);
    expect(m.volume).toBe(500_000);
    expect(m.deals).toBe(1);
    expect(m.commission).toBe(6_000);
    expect(m.bps).toBeCloseTo(120);
    const flags = helperFlags(rows, window);
    expect(flags[0].unique_volume).toBe(1);
    expect(flags[0].unique_deal).toBe(1);
    expect(flags[1].unique_volume).toBe(0);
  });
});
