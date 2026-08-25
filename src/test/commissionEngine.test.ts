import { describe, expect, it } from "vitest";
import { periodVolume, volumeTranches, type RegisterRow } from "../../supabase/functions/_shared/commission-engine";

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

describe("commission volume deduplication", () => {
  it("counts a contract and product only once even when lender or amount differs", () => {
    const rows = [
      row({ source_row: 1, loan_amt: 300_000 }),
      row({ source_row: 2, institution: "Prêteur B", loan_amt: 325_000 }),
    ];

    expect(volumeTranches(rows, window)).toHaveLength(1);
    expect(periodVolume(rows, window)).toBe(300_000);
  });

  it("normalizes contract and product casing while preserving distinct products", () => {
    const rows = [
      row({ source_row: 1 }),
      row({ source_row: 2, number: " plpr-1 ", mortgage_type: " renouvellement " }),
      row({ source_row: 3, mortgage_type: "Achat", loan_amt: 425_000 }),
    ];

    expect(volumeTranches(rows, window)).toHaveLength(2);
    expect(periodVolume(rows, window)).toBe(725_000);
  });

  it("does not merge matching contracts belonging to different brokers", () => {
    const rows = [
      row({ source_row: 1, broker_user_id: "broker-1" }),
      row({ source_row: 2, broker_user_id: "broker-2", loan_amt: 400_000 }),
    ];

    expect(periodVolume(rows, window)).toBe(700_000);
  });
});