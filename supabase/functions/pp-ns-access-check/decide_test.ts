import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideNsAccess } from "./decide.ts";

Deno.test("broker absent from NetSapiens is denied", () => {
  assertEquals(decideNsAccess({ isSuperAdmin: false, extension: "1197", nsStatus: 404, nsUser: null }).allowed, false);
});
Deno.test("broker without extension is denied", () => {
  assertEquals(decideNsAccess({ isSuperAdmin: false, extension: "", nsStatus: 200, nsUser: { user: "1" } }).allowed, false);
});
Deno.test("disabled NetSapiens user is denied", () => {
  assertEquals(decideNsAccess({ isSuperAdmin: false, extension: "1197", nsStatus: 200, nsUser: { user: "1197", status: "disabled" } }).reason, "ns_inactive");
});
Deno.test("active NetSapiens broker is allowed", () => {
  assertEquals(decideNsAccess({ isSuperAdmin: false, extension: "1197", nsStatus: 200, nsUser: { user: "1197" } }).allowed, true);
});
Deno.test("NetSapiens outage does not lock out", () => {
  assertEquals(decideNsAccess({ isSuperAdmin: false, extension: "1197", nsStatus: 503, nsUser: null }).allowed, true);
});
Deno.test("super admin bypass", () => {
  assertEquals(decideNsAccess({ isSuperAdmin: true, extension: null, nsStatus: 404, nsUser: null }).allowed, true);
});
