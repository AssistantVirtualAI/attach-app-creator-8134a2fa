import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { contentKeyed, decideChange, diffRows, fastHash, stableJson } from "./commission-version.ts";
const rows = [{ key: "a", data: { amt: 1 } }, { key: "b", data: { amt: 2 } }];
async function stored(r: typeof rows) { const m = new Map<string, string>(); for (const x of r) m.set(x.key, await fastHash(stableJson(x.data))); return m; }
Deno.test("no change => same set hash, no upserts", async () => {
  const first = await diffRows(rows, new Map());
  const again = await diffRows(rows, await stored(rows));
  assertEquals(again.upserts.length, 0); assertEquals(again.removedKeys.length, 0);
  assertEquals(again.diff.setHash, first.diff.setHash);
});
Deno.test("added row", async () => {
  const d = await diffRows([...rows, { key: "c", data: { amt: 3 } }], await stored(rows));
  assertEquals(d.diff.added, 1); assertEquals(d.upserts.length, 1);
});
Deno.test("modified row", async () => {
  const before = await diffRows(rows, new Map());
  const d = await diffRows([rows[0], { key: "b", data: { amt: 9 } }], await stored(rows));
  assertEquals(d.diff.changed, 1); assertNotEquals(d.diff.setHash, before.diff.setHash);
});
Deno.test("removed row", async () => {
  const d = await diffRows([rows[0]], await stored(rows));
  assertEquals(d.removedKeys, ["b"]);
});
Deno.test("key order does not change hash", async () => {
  assertEquals(stableJson({ b: 1, a: 2 }), stableJson({ a: 2, b: 1 }));
});

Deno.test("single miss is not a change; second consecutive miss is", () => {
  const stored = new Set(["a", "b"]);
  const first = decideChange(["a"], stored, new Set());
  assertEquals(first.changed, false); assertEquals(first.newMisses, ["b"]);
  const second = decideChange(["a"], stored, new Set(first.newMisses));
  assertEquals(second.changed, true); assertEquals(second.confirmedRemoved, ["b"]);
});
Deno.test("reappearing row clears the miss without change", () => {
  const d = decideChange(["a", "b"], new Set(["a", "b"]), new Set(["b"]));
  assertEquals(d.changed, false); assertEquals(d.newMisses, []);
});
Deno.test("new row is an immediate change", () => {
  assertEquals(decideChange(["a", "c"], new Set(["a"]), new Set()).added, ["c"]);
});
Deno.test("duplicate content collapses to one key", () => {
  assertEquals(contentKeyed([{ x: 1 }, { x: 1 }, { x: 2 }]).length, 2);
});
