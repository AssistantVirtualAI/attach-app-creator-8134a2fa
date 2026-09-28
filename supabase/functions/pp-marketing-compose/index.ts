// POST — génère (ou régénère) un courriel HTML et un texto marketing.
import { callAnthropic } from "../_shared/anthropic.ts";
import { CLAUDE_DEFAULT_MODEL } from "../_shared/claude-compat.ts";
import { brokerSignature, corsHeaders, json, renderEmailHtml, requireBroker } from "../_shared/pp-marketing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const ctx = await requireBroker(req);
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt ?? "").trim();
  const lang = body?.lang === "en" ? "en" : "fr";
  const variant = Number(body?.variant ?? 0) || 0;
  if (prompt.length < 5 || prompt.length > 4000) return json({ ok: false, error: "prompt_invalid" }, 400);

  const sig = brokerSignature(ctx.profile);
  const system = `Tu es rédacteur marketing pour Planiprêt, cabinet de courtage hypothécaire au Québec.
Langue de sortie: ${lang === "en" ? "anglais" : "français québécois professionnel"}.
Écris au nom du courtier ${sig.name}. N'invente aucun taux, chiffre, promotion ou date absents de la demande.
Réponds UNIQUEMENT en JSON: {"subject": string, "email_body_html": string, "sms_text": string}.
- email_body_html: HTML simple (p, strong, ul/li, et au plus un bouton <a href="https://planipret.com" style="display:inline-block;background:#176FAD;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">…</a>). Pas de <html>, pas de signature, pas de logo (ajoutés automatiquement).
- sms_text: max 300 caractères, clair, chaleureux, signé "${sig.name.split(" ")[0]} - Planiprêt", terminé par "${lang === "en" ? "Reply STOP to opt out." : "Répondez STOP pour vous désabonner."}"`;

  const r = await callAnthropic({
    model: CLAUDE_DEFAULT_MODEL,
    max_tokens: 1600,
    system,
    temperature: variant > 0 ? 0.9 : 0.6,
    messages: [{ role: "user", content: `Demande du courtier:\n${prompt}${variant > 0 ? `\n\n(Variante #${variant}: propose une approche différente.)` : ""}` }],
    label: "pp-marketing-compose",
  });
  if (!r.ok) return json({ ok: false, error: "ai_unavailable" }, 200);
  let parsed: any = null;
  try {
    const t = r.text.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  } catch { /* handled below */ }
  if (!parsed?.subject || !parsed?.email_body_html || !parsed?.sms_text) return json({ ok: false, error: "ai_bad_output" }, 200);

  const subject = String(parsed.subject).slice(0, 150);
  const email_body_html = String(parsed.email_body_html).replace(/<script[\s\S]*?<\/script>/gi, "").slice(0, 20000);
  const sms_text = String(parsed.sms_text).slice(0, 480);
  return json({
    ok: true, subject, email_body_html, sms_text, signature: sig,
    email_preview_html: renderEmailHtml({ bodyHtml: email_body_html, signature: sig, unsubscribeUrl: "#" }),
  });
});
