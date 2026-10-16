import { assertEquals } from "jsr:@std/assert@1";
import { buildWidgetPayload, postWidgetSync, shouldDebounce, _resetDebounce } from "./maestro-widget-sync.ts";

Deno.test("payload includes external_user_id for active broker", () => {
  assertEquals(buildWidgetPayload("393", "110", false), { user_id: "393", external_user_id: "110" });
});
Deno.test("released omits external_user_id", () => {
  assertEquals(buildWidgetPayload("393", "110", true), { user_id: "393" });
});
Deno.test("broker without CRM id is skipped", () => {
  assertEquals(buildWidgetPayload(null, "110", false), null);
});
Deno.test("debounce blocks repeat within window", () => {
  _resetDebounce();
  assertEquals(shouldDebounce("a", 1000), false);
  assertEquals(shouldDebounce("a", 5000), true);
  assertEquals(shouldDebounce("a", 40_000), false);
});
Deno.test("provider failure is redacted", async () => {
  const fake = (async () => ({ ok: false, status: 500, data: { secret: "x", body: "raw" } })) as any;
  const r = await postWidgetSync({ url: "https://x", key: "k" }, { user_id: "1" }, fake);
  assertEquals(r, { ok: false, status: 500, error_code: "http_500" });
});
Deno.test("not configured makes no request", async () => {
  let called = false;
  const fake = (async () => { called = true; return { ok: true, status: 200, data: null }; }) as any;
  const r = await postWidgetSync({ url: "", key: "" }, { user_id: "1" }, fake);
  assertEquals(r.skipped, "not_configured"); assertEquals(called, false);
});

Deno.test("call event is flag gated and allowlisted", async () => {
  const { buildWidgetCallPayload } = await import("./maestro-widget-sync.ts");
  const value = { event: "call_active" as const, user_id: "crm", external_user_id: "200", call_id: "opaque", direction: "inbound" as const, started_at: "2026-10-16T12:00:00Z", device: "mobile" as const, secret: "must_not_leave", from_number: "must_not_leave" };
  assertEquals(buildWidgetCallPayload(value, false), null);
  const payload = buildWidgetCallPayload(value, true)!;
  assertEquals(Object.keys(payload).sort(), ["event", "user_id", "external_user_id", "call_id", "direction", "started_at", "device"].sort());
  assertEquals(JSON.stringify(payload).includes("must_not_leave"), false);
});

Deno.test("resource events are gated and redact content", async () => {
  const { buildWidgetResourcePayload } = await import("./maestro-widget-sync.ts");
  for (const event of ["recording_ready", "transcript_ready", "sms"] as const) {
    const input = { event, user_id: "crm", external_user_id: "200", resource_id: "opaque", direction: "inbound" as const, body: "private", url: "private" };
    assertEquals(buildWidgetResourcePayload(input, false), null);
    const output = buildWidgetResourcePayload(input, true)!;
    assertEquals(JSON.stringify(output).includes("private"), false);
    assertEquals(output.event, event);
  }
});
