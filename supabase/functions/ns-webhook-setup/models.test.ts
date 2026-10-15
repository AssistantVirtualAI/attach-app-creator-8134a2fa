import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseModels } from "./models.ts";

Deno.test("legacy: no models -> full set", () => {
  assertEquals(parseModels({}), { ok: true, models: ["call", "cdr", "message", "voicemail"] });
  assertEquals(parseModels(null), { ok: true, models: ["call", "cdr", "message", "voicemail"] });
});
Deno.test("message only", () => {
  assertEquals(parseModels({ models: ["message"] }), { ok: true, models: ["message"] });
});
Deno.test("dedup never widens", () => {
  assertEquals(parseModels({ models: ["message", "message"] }), { ok: true, models: ["message"] });
});
Deno.test("invalid rejected", () => {
  assertEquals(parseModels({ models: [] }).ok, false);
  assertEquals(parseModels({ models: "message" }).ok, false);
  assertEquals(parseModels({ models: ["sms"] }).ok, false);
  assertEquals(parseModels({ models: ["message", 1] }).ok, false);
});
