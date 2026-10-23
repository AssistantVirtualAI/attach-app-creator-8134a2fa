import { assertEquals } from "jsr:@std/assert@1";
import { canRegisterToken, normalizeDeviceId, deviceClaimMustDefer } from "./pp-active-device.ts";

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
  assertEquals(normalizeDeviceId("a".repeat(15)), null);
  assertEquals(normalizeDeviceId("a".repeat(16)), "a".repeat(16));
  assertEquals(normalizeDeviceId("a".repeat(128)), "a".repeat(128));
  assertEquals(normalizeDeviceId("a".repeat(129)), null);
  assertEquals(normalizeDeviceId(null), null);
  assertEquals(normalizeDeviceId("a1b2c3d4e5f6a7b8c9"), "a1b2c3d4e5f6a7b8c9");
});

Deno.test("device claim defers only for ringing and active calls", () => {
  assertEquals(deviceClaimMustDefer("ringing"), true);
  assertEquals(deviceClaimMustDefer("active"), true);
  for (const state of ["ended", null, undefined, "unknown"]) {
    assertEquals(deviceClaimMustDefer(state), false);
  }
});

Deno.test("legacy app without device id registers only when the claimed device never stored a token", () => {
  assertEquals(canRegisterToken("device-B-0000000000", null, false), true);
  assertEquals(canRegisterToken("device-B-0000000000", null, true), false);
  assertEquals(canRegisterToken("device-B-0000000000", "device-A-0000000000", false), false);
});
