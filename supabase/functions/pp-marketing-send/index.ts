// POST — crée la campagne et envoie (textos NetSapiens depuis le DID du courtier,
// courriels via Outlook /me/sendMail du courtier). Confirmation explicite requise.
import { refreshMicrosoftAccessToken } from "../_shared/ms365.ts";
import {
  brokerSignature, corsHeaders, EMAIL_RE, json, normalizeE164, renderEmailHtml, requireBroker, rewriteLinks, trackBaseUrl,
} from "../_shared/pp-marketing.ts";

const MAX_RECIPIENTS = 500;
const BATCH = 5;

async function graphToken(admin: any, profile: any): Promise<string | null> {
  const exp = profile?.ms365_token_expiry ? new Date(profile.ms365_token_expiry).getTime() : 0;
  if (profile?.ms365_access_token && exp - Date.now() > 120_000) return profile.ms365_access_token;
  return await refreshMicrosoftAccessToken(admin, profile);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const ctx = await requireBroker(req);
  if ("error" in ctx) return ctx.error;
  const { admin, profile, userId } = ctx;

  const b = await req.json().catch(() => ({}));
  if (b?.confirmed !== true) return json({ ok: false, error: "confirmation_required" }, 400);
  const channels: string[] = (Array.isArray(b?.channels) ? b.channels : []).filter((c: string) => c === "sms" || c === "email");
  if (!channels.length) return json({ ok: false, error: "channels_required" }, 400);
  const subject = String(b?.subject ?? "").trim().slice(0, 200);
  const emailBody = String(b?.email_body_html ?? "").slice(0, 40000);
  const smsText = String(b?.sms_text ?? "").trim().slice(0, 480);
  const targets: any[] = Array.isArray(b?.targets) ? b.targets.slice(0, MAX_RECIPIENTS + 1) : [];
  if (!targets.length) return json({ ok: false, error: "no_recipients" }, 400);
  if (targets.length > MAX_RECIPIENTS) return json({ ok: false, error: "too_many_recipients", max: MAX_RECIPIENTS }, 400);
  if (channels.includes("email") && (!subject || !emailBody)) return json({ ok: false, error: "email_content_required" }, 400);
  if (channels.includes("sms") && !smsText) return json({ ok: false, error: "sms_content_required" }, 400);

  // Verrou anti-double-envoi : même contenu envoyé par ce courtier il y a < 2 min.
  const since = new Date(Date.now() - 120_000).toISOString();
  const { data: recentRows } = await admin.from("planipret_marketing_campaigns").select("id, sms_text, subject")
    .eq("broker_user_id", userId).gte("created_at", since).limit(20);
  const recent = (recentRows ?? []).find((c: any) => (c.sms_text ?? "") === smsText && (c.subject ?? "") === subject);
  if (recent) return json({ ok: false, error: "duplicate_send", campaign_id: recent.id }, 409);

  let token: string | null = null;
  if (channels.includes("email")) {
    token = await graphToken(admin, profile);
    if (!token) return json({ ok: false, error: "outlook_not_connected" }, 200);
  }

  const { data: opt } = await admin.from("planipret_marketing_optouts").select("email, phone");
  const optEmails = new Set((opt ?? []).map((o: any) => String(o.email ?? "").toLowerCase()).filter(Boolean));
  const optPhones = new Set((opt ?? []).map((o: any) => String(o.phone ?? "")).filter(Boolean));

  const rows: any[] = [];
  const seenE = new Set<string>(), seenP = new Set<string>();
  for (const t of targets) {
    const base = { client_id: t?.client_id ? String(t.client_id).slice(0, 64) : null, client_name: String(t?.name ?? "").slice(0, 160) || null };
    if (channels.includes("sms")) {
      const phone = normalizeE164(t?.phone);
      if (!phone) { if (t?.phone) rows.push({ ...base, channel: "sms", phone: String(t.phone).slice(0, 40), status: "failed", error: "numero_invalide" }); }
      else if (!seenP.has(phone)) {
        seenP.add(phone);
        rows.push({ ...base, channel: "sms", phone, status: optPhones.has(phone) ? "failed" : "queued", error: optPhones.has(phone) ? "desabonne" : null });
      }
    }
    if (channels.includes("email")) {
      const email = String(t?.email ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) { if (email) rows.push({ ...base, channel: "email", email: email.slice(0, 255), status: "failed", error: "adresse_invalide" }); }
      else if (!seenE.has(email)) {
        seenE.add(email);
        rows.push({ ...base, channel: "email", email, status: optEmails.has(email) ? "failed" : "queued", error: optEmails.has(email) ? "desabonne" : null });
      }
    }
  }
  if (!rows.length) return json({ ok: false, error: "no_valid_recipients" }, 400);

  const { data: camp, error: cErr } = await admin.from("planipret_marketing_campaigns").insert({
    broker_user_id: userId, broker_name: profile?.full_name ?? null, channels,
    subject: subject || null, email_html: channels.includes("email") ? emailBody : null, sms_text: smsText || null,
    prompt: String(b?.prompt ?? "").slice(0, 4000) || null, status: "sending",
    total_email: rows.filter((r) => r.channel === "email").length,
    total_sms: rows.filter((r) => r.channel === "sms").length,
    failed_count: rows.filter((r) => r.status === "failed").length,
  }).select("id").single();
  if (cErr || !camp) return json({ ok: false, error: "campaign_insert_failed" }, 500);

  const { data: recips, error: rErr } = await admin.from("planipret_marketing_recipients")
    .insert(rows.map((r) => ({ ...r, campaign_id: camp.id }))).select("id, channel, phone, email, status, track_token");
  if (rErr) return json({ ok: false, error: "recipients_insert_failed" }, 500);

  const sig = brokerSignature(profile);
  const smsUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pp-ns-sms?action=send`;
  let sentE = 0, sentS = 0, failed = 0;

  const sendOne = async (r: any) => {
    const now = new Date().toISOString();
    try {
      if (r.channel === "email") {
        const base = trackBaseUrl();
        const html = renderEmailHtml({
          bodyHtml: rewriteLinks(emailBody, r.track_token), signature: sig,
          unsubscribeUrl: `${base}?a=unsub&c=${r.track_token}`, pixelUrl: `${base}?a=open&c=${r.track_token}`,
        });
        const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: r.email } }] }, saveToSentItems: true }),
        });
        if (!res.ok) throw new Error(res.status === 400 ? "adresse_refusee" : `outlook_${res.status}`);
        await res.text();
        sentE++;
      } else {
        const res = await fetch(smsUrl, {
          method: "POST",
          headers: { Authorization: ctx.auth, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" },
          body: JSON.stringify({ to: r.phone, message: smsText, confirmed: true, origin: "marketing", surface: "portal-marketing", idempotency_key: `mkt:${r.id}` }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d?.ok === false) throw new Error(String(d?.error_code ?? d?.error ?? `sms_${res.status}`).slice(0, 120));
        sentS++;
      }
      await admin.from("planipret_marketing_recipients").update({ status: "sent", sent_at: now, error: null }).eq("id", r.id);
    } catch (e) {
      failed++;
      await admin.from("planipret_marketing_recipients").update({ status: "failed", error: String((e as Error).message).slice(0, 200) }).eq("id", r.id);
    }
  };

  const queue = (recips ?? []).filter((r: any) => r.status === "queued");
  for (let i = 0; i < queue.length; i += BATCH) await Promise.all(queue.slice(i, i + BATCH).map(sendOne));

  const preFailed = rows.filter((r) => r.status === "failed").length;
  await admin.from("planipret_marketing_campaigns").update({
    status: sentE + sentS > 0 ? "sent" : "failed", sent_email: sentE, sent_sms: sentS, failed_count: preFailed + failed,
  }).eq("id", camp.id);

  return json({ ok: true, campaign_id: camp.id, sent_email: sentE, sent_sms: sentS, failed: preFailed + failed, total: rows.length });
});
