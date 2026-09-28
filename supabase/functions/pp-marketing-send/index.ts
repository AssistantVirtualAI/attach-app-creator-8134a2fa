// pp-marketing-send — envoi en lot d'une campagne marketing (texto + courriel).
// Textos : proxy NetSapiens existant (DID assigné au courtier).
// Courriels : boîte Outlook du courtier (Microsoft Graph /me/sendMail).
// Aucune configuration téléphonie n'est touchée ici.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { MS365_DELEGATED_SCOPES, refreshMicrosoftAccessToken } from "../_shared/ms365.ts";
import {
  json,
  requireBroker,
  brokerSignature,
  renderEmailHtml,
  rewriteLinks,
  trackBaseUrl,
  normalizeE164,
  EMAIL_RE,
} from "../_shared/pp-marketing.ts";

const MAX_RECIPIENTS = 500;
const GRAPH = "https://graph.microsoft.com/v1.0";

type Target = { client_id?: string; name?: string; phone?: string; email?: string };

async function sendGraphMail(admin: any, profile: any, to: string, subject: string, html: string) {
  const attempt = async (token: string) =>
    await fetch(`${GRAPH}/me/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });

  let r = await attempt(profile.ms365_access_token);
  if (r.status === 401) {
    const fresh = await refreshMicrosoftAccessToken(admin, profile, MS365_DELEGATED_SCOPES);
    if (fresh) { profile.ms365_access_token = fresh; r = await attempt(fresh); }
  }
  if (r.ok) return { ok: true as const };
  const txt = await r.text().catch(() => "");
  return { ok: false as const, status: r.status, error: txt.slice(0, 300) };
}

async function sendSms(userId: string, to: string, message: string, idem: string) {
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/pp-ns-sms?action=send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      _user_id: userId,
      to,
      message,
      confirmed: true,
      origin: "marketing",
      surface: "portal-marketing",
      idempotency_key: idem,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok && data?.ok !== false) return { ok: true as const };
  return { ok: false as const, error: String(data?.error ?? `HTTP ${r.status}`).slice(0, 300) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireBroker(req);
    if (ctx instanceof Response) return ctx;
    const { admin, userId } = ctx;

    const body = await req.json().catch(() => ({}));
    if (body?.confirmed !== true) {
      return json({ ok: false, error: "confirmation_required", message: "L'envoi doit être confirmé explicitement." }, 200);
    }

    const channels: string[] = Array.isArray(body?.channels)
      ? body.channels.filter((c: string) => c === "sms" || c === "email")
      : [];
    if (channels.length === 0) return json({ ok: false, error: "channel_required" }, 400);

    const subject = String(body?.subject ?? "").trim().slice(0, 200);
    const emailBodyHtml = String(body?.email_body_html ?? "").slice(0, 40000);
    const smsText = String(body?.sms_text ?? "").trim().slice(0, 480);
    const prompt = String(body?.prompt ?? "").slice(0, 4000);
    const targets: Target[] = Array.isArray(body?.recipients) ? body.recipients.slice(0, MAX_RECIPIENTS) : [];
    if (targets.length === 0) return json({ ok: false, error: "recipients_required", message: "Sélectionnez au moins un client." }, 400);
    if (channels.includes("email") && (!subject || !emailBodyHtml)) {
      return json({ ok: false, error: "email_content_required" }, 400);
    }
    if (channels.includes("sms") && !smsText) return json({ ok: false, error: "sms_content_required" }, 400);

    // Profil complet (jetons Microsoft) uniquement si un courriel doit partir.
    let mailProfile: any = null;
    if (channels.includes("email")) {
      const { data: p } = await admin
        .from("planipret_profiles")
        .select("id, user_id, full_name, email, ms365_email, ms365_access_token, ms365_refresh_token, ms365_scopes, ms365_token_expiry, phone, title")
        .or(`user_id.eq.${userId},id.eq.${userId}`)
        .limit(1)
        .maybeSingle();
      mailProfile = p ?? null;
      if (!mailProfile?.ms365_access_token) {
        return json({
          ok: false,
          error: "ms365_not_connected",
          message: "Connectez Microsoft 365 dans Réglages pour envoyer des courriels.",
        }, 200);
      }
    }

    const signature = brokerSignature(ctx.profile);

    // Désabonnements en vigueur
    const { data: optouts } = await admin.from("planipret_marketing_optouts").select("email, phone");
    const optEmails = new Set((optouts ?? []).map((o: any) => String(o.email ?? "").toLowerCase()).filter(Boolean));
    const optPhones = new Set((optouts ?? []).map((o: any) => String(o.phone ?? "")).filter(Boolean));

    // Construction des destinataires réels par canal
    const rows: any[] = [];
    const seenEmail = new Set<string>();
    const seenPhone = new Set<string>();
    for (const t of targets) {
      const name = String(t?.name ?? "").slice(0, 200);
      const cid = t?.client_id ? String(t.client_id).slice(0, 80) : null;
      if (channels.includes("email")) {
        const email = String(t?.email ?? "").trim().toLowerCase();
        if (email) {
          if (!EMAIL_RE.test(email)) {
            rows.push({ client_id: cid, client_name: name, email, channel: "email", status: "failed", error: "adresse_invalide" });
          } else if (optEmails.has(email)) {
            rows.push({ client_id: cid, client_name: name, email, channel: "email", status: "failed", error: "desabonne" });
          } else if (!seenEmail.has(email)) {
            seenEmail.add(email);
            rows.push({ client_id: cid, client_name: name, email, channel: "email", status: "queued" });
          }
        }
      }
      if (channels.includes("sms")) {
        const raw = t?.phone ?? "";
        const phone = normalizeE164(raw);
        if (String(raw ?? "").trim()) {
          if (!phone) {
            rows.push({ client_id: cid, client_name: name, phone: String(raw).slice(0, 40), channel: "sms", status: "failed", error: "numero_invalide" });
          } else if (optPhones.has(phone)) {
            rows.push({ client_id: cid, client_name: name, phone, channel: "sms", status: "failed", error: "desabonne" });
          } else if (!seenPhone.has(phone)) {
            seenPhone.add(phone);
            rows.push({ client_id: cid, client_name: name, phone, channel: "sms", status: "queued" });
          }
        }
      }
    }

    if (rows.length === 0) {
      return json({ ok: false, error: "no_reachable_recipient", message: "Aucun client sélectionné n'a de numéro ou d'adresse utilisable." }, 200);
    }

    const totalEmail = rows.filter((r) => r.channel === "email").length;
    const totalSms = rows.filter((r) => r.channel === "sms").length;

    const { data: campaign, error: cErr } = await admin
      .from("planipret_marketing_campaigns")
      .insert({
        broker_user_id: userId,
        broker_name: signature.name || null,
        channels,
        subject: subject || null,
        email_html: emailBodyHtml || null,
        sms_text: smsText || null,
        prompt: prompt || null,
        status: "sending",
        total_email: totalEmail,
        total_sms: totalSms,
      })
      .select("id")
      .single();
    if (cErr || !campaign) {
      console.error("[pp-marketing-send] campaign insert failed", cErr?.message);
      return json({ ok: false, error: "campaign_create_failed" }, 500);
    }

    const { data: inserted, error: rErr } = await admin
      .from("planipret_marketing_recipients")
      .insert(rows.map((r) => ({ ...r, campaign_id: campaign.id })))
      .select("id, channel, status, email, phone, track_token, client_name");
    if (rErr || !inserted) {
      console.error("[pp-marketing-send] recipients insert failed", rErr?.message);
      return json({ ok: false, error: "recipients_create_failed" }, 500);
    }

    let sentEmail = 0, sentSms = 0;
    let failed = inserted.filter((r: any) => r.status === "failed").length;

    for (const r of inserted as any[]) {
      if (r.status !== "queued") continue;
      const nowIso = new Date().toISOString();
      if (r.channel === "email") {
        const unsubscribeUrl = `${trackBaseUrl()}?a=unsub&c=${encodeURIComponent(r.track_token)}`;
        const pixelUrl = `${trackBaseUrl()}?a=open&c=${encodeURIComponent(r.track_token)}`;
        const html = renderEmailHtml({
          bodyHtml: rewriteLinks(emailBodyHtml, r.track_token),
          signature,
          unsubscribeUrl,
          pixelUrl,
        });
        const out = await sendGraphMail(admin, mailProfile, r.email, subject, html);
        if (out.ok) {
          sentEmail++;
          await admin.from("planipret_marketing_recipients")
            .update({ status: "sent", sent_at: nowIso }).eq("id", r.id);
        } else {
          failed++;
          await admin.from("planipret_marketing_recipients")
            .update({ status: "failed", error: `courriel_refuse (${out.status ?? "?"})` }).eq("id", r.id);
        }
      } else {
        const out = await sendSms(userId, r.phone, smsText, `mkt:${r.id}`);
        if (out.ok) {
          sentSms++;
          await admin.from("planipret_marketing_recipients")
            .update({ status: "sent", sent_at: nowIso }).eq("id", r.id);
        } else {
          failed++;
          await admin.from("planipret_marketing_recipients")
            .update({ status: "failed", error: out.error.slice(0, 200) }).eq("id", r.id);
        }
      }
    }

    await admin.from("planipret_marketing_campaigns").update({
      status: "sent",
      sent_email: sentEmail,
      sent_sms: sentSms,
      failed_count: failed,
    }).eq("id", campaign.id);

    return json({
      ok: true,
      campaign_id: campaign.id,
      sent_email: sentEmail,
      sent_sms: sentSms,
      failed,
      total: inserted.length,
    });
  } catch (e) {
    console.error("[pp-marketing-send] error", String((e as Error)?.message ?? e).slice(0, 200));
    return json({ ok: false, error: "server_error" }, 500);
  }
});
