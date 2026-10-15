import { assert, assertEquals } from "jsr:@std/assert@1";
import { parseReview, reviewCommissionDelta, sanitizeDeltaRow, shouldReview } from "./commission-delta-review.ts";

Deno.test("only numeric/category fields reach Claude, never names", () => {
  const s = sanitizeDeltaRow({
    amount: 120.5, loan_amt: 300000, commission_type: "base", date_trans: "2026-10-01", institution: "TD",
    client_name: "Jean Tremblay", agent_name: "Sandra", target_name: "X", email: "a@b.c", phone: "514", number: "C-1",
  });
  assertEquals(Object.keys(s).sort(), ["amount", "commission_type", "date_trans", "institution", "loan_amt"]);
});

Deno.test("no new rows => no Claude call; hourly cap per broker/source", () => {
  const now = Date.parse("2026-10-15T21:00:00Z");
  assert(!shouldReview(0, null, now));
  assert(shouldReview(3, null, now));
  assert(!shouldReview(3, "2026-10-15T20:30:00Z", now));
  assert(shouldReview(3, "2026-10-15T19:59:00Z", now));
});

Deno.test("empty delta never calls the provider", async () => {
  let calls = 0;
  const r = await reviewCommissionDelta({ source: "paid", added: [], removedCount: 0, totalRows: 5 }, async () => { calls++; return { ok: true, status: 200, text: "{}", toolInput: null, data: null }; });
  assertEquals(calls, 0);
  assertEquals(r.status, "skipped");
});

Deno.test("provider failure is advisory only (skipped, no figures)", async () => {
  const r = await reviewCommissionDelta({ source: "pending", added: [{ amount: 1 }], removedCount: 0, totalRows: 1 },
    async () => ({ ok: false, status: 429, text: "", toolInput: null, data: null, error: "rate" }));
  assertEquals(r.status, "skipped");
  assertEquals(r.issues, []);
});

Deno.test("sample is bounded and parsed strictly", async () => {
  let sent = "";
  const added = Array.from({ length: 100 }, (_, i) => ({ amount: i, client_name: "secret" }));
  const r = await reviewCommissionDelta({ source: "paid", added, removedCount: 0, totalRows: 100 }, async (o) => {
    sent = String(o.messages[0].content);
    return { ok: true, status: 200, text: '{"status":"warning","issues":["montant négatif"]}', toolInput: null, data: null };
  });
  assertEquals(r.status, "warning");
  assertEquals(r.reviewed, 40);
  assert(!sent.includes("secret"));
  assertEquals(parseReview("nope"), null);
});
