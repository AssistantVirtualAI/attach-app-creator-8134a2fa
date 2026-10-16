import { assertEquals } from "jsr:@std/assert@1";
import { selectOwnedCall } from "./index.ts";
Deno.test("handoff refuses another extension and unlisted call id", () => {
  assertEquals(selectOwnedCall([{ "call-id": "a", user: "201" }], "200", "a"), null);
  assertEquals(selectOwnedCall([{ "call-id": "a", user: "200" }], "200", "foreign"), null);
});
Deno.test("handoff refuses ambiguous calls and selects own scoped call", () => {
  assertEquals(selectOwnedCall([{ "call-id": "a" }, { "call-id": "b" }], "200"), null);
  assertEquals(selectOwnedCall([{ "call-id": "a", user: "200" }], "200", "a")?.["call-id"], "a");
});

Deno.test("canonical widget and mobile ignore stored W", async () => {
  const { widgetDeviceId, mobileDeviceId } = await import("../_shared/pp-device-ids.ts");
  assertEquals(widgetDeviceId("200"), "200x");
  assertEquals(mobileDeviceId("200"), "200M");
});
