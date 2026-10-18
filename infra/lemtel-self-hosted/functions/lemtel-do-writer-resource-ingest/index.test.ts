import assert from "node:assert/strict";
import { validateDoWriterResources } from "./index.ts";
const now = Date.UTC(2026, 9, 18, 16, 50, 30);
const sample = { observedAt: "2026-10-18T16:50:00Z", cpuPercent: 41, memoryPercent: 62, diskPercent: 37, load1Milli: 125, load5Milli: 118, load15Milli: 104 };
Deno.test("DO writer resource envelope is exact, bounded and canonical", () => {
  assert.deepEqual(validateDoWriterResources(JSON.stringify(sample), now), sample);
  for (const invalid of [
    { ...sample, nodeRole: "do_writer" }, { ...sample, cpuPercent: -1 }, { ...sample, memoryPercent: 101 },
    { ...sample, diskPercent: 1.5 }, { ...sample, load1Milli: -1 }, { ...sample, load5Milli: 1_000_001 },
    { ...sample, observedAt: "2026-10-18T16:46:00Z" }, { ...sample, observedAt: "2026-10-18T16:53:00Z" },
  ]) assert.equal(validateDoWriterResources(JSON.stringify(invalid), now), null);
  assert.equal(validateDoWriterResources(" " + JSON.stringify(sample), now), null);
});
