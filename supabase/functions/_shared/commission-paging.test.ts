import { assertEquals } from "jsr:@std/assert@1";
import { mergeDepositReads } from "./commission-reports.ts";

const a = { number: "F1", amount: "10" }, b = { number: "F2", amount: "20" }, c = { number: "F3", amount: "30" };

Deno.test("paging repeat collapses and skipped line is recovered", () => {
  const out = mergeDepositReads([[a, a, b], [a, b, c]]);
  assertEquals(out.length, 3);
  assertEquals(out.reduce((t, r) => t + Number(r.amount), 0), 60);
});

Deno.test("genuinely identical lines present in every read are kept", () => {
  assertEquals(mergeDepositReads([[a, a, b], [a, a, b]]).length, 3);
});
