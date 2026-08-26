import { afterEach, describe, expect, it, vi } from "vitest";
import { metrics, resolveWindow, yoy } from "../../supabase/functions/_shared/commission-engine";
import { bncRow, fmtPct } from "./fixtures/bncGolden";

const BNC = { institution: "BNC" } as const;

describe("BNC zero-value regressions", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["ytd", "month", "quarter"] as const)(
    "%s: PY at zero yields \"New\" instead of a division by zero",
    (granularity) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-26T16:23:00Z"));
      const index = granularity === "ytd" ? 12 : granularity === "month" ? 3 : 2;
      const inWindow = granularity === "quarter" ? "2026-05-10" : "2026-03-10";
      const rows = [bncRow(inWindow, 2_000_000, "Z-CY1")];

      const { window, priorWindow } = resolveWindow(granularity, 2026, index);
      const cy = metrics(rows, window, BNC);
      const py = metrics(rows, priorWindow, BNC);

      expect(py.volume).toBe(0);
      expect(py.deals).toBe(0);
      expect(py.commission).toBe(0);

      for (const delta of [
        yoy(cy.volume, py.volume),
        yoy(cy.deals, py.deals),
        yoy(cy.commission, py.commission),
      ]) {
        expect(delta).toBe("New");
        expect(Number.isFinite(delta as number)).toBe(false);
        expect(fmtPct(delta)).toBe("New");
      }
    },
  );

  it.each(["ytd", "month", "quarter"] as const)(
    "%s: both sides at zero yields the em dash placeholder",
    (granularity) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-26T16:23:00Z"));
      const index = granularity === "ytd" ? 12 : granularity === "month" ? 3 : 2;
      const { window, priorWindow } = resolveWindow(granularity, 2026, index);
      const cy = metrics([], window, BNC);
      const py = metrics([], priorWindow, BNC);

      expect(cy.volume).toBe(0);
      expect(py.volume).toBe(0);
      expect(yoy(cy.volume, py.volume)).toBe("—");
      expect(fmtPct(yoy(cy.deals, py.deals))).toBe("—");
      expect(fmtPct(yoy(cy.commission, py.commission))).toBe("—");
      expect(cy.commissionPerDeal).toBe(0);
      expect(Number.isNaN(cy.commissionPerDeal)).toBe(false);
    },
  );

  it.each(["ytd", "month", "quarter"] as const)(
    "%s: current at zero against a real PY yields exactly -100.0 %%",
    (granularity) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-26T16:23:00Z"));
      const index = granularity === "ytd" ? 12 : granularity === "month" ? 3 : 2;
      const pyDate = granularity === "quarter" ? "2025-05-10" : "2025-03-10";
      const rows = [bncRow(pyDate, 4_000_000, "Z-PY1"), bncRow(pyDate, 1_000_000, "Z-PY2")];

      const { window, priorWindow } = resolveWindow(granularity, 2026, index);
      const cy = metrics(rows, window, BNC);
      const py = metrics(rows, priorWindow, BNC);

      expect(cy.volume).toBe(0);
      expect(py.volume).toBeCloseTo(5_000_000, 2);
      expect(fmtPct(yoy(cy.volume, py.volume))).toBe("-100.0 %");
      expect(fmtPct(yoy(cy.deals, py.deals))).toBe("-100.0 %");
      expect(fmtPct(yoy(cy.commission, py.commission))).toBe("-100.0 %");
    },
  );

  it("a lender with no row at all stays at zero without NaN", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T16:23:00Z"));
    const rows = [bncRow("2026-03-10", 1_000_000, "Z-OTH", { institution: "Desjardins" })];
    const { window, priorWindow } = resolveWindow("ytd", 2026, 12);
    const cy = metrics(rows, window, BNC);
    const py = metrics(rows, priorWindow, BNC);
    expect([cy.volume, cy.deals, cy.commission, py.volume, py.deals, py.commission])
      .toEqual([0, 0, 0, 0, 0, 0]);
    expect(fmtPct(yoy(cy.volume, py.volume))).toBe("—");
  });
});
