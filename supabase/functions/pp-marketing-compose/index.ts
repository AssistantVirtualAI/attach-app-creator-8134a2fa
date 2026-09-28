// pp-marketing-compose — génère (ou régénère) un courriel marketing mis en page
// et un texto court à partir de l'idée du courtier. Aucune donnée envoyée :
// cette fonction ne fait que produire du contenu à valider.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { callAnthropic } from "../_shared/anthropic.ts";
import { CLAUDE_DEFAULT_MODEL } from "../_shared/claude-compat.ts";
import {
  json,
  requireBroker,
  brokerSignature,
  renderEmailHtml,
} from "../_shared/pp-marketing.ts";

const SYSTEM = `Tu es rédacteur marketing pour Planiprêt, un cabinet de courtage hypothécaire au Québec.
À partir de l'idée du courtier, tu produis:
1. "subject": un objet de courriel court (max 70 caractères), clair, sans emoji excessif, sans MAJUSCULES criardes.
2. "email_body_html": le CORPS du courriel en HTML simple (uniquement <p>, <h2>, <ul>, <li>, <strong>, <a>, <div>).
   - Style professionnel, chaleureux, concret. 120 à 220 mots.
   - Commence par une salutation générique ("Bonjour,").
   - Termine par un appel à l'action clair (ex: bouton/lien pour répondre ou prendre rendez-vous).
   - N'inclus PAS de logo, PAS de signature, PAS de mention de désabonnement: ils sont ajoutés automatiquement.
   - N'invente aucun taux, chiffre, promotion, date ou promesse qui ne figure pas dans l'idée du courtier.
3. "sms_text": un texto de 160 caractères maximum, clair, sans lien raccourci inventé, qui se termine par " Répondre STOP pour arrêter."
Respecte la langue de l'idée du courtier (français par défaut).
Réponds UNIQUEMENT avec un objet JSON valide: {"subject":"...","email_body_html":"...","sms_text":"..."}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireBroker(req);
    if (ctx instanceof Response) return ctx;

    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt ?? "").trim();
    const channels: string[] = Array.isArray(body?.channels) ? body.channels : ["email", "sms"];
    const variant = Number(body?.variant ?? 0);
    if (!prompt) return json({ ok: false, error: "prompt_required", message: "Écrivez d'abord le message à envoyer." }, 400);
    if (prompt.length > 4000) return json({ ok: false, error: "prompt_too_long" }, 400);

    const signature = brokerSignature(ctx.profile);
    const res = await callAnthropic({
      model: CLAUDE_DEFAULT_MODEL,
      max_tokens: 1600,
      system: SYSTEM,
      temperature: variant > 0 ? 0.9 : 0.6,
      messages: [{
        role: "user",
        content: `Canaux demandés: ${channels.join(", ")}.
Courtier: ${signature.name || "courtier Planiprêt"}${signature.title ? ` (${signature.title})` : ""}.
Idée du message du courtier:
"""${prompt}"""
${variant > 0 ? "Propose une formulation nettement différente de la précédente." : ""}`,
      }],
      label: "pp-marketing-compose",
    });

    if (!res.ok) {
      console.error("[pp-marketing-compose] ai error", res.status);
      return json({
        ok: false,
        error: "ai_unavailable",
        message: "La génération du message est temporairement indisponible. Réessayez dans un moment.",
      }, 200);
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(String(res.text ?? "").replace(/```json|```/g, "").trim());
    } catch {
      const m = String(res.text ?? "").match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } }
    }
    if (!parsed || typeof parsed !== "object") {
      return json({ ok: false, error: "ai_bad_output", message: "Message non généré. Réessayez." }, 200);
    }

    const subject = String(parsed.subject ?? "").slice(0, 150);
    const emailBodyHtml = String(parsed.email_body_html ?? "").slice(0, 20000);
    const smsText = String(parsed.sms_text ?? "").slice(0, 480);

    return json({
      ok: true,
      subject,
      email_body_html: emailBodyHtml,
      sms_text: smsText,
      signature,
      email_preview_html: renderEmailHtml({ bodyHtml: emailBodyHtml, signature, unsubscribeUrl: "#" }),
    });
  } catch (e) {
    console.error("[pp-marketing-compose] error", String((e as Error)?.message ?? e).slice(0, 200));
    return json({ ok: false, error: "server_error" }, 500);
  }
});
