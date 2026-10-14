import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasUsableAiKey } from "./ai-key-guard.ts";

Deno.test("Anthropic seul accepté", () => {
  assertEquals(hasUsableAiKey({ anthropic: "k", openai: null }), true);
});

Deno.test("OpenAI seul accepté", () => {
  assertEquals(hasUsableAiKey({ anthropic: null, openai: "k" }), true);
});

Deno.test("Aucune clé => refus contrôlé", () => {
  assertEquals(hasUsableAiKey({ anthropic: null, openai: null }), false);
  assertEquals(hasUsableAiKey({ anthropic: "", openai: "  " }), false);
});
