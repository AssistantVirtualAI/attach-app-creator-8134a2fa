export type OpenAiFallbackResult = { ok: boolean; content?: string; status?: number; error_code?: string };

export async function callOpenAiFallback(opts: {
  apiKey: string | undefined | null;
  model?: string | null;
  systemPrompt: string;
  userPrompt: string;
  fetchImpl?: typeof fetch;
}): Promise<OpenAiFallbackResult> {
  const key = (opts.apiKey ?? "").trim();
  if (!key) return { ok: false, error_code: "no_openai_key" };
  const f = opts.fetchImpl ?? fetch;
  try {
    const r = await f("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: opts.model || "gpt-4o-mini",
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userPrompt + "\n\nRéponds uniquement avec un objet JSON valide." },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      await r.body?.cancel().catch(() => {});
      const code = r.status === 429 ? "openai_rate_limited" : r.status === 401 || r.status === 403 ? "openai_auth" : "openai_http_error";
      return { ok: false, status: r.status, error_code: code };
    }
    const j = await r.json().catch(() => null);
    const content = j?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return { ok: false, status: 502, error_code: "openai_empty" };
    return { ok: true, content, status: 200 };
  } catch {
    return { ok: false, status: 502, error_code: "openai_network" };
  }
}
