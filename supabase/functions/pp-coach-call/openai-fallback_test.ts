import { assert, assertEquals } from "jsr:@std/assert@1";
import { callOpenAiFallback } from "./openai-fallback.ts";

Deno.test("OpenAI seul : envoie une requête JSON", async () => {
  let body: any = null; let url = "";
  const fetchImpl = (async (u: string, init: RequestInit) => {
    url = u; body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await callOpenAiFallback({ apiKey: "k", systemPrompt: "S", userPrompt: "U", fetchImpl });
  assert(r.ok);
  assertEquals(url, "https://api.openai.com/v1/chat/completions");
  assertEquals(body.response_format, { type: "json_object" });
  assertEquals(body.model, "gpt-4o-mini");
  assertEquals(body.messages[0].content, "S");
});

Deno.test("Clé absente : aucune requête", async () => {
  let called = 0;
  const fetchImpl = (async () => { called++; return new Response("{}"); }) as unknown as typeof fetch;
  const r = await callOpenAiFallback({ apiKey: "", systemPrompt: "S", userPrompt: "U", fetchImpl });
  assertEquals(called, 0);
  assertEquals(r, { ok: false, error_code: "no_openai_key" });
});

Deno.test("429 expurgé", async () => {
  const fetchImpl = (async () => new Response("SECRET provider body transcript", { status: 429 })) as unknown as typeof fetch;
  const r = await callOpenAiFallback({ apiKey: "k", systemPrompt: "S", userPrompt: "U", fetchImpl });
  assertEquals(r, { ok: false, status: 429, error_code: "openai_rate_limited" });
  assert(!JSON.stringify(r).includes("SECRET"));
});

Deno.test("Échec réseau expurgé", async () => {
  const fetchImpl = (async () => { throw new Error("boom key=xyz"); }) as unknown as typeof fetch;
  const r = await callOpenAiFallback({ apiKey: "k", systemPrompt: "S", userPrompt: "U", fetchImpl });
  assertEquals(r, { ok: false, status: 502, error_code: "openai_network" });
});
