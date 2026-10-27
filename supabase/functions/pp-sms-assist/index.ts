// pp-sms-assist — Aide à la rédaction de textos Planiprêt (portail courtier).
// POST { action: "improve", text, lang? }          → { ok, text }
// POST { action: "suggest", text?, context?, lang? } → { ok, suggestions: string[] }
//
// Sécurité : requirePlanipretBroker() (JWT + membre Planiprêt + profil).
// Le texte ne quitte jamais le serveur sauf vers la passerelle IA Lovable.

import { corsHeaders, jsonResponse, requirePlanipretBroker } from "../_shared/planipret-ns.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.1-flash-lite";
const MAX_INPUT = 2000;
const MAX_SMS = 900;

function clip(value: unknown, max = MAX_INPUT): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function askAi(system: string, user: string): Promise<string | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    console.warn("[pp-sms-assist] gateway error:", res.status);
    return null;
  }
  const data = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const guard = await requirePlanipretBroker(req);
  if (guard instanceof Response) return guard;

  let body: any = {};
  try { body = await req.json(); } catch { return jsonResponse({ error: "invalid_body" }, 400); }

  const action = String(body?.action ?? "");
  const lang = body?.lang === "en" ? "en" : "fr";
  const text = clip(body?.text);
  const context = clip(body?.context, 3000);

  if (action === "improve") {
    if (!text) return jsonResponse({ error: "missing_text" }, 400);
    const system = lang === "en"
      ? "You rewrite short business text messages for a mortgage broker. Fix spelling, grammar and punctuation, keep the original language, meaning, tone and length, keep all names, numbers and dates exactly as written. Reply with the corrected message only, no quotes, no explanation."
      : "Tu réécris de courts textos d'affaires pour un courtier hypothécaire. Corrige l'orthographe, la grammaire et la ponctuation, garde la langue, le sens, le ton et la longueur d'origine, et conserve exactement les noms, chiffres et dates. Réponds uniquement avec le message corrigé, sans guillemets ni explication.";
    const improved = await askAi(system, text);
    if (!improved) return jsonResponse({ error: "ai_unavailable" }, 502);
    return jsonResponse({ ok: true, text: improved.slice(0, MAX_SMS) });
  }

  if (action === "suggest") {
    const system = lang === "en"
      ? "You suggest short professional SMS replies for a mortgage broker. Based on the conversation, propose exactly 3 distinct short replies (one line each, max 160 characters each), in the same language as the conversation. Reply with the 3 suggestions only, one per line, no numbering, no quotes, no explanation."
      : "Tu proposes de courtes réponses SMS professionnelles pour un courtier hypothécaire. À partir de la conversation, propose exactement 3 réponses courtes et distinctes (une par ligne, 160 caractères maximum chacune), dans la langue de la conversation. Réponds uniquement avec les 3 suggestions, une par ligne, sans numérotation, sans guillemets ni explication.";
    const user = context
      ? `Conversation:\n${context}\n\nBrouillon du courtier: ${text || "(aucun)"}`
      : `Brouillon du courtier: ${text || "(aucun)"}`;
    const raw = await askAi(system, user);
    if (!raw) return jsonResponse({ error: "ai_unavailable" }, 502);
    const suggestions = raw
      .split("\n")
      .map((line) => line.replace(/^[-*\d.\)\s]+/, "").trim())
      .filter((line) => line.length > 0)
      .slice(0, 3)
      .map((line) => line.slice(0, 160));
    if (!suggestions.length) return jsonResponse({ error: "ai_unavailable" }, 502);
    return jsonResponse({ ok: true, suggestions });
  }

  return jsonResponse({ error: "unknown_action" }, 400);
});
