import { assertEquals } from "jsr:@std/assert@1";
import { buildWidgetPayload, postWidgetSync, logWidgetSyncResult, shouldDebounce, _resetDebounce } from "./maestro-widget-sync.ts";
import { isMaestroSyncSuccessful } from "./maestro-sync-outcome.ts";

Deno.test("HTTP 200 result is persisted as explicit success without provider data", async () => {
  const fake = (async () => ({ ok: true, status: 200, data: { secret: "private" } })) as any;
  const result = await postWidgetSync({ url: "https://example.invalid", key: "test-only" }, { user_id: "test" }, fake);
  let inserted: any;
  const admin = { from: (table: string) => {
    assertEquals(table, "planipret_maestro_sync_log");
    return { insert: (entry: unknown) => { inserted = entry; return Promise.resolve({ error: null }); } };
  } } as any;
  await logWidgetSyncResult(admin, "test-owner", { user_id: "test", external_user_id: "test-ext" }, result);
  assertEquals(inserted, { user_id: "test-owner", action: "widget.sync", maestro_endpoint: "POST /sync",
    request_body: { has_external: true }, response_body: null, response_status: 200, success: true });
});

Deno.test("HTTP 500 result is persisted as explicit failure without provider data", async () => {
  let inserted: any;
  const admin = { from: () => ({ insert: (entry: unknown) => { inserted = entry; return Promise.resolve({ error: null }); } }) } as any;
  await logWidgetSyncResult(admin, "test-owner", { user_id: "test" }, { ok: false, status: 500, error_code: "http_500" });
  assertEquals(inserted.success, false);
  assertEquals(inserted.action, "widget.release");
  assertEquals(inserted.response_status, 500);
  assertEquals(inserted.response_body, { error: "http_500" });
});

Deno.test("legacy widget classification agrees with explicit outcomes", () => {
  assertEquals(isMaestroSyncSuccessful({ action: "widget.sync", response_status: 200, success: null }), true);
  assertEquals(isMaestroSyncSuccessful({ action: "widget.release", response_status: 200, success: null }), true);
  assertEquals(isMaestroSyncSuccessful({ action: "widget.sync", response_status: 500, success: null }), false);
  assertEquals(isMaestroSyncSuccessful({ action: "widget.sync", response_status: 200, success: false }), false);
  assertEquals(isMaestroSyncSuccessful({ action: "call.summary", response_status: 200, success: null }), false);
});

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
