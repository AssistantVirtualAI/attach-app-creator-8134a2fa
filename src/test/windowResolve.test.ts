import { afterEach, describe, it, expect, vi } from "vitest";
import { metrics, resolveWindow, yoy, type RegisterRow } from "../../supabase/functions/_shared/commission-engine";

const bnc = (date_trans: string, loan_amt: number, number: string): RegisterRow => ({
  number,
  loan_amt,
  institution: "BNC",
  amount: loan_amt / 100,
  mortgage_type: "Conventionnel",
  term: "5 ans",
  agent_name: "Jean-Éric Gagnon",
  date_trans,
  commission_type: "base",
  source_row: Number(number.replace(/\D/g, "")),
});

describe("windows", () => {
  afterEach(() => vi.useRealTimers());

  it("ytd caps to current month and aligns PY", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T16:23:00Z"));
    const r = resolveWindow("ytd", 2026, 12);
    expect(r.window).toEqual({ start: "2026-01-01", end: "2026-08-31" });
    expect(r.priorWindow).toEqual({ start: "2025-01-01", end: "2025-08-31" });
  });

  it("month/quarter compare same period", () => {
    expect(resolveWindow("month", 2026, 3)).toMatchObject({ window: {start:"2026-03-01",end:"2026-03-31"}, priorWindow:{start:"2025-03-01",end:"2025-03-31"} });
    expect(resolveWindow("quarter", 2026, 2)).toMatchObject({ window: {start:"2026-04-01",end:"2026-06-30"}, priorWindow:{start:"2025-04-01",end:"2025-06-30"} });
  });

  it("calculates BNC YTD against Jan through the same current month, not the full prior year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T16:23:00Z"));
    const rows = [
      bnc("2025-02-10", 3_000_000, "BNC-1"),
      bnc("2025-08-10", 3_960_673.7, "BNC-2"),
      bnc("2025-11-10", 17_279_272.3, "BNC-3"),
      bnc("2026-02-10", 4_000_000, "BNC-4"),
      bnc("2026-08-10", 4_582_985, "BNC-5"),
    ];
    const { window, priorWindow } = resolveWindow("ytd", 2026, 12);
    const cy = metrics(rows, window, { institution: "BNC" }).volume;
    const py = metrics(rows, priorWindow, { institution: "BNC" }).volume;
    expect(py).toBeCloseTo(6_960_673.7, 1);
    expect(yoy(cy, py)).toBeCloseTo((8_582_985 - 6_960_673.7) / 6_960_673.7, 8);
  });

  it.each([
    ["month", 3, "2026-03-01", "2026-03-31", "2025-03-01", "2025-03-31"],
    ["quarter", 2, "2026-04-01", "2026-06-30", "2025-04-01", "2025-06-30"],
  ] as const)("calculates %s percentages from the exact prior-year twin", (granularity, index, cyStart, cyEnd, pyStart, pyEnd) => {
    const rows = [
      bnc(cyStart, 1_250_000, `${index}01`),
      bnc(pyStart, 1_000_000, `${index}02`),
      bnc(granularity === "month" ? "2026-04-01" : "2026-07-01", 9_000_000, `${index}03`),
      bnc(granularity === "month" ? "2025-04-01" : "2025-07-01", 9_000_000, `${index}04`),
    ];
    const resolved = resolveWindow(granularity, 2026, index);
    expect(resolved.window).toEqual({ start: cyStart, end: cyEnd });
    expect(resolved.priorWindow).toEqual({ start: pyStart, end: pyEnd });
    expect(yoy(metrics(rows, resolved.window).volume, metrics(rows, resolved.priorWindow).volume)).toBeCloseTo(0.25);
  });
});
