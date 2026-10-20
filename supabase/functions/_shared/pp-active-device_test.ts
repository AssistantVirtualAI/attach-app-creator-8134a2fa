import { assertEquals } from "jsr:@std/assert@1";
import { canRegisterToken, normalizeDeviceId } from "./pp-active-device.ts";

Deno.test("no active device yet: legacy registration allowed", () => {
  assertEquals(canRegisterToken(null, null), true);
});
Deno.test("old device A is refused once B is active", () => {
  assertEquals(canRegisterToken("device-B-0000000000", "device-A-0000000000"), false);
  assertEquals(canRegisterToken("device-B-0000000000", null), false);
});
Deno.test("active device B may register", () => {
  assertEquals(canRegisterToken("device-B-0000000000", "device-B-0000000000"), true);
});
Deno.test("device id validation", () => {
  assertEquals(normalizeDeviceId("short"), null);
  assertEquals(normalizeDeviceId("abc'; drop--0000000"), null);
  assertEquals(normalizeDeviceId("a1b2c3d4e5f6a7b8c9"), "a1b2c3d4e5f6a7b8c9");
});
