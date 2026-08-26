import { afterEach, describe, expect, it, vi } from "vitest";
import { metrics, resolveWindow, yoy } from "../../supabase/functions/_shared/commission-engine";
import {
  BNC_FIXTURE_ROWS,
  BNC_GOLDEN,
  GOLDEN_NOW,
  GOLDEN_YEAR,
  fmtPct,
} from "./fixtures/bncGolden";

const BNC = { institution: "BNC" } as const;

describe("BNC golden values", () => {
  afterEach(() => vi.useRealTimers());

  it.each(BNC_GOLDEN.map((g) => [g.granularity, g] as const))(
    "%s: volume, dossiers and commission match the golden fixture",
    (_g, golden) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(GOLDEN_NOW));

      const resolved = resolveWindow(golden.granularity, GOLDEN_YEAR, golden.index);
      expect(resolved.window).toEqual(golden.window);
      expect(resolved.priorWindow).toEqual(golden.priorWindow);

      const cy = metrics(BNC_FIXTURE_ROWS, resolved.window, BNC);
      const py = metrics(BNC_FIXTURE_ROWS, resolved.priorWindow, BNC);

      expect(cy.volume).toBeCloseTo(golden.cy.volume, 2);
      expect(cy.deals).toBe(golden.cy.deals);
      expect(cy.commission).toBeCloseTo(golden.cy.commission, 2);

      expect(py.volume).toBeCloseTo(golden.py.volume, 2);
      expect(py.deals).toBe(golden.py.deals);
      expect(py.commission).toBeCloseTo(golden.py.commission, 2);

      expect(fmtPct(yoy(cy.volume, py.volume))).toBe(golden.formatted.volume);
      expect(fmtPct(yoy(cy.deals, py.deals))).toBe(golden.formatted.deals);
      expect(fmtPct(yoy(cy.commission, py.commission))).toBe(golden.formatted.commission);
    },
  );

  it("never leaks another lender into the BNC figures", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(GOLDEN_NOW));
    const { window } = resolveWindow("month", GOLDEN_YEAR, 3);
    const all = metrics(BNC_FIXTURE_ROWS, window);
    const bnc = metrics(BNC_FIXTURE_ROWS, window, BNC);
    expect(all.volume).toBeCloseTo(8_000_000, 2);
    expect(bnc.volume).toBeCloseTo(3_000_000, 2);
  });
});
