/**
 * End-to-end check of the "Actualiser" button on the commissions page.
 *
 * The dashboard refetches `pp-commission-stats` whenever `refreshKey` changes
 * (see RegisterCommissions.tsx), then recomputes volume / dossiers /
 * percentages from the returned register rows. This test drives the same
 * pipeline with a stubbed backend so a logic change that breaks the refresh
 * (stale payload, wrong window, cached percentages) fails here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  metrics,
  resolveWindow,
  yoy,
  type Granularity,
  type RegisterRow,
} from "../../supabase/functions/_shared/commission-engine";
import { BNC_FIXTURE_ROWS, GOLDEN_NOW, GOLDEN_YEAR, bncRow, fmtPct } from "./fixtures/bncGolden";

const BNC = { institution: "BNC" } as const;

/** Rows added by a Maestro sync, revealed only after "Actualiser". */
const SYNCED_ROWS: RegisterRow[] = [
  bncRow("2026-03-20", 1_000_000, "NEW-01"),
  bncRow("2026-05-20", 3_000_000, "NEW-02"),
  bncRow("2026-08-20", 1_000_000, "NEW-03"),
];

interface Kpi { volume: number; deals: number; commission: number }
interface View {
  window: { start: string; end: string };
  cy: Kpi;
  py: Kpi;
  pct: { volume: string; deals: string; commission: string };
  fetches: number;
}

/** Minimal stand-in for the page's fetch + compute effect. */
function createDashboard() {
  let serverRows = [...BNC_FIXTURE_ROWS];
  let fetches = 0;
  let refreshKey = 0;
  let lastKey = "";
  let payload: RegisterRow[] = [];

  const load = (granularity: Granularity, index: number) => {
    const key = `${granularity}:${index}:${refreshKey}`;
    if (key !== lastKey) {
      fetches += 1;
      lastKey = key;
      payload = [...serverRows];
    }
    const resolved = resolveWindow(granularity, GOLDEN_YEAR, index);
    const cy = metrics(payload, resolved.window, BNC);
    const py = metrics(payload, resolved.priorWindow, BNC);
    const view: View = {
      window: resolved.window,
      cy: { volume: cy.volume, deals: cy.deals, commission: cy.commission },
      py: { volume: py.volume, deals: py.deals, commission: py.commission },
      pct: {
        volume: fmtPct(yoy(cy.volume, py.volume)),
        deals: fmtPct(yoy(cy.deals, py.deals)),
        commission: fmtPct(yoy(cy.commission, py.commission)),
      },
      fetches,
    };
    return view;
  };

  return {
    load,
    /** Simulates a Maestro sync landing new rows on the server. */
    syncNewRows: () => { serverRows = [...serverRows, ...SYNCED_ROWS]; },
    /** Simulates the "Actualiser" button. */
    clickRefresh: () => { refreshKey += 1; },
  };
}

describe("Actualiser (end-to-end)", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["ytd", 12, 8_750_000, 6, 13_750_000, 9] as const,
    ["month", 3, 3_000_000, 2, 4_000_000, 3] as const,
    ["quarter", 2, 3_000_000, 2, 6_000_000, 3] as const,
  ])(
    "%s: refreshing picks up newly synced rows and recomputes volume, dossiers and percentages",
    (granularity, index, volBefore, dealsBefore, volAfter, dealsAfter) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(GOLDEN_NOW));
      const dash = createDashboard();

      const before = dash.load(granularity as Granularity, index);
      expect(before.fetches).toBe(1);
      expect(before.cy.volume).toBeCloseTo(volBefore, 2);
      expect(before.cy.deals).toBe(dealsBefore);

      // New data lands but the page has not refreshed yet: figures must not move.
      dash.syncNewRows();
      const stale = dash.load(granularity as Granularity, index);
      expect(stale.fetches).toBe(1);
      expect(stale.cy.volume).toBeCloseTo(volBefore, 2);
      expect(stale.pct).toEqual(before.pct);

      // "Actualiser" -> refetch -> recompute.
      dash.clickRefresh();
      const after = dash.load(granularity as Granularity, index);
      expect(after.fetches).toBe(2);
      expect(after.window).toEqual(before.window);
      expect(after.cy.volume).toBeCloseTo(volAfter, 2);
      expect(after.cy.deals).toBe(dealsAfter);
      expect(after.cy.commission).toBeCloseTo(volAfter / 100, 2);
      // PY is untouched by a current-year sync.
      expect(after.py).toEqual(before.py);
      // Percentages are recomputed from the fresh payload, never reused.
      expect(after.pct.volume).toBe(fmtPct(yoy(after.cy.volume, after.py.volume)));
      expect(after.pct.deals).toBe(fmtPct(yoy(after.cy.deals, after.py.deals)));
      expect(after.pct.commission).toBe(fmtPct(yoy(after.cy.commission, after.py.commission)));
      expect(after.pct.volume).not.toBe(before.pct.volume);
    },
  );

  it("refreshing then switching granularity refetches for the new period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(GOLDEN_NOW));
    const dash = createDashboard();

    const ytd = dash.load("ytd", 12);
    dash.clickRefresh();
    const ytdRefreshed = dash.load("ytd", 12);
    expect(ytdRefreshed.fetches).toBe(2);
    expect(ytdRefreshed.cy.volume).toBeCloseTo(ytd.cy.volume, 2);

    const month = dash.load("month", 3);
    expect(month.fetches).toBe(3);
    expect(month.window).toEqual({ start: "2026-03-01", end: "2026-03-31" });
    expect(month.cy.volume).toBeCloseTo(3_000_000, 2);

    const quarter = dash.load("quarter", 2);
    expect(quarter.fetches).toBe(4);
    expect(quarter.window).toEqual({ start: "2026-04-01", end: "2026-06-30" });
  });

  it("a refresh that returns no new data leaves every figure and percentage identical", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(GOLDEN_NOW));
    const dash = createDashboard();
    const before = dash.load("ytd", 12);
    dash.clickRefresh();
    const after = dash.load("ytd", 12);
    expect(after.fetches).toBe(2);
    expect(after.cy).toEqual(before.cy);
    expect(after.py).toEqual(before.py);
    expect(after.pct).toEqual(before.pct);
  });
});
