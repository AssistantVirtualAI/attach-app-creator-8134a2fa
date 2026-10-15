import { assertEquals } from "jsr:@std/assert@1";
import { rowsInWindow, inWindow, sortSource, weekWindow, monthWindow } from "./commission-engine.ts";
Deno.test("rowsInWindow == full scan", () => {
  const rows: any[] = [];
  for (let i = 0; i < 5000; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + Math.floor(Math.random() * 1000) * 86400000).toISOString().slice(0, 10);
    rows.push({ source_row: Math.floor(Math.random() * 1e6), date_trans: i % 37 === 0 ? null : (i % 11 === 0 ? ` ${d}T10:00` : d) });
  }
  const s = sortSource(rows);
  for (const w of [weekWindow(2025, 3), monthWindow(2025, 2), monthWindow(2026, 9), { start: "2024-01-01", end: "2026-12-31" }]) {
    assertEquals(rowsInWindow(s, w as any), s.filter((r: any) => inWindow(r, w as any)));
  }
});
