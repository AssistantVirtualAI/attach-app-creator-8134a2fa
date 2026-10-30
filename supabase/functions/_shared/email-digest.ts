// Résumé quotidien des courriels — construction déterministe (aucune IA pour
// les comptes ni les listes). Template HTML compatible Outlook (tables + CSS inline).

export type DigestMail = {
  id: string;
  subject?: string | null;
  from?: { emailAddress?: { name?: string | null; address?: string | null } } | null;
  receivedDateTime?: string | null;
  bodyPreview?: string | null;
  isRead?: boolean;
  importance?: string | null;
  inferenceClassification?: string | null;
  flag?: { flagStatus?: string | null } | null;
  webLink?: string | null;
};

export type DigestCategory = "priority" | "people" | "info";

const AUTOMATED = /(no-?reply|noreply|newsletter|news@|info@|marketing|mailer|notifications?@|bounce|digest|updates?@|hello@|deal ?centre)/i;
const INFO_SUBJECT = /(rate sheet|taux|newsletter|infolettre|webinar|webinaire|weekly|hebdo|promo|unsubscribe)/i;

export function categorize(m: DigestMail): DigestCategory {
  const addr = `${m.from?.emailAddress?.address ?? ""} ${m.from?.emailAddress?.name ?? ""}`;
  if (m.importance === "high" || m.flag?.flagStatus === "flagged") return "priority";
  if (AUTOMATED.test(addr) || INFO_SUBJECT.test(m.subject ?? "") || m.inferenceClassification === "other") return "info";
  if (!m.isRead) return "priority";
  return "people";
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clip = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function timeLabel(iso: string | null | undefined, tz = "America/Toronto") {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("fr-CA", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export type DigestInput = {
  brokerName: string;
  dateLabel: string;
  mails: DigestMail[];
  events?: Array<{ subject?: string; start?: string; location?: string }>;
  tz?: string;
};

export function summarizeCounts(mails: DigestMail[]) {
  const groups: Record<DigestCategory, DigestMail[]> = { priority: [], people: [], info: [] };
  for (const m of mails) groups[categorize(m)].push(m);
  return { total: mails.length, unread: mails.filter((m) => !m.isRead).length, groups };
}

function row(m: DigestMail, tz: string, withPreview: boolean) {
  const name = m.from?.emailAddress?.name || m.from?.emailAddress?.address || "Expéditeur inconnu";
  const link = m.webLink ? `<a href="${esc(m.webLink)}" style="color:#0023e6;text-decoration:none;font-weight:600;font-size:12px;">Ouvrir&nbsp;›</a>` : "";
  const unread = m.isRead ? "" : `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:#0023e6;margin-right:6px;"></span>`;
  return `<tr><td style="padding:12px 16px;border-bottom:1px solid #eef0f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font:600 14px/1.4 Arial,sans-serif;color:#0f172a;">${unread}${esc(clip(m.subject || "(sans objet)", 110))}</td>
<td align="right" style="font:12px Arial,sans-serif;color:#64748b;white-space:nowrap;padding-left:8px;">${esc(timeLabel(m.receivedDateTime, tz))}</td></tr>
<tr><td colspan="2" style="font:13px/1.4 Arial,sans-serif;color:#334155;padding-top:2px;">${esc(clip(name, 60))}</td></tr>
${withPreview && m.bodyPreview ? `<tr><td colspan="2" style="font:13px/1.5 Arial,sans-serif;color:#64748b;padding-top:4px;">${esc(clip(m.bodyPreview, 180))}</td></tr>` : ""}
${link ? `<tr><td colspan="2" style="padding-top:6px;">${link}</td></tr>` : ""}
</table></td></tr>`;
}

function section(title: string, accent: string, items: DigestMail[], tz: string, withPreview: boolean, empty: string) {
  const body = items.length ? items.map((m) => row(m, tz, withPreview)).join("") : `<tr><td style="padding:14px 16px;font:13px Arial,sans-serif;color:#64748b;">${esc(empty)}</td></tr>`;
  return `<tr><td style="padding:20px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
<tr><td style="padding:12px 16px;border-left:4px solid ${accent};background:#f8fafc;font:700 15px Arial,sans-serif;color:#0f172a;">${esc(title)} <span style="color:#64748b;font-weight:400;">(${items.length})</span></td></tr>
${body}</table></td></tr>`;
}

export function buildDigestHtml(input: DigestInput) {
  const tz = input.tz ?? "America/Toronto";
  const sorted = [...input.mails].sort((a, b) => Date.parse(b.receivedDateTime ?? "") - Date.parse(a.receivedDateTime ?? ""));
  const { total, unread, groups } = summarizeCounts(sorted);
  const stat = (n: number, label: string) => `<td align="center" style="padding:12px 4px;"><div style="font:700 24px Arial,sans-serif;color:#0023e6;">${n}</div><div style="font:12px Arial,sans-serif;color:#64748b;">${esc(label)}</div></td>`;
  const events = input.events ?? [];
  const eventsHtml = `<tr><td style="padding:20px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;">
<tr><td style="padding:12px 16px;border-left:4px solid #10b981;background:#f8fafc;font:700 15px Arial,sans-serif;color:#0f172a;">Rendez-vous de demain <span style="color:#64748b;font-weight:400;">(${events.length})</span></td></tr>
${events.length ? events.map((e) => `<tr><td style="padding:10px 16px;border-bottom:1px solid #eef0f6;font:13px Arial,sans-serif;color:#0f172a;"><b>${esc(timeLabel(e.start, tz))}</b> — ${esc(clip(e.subject || "(sans titre)", 90))}${e.location ? ` <span style="color:#64748b;">· ${esc(clip(e.location, 50))}</span>` : ""}</td></tr>`).join("") : `<tr><td style="padding:14px 16px;font:13px Arial,sans-serif;color:#64748b;">Aucun rendez-vous prévu.</td></tr>`}
</table></td></tr>`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
<tr><td style="background:#0023e6;border-radius:12px 12px 0 0;padding:24px;">
<div style="font:700 12px Arial,sans-serif;letter-spacing:2px;color:#c7d2fe;">PLANIPRÊT · AVA</div>
<div style="font:700 22px Arial,sans-serif;color:#ffffff;padding-top:6px;">Résumé de tes courriels</div>
<div style="font:14px Arial,sans-serif;color:#e0e7ff;padding-top:4px;">${esc(input.brokerName)} · ${esc(input.dateLabel)}</div></td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${stat(total, "reçus aujourd'hui")}${stat(unread, "non lus")}${stat(groups.priority.length, "à traiter")}</tr></table></td></tr>
${section("À traiter en priorité", "#ef4444", groups.priority, tz, true, "Rien d'urgent. Bravo !")}
${section("Clients et partenaires", "#0023e6", groups.people, tz, true, "Aucun autre courriel.")}
${section("Informations et infolettres", "#94a3b8", groups.info, tz, false, "Aucune infolettre.")}
${eventsHtml}
<tr><td style="padding:20px 8px;font:12px/1.5 Arial,sans-serif;color:#94a3b8;text-align:center;">Liste complète des ${total} courriels reçus aujourd'hui dans ta boîte de réception.<br/>Envoyé automatiquement par AVA à ton adresse seulement.</td></tr>
</table></td></tr></table></body></html>`;
  const subject = `Résumé de tes courriels — ${input.dateLabel} (${total} reçus, ${groups.priority.length} à traiter)`;
  return { html, subject, total, unread, priority: groups.priority.length };
}

/** Début de la journée locale en ISO UTC. */
export function localDayStartIso(tz = "America/Toronto", now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  const offsetMs = asUtc - now.getTime();
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - offsetMs).toISOString();
}
