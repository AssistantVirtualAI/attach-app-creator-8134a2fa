import { assertEquals } from "jsr:@std/assert";
import { baseExtensionFromSips } from "./maestro-sip-identity.ts";

Deno.test("Maestro sips 110x/110W resolve to extension 110", () => {
  assertEquals(baseExtensionFromSips([{ sip_username: "110x" }, { sip_username: "110W" }]), "110");
});
Deno.test("mixed extensions never prove identity", () => {
  assertEquals(baseExtensionFromSips([{ sip_username: "110x" }, { sip_username: "1005W" }]), null);
});
Deno.test("empty sips gives no extension", () => {
  assertEquals(baseExtensionFromSips([]), null);
});
