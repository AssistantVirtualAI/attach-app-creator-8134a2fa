import { describe, it, expect } from "vitest";
import { resolveWindow } from "../../supabase/functions/_shared/commission-engine";
describe("windows", () => {
  it("ytd caps to current month and aligns PY", () => {
    const now = new Date(); const y = now.getUTCFullYear(); const m = now.getUTCMonth()+1;
    const r = resolveWindow("ytd", y, 12);
    expect(r.window.start).toBe(`${y}-01-01`);
    expect(r.window.end.slice(0,7)).toBe(`${y}-${String(m).padStart(2,"0")}`);
    expect(r.priorWindow.start).toBe(`${y-1}-01-01`);
    expect(r.priorWindow.end.slice(0,7)).toBe(`${y-1}-${String(m).padStart(2,"0")}`);
  });
  it("month/quarter compare same period", () => {
    expect(resolveWindow("month", 2026, 3)).toMatchObject({ window: {start:"2026-03-01",end:"2026-03-31"}, priorWindow:{start:"2025-03-01",end:"2025-03-31"} });
    expect(resolveWindow("quarter", 2026, 2)).toMatchObject({ window: {start:"2026-04-01",end:"2026-06-30"}, priorWindow:{start:"2025-04-01",end:"2025-06-30"} });
  });
});
