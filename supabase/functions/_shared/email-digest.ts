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

// ===================== Rapport quotidien complet =====================
export type ReportCall = { direction?: string | null; status?: string | null; started_at?: string | null; answered_at?: string | null; duration_seconds?: number | null; from_number?: string | null; from_name?: string | null; to_number?: string | null; to_name?: string | null };
export type ReportVoicemail = { from_number?: string | null; from_name?: string | null; received_at?: string | null; duration_seconds?: number | null; transcript?: string | null };
export type ReportSms = { direction?: string | null; from_number?: string | null; to_number?: string | null; body?: string | null; created_at?: string | null };
export type MailSummary = { id: string; summary?: string; action?: string };
export type ReportSections = { calls: boolean; voicemails: boolean; texts: boolean; emails: boolean; agenda: boolean };
export const DEFAULT_SECTIONS: ReportSections = { calls: true, voicemails: true, texts: true, emails: true, agenda: true };

export function isMissedCall(c: ReportCall) {
  const d = String(c.direction ?? "").toLowerCase(), s = String(c.status ?? "").toLowerCase();
  if (d === "outbound") return false;
  if (d === "missed" || ["missed", "no-answer", "busy", "inbound_ringing"].includes(s)) return true;
  return d === "inbound" && !c.answered_at && !(Number(c.duration_seconds) > 0);
}
export function isAnsweredCall(c: ReportCall) { return !isMissedCall(c) && (String(c.status ?? "") === "completed" || Number(c.duration_seconds) > 0 || !!c.answered_at); }

const hourOf = (iso: string | null | undefined, tz: string) => iso ? Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date(iso))) % 24 : -1;

export function callStats(calls: ReportCall[], tz = "America/Toronto") {
  const missed = calls.filter(isMissedCall);
  const answered = calls.filter(isAnsweredCall);
  const outbound = calls.filter((c) => c.direction === "outbound");
  const outboundNoAnswer = outbound.filter((c) => !isAnsweredCall(c));
  const byHour = Array.from({ length: 24 }, () => ({ answered: 0, missed: 0 }));
  for (const c of calls) { const h = hourOf(c.started_at, tz); if (h >= 0) (isMissedCall(c) ? byHour[h].missed++ : byHour[h].answered++); }
  const talkSeconds = answered.reduce((a, c) => a + (Number(c.duration_seconds) || 0), 0);
  return { total: calls.length, missed, answered: answered.length, outbound: outbound.length, outboundNoAnswer: outboundNoAnswer.length, byHour, talkSeconds };
}

const peerOf = (m: ReportSms) => String((m.direction === "inbound" ? m.from_number : m.to_number) ?? "").replace(/\D/g, "").slice(-10);
export function smsThreads(rows: ReportSms[]) {
  const map = new Map<string, ReportSms[]>();
  for (const r of rows) { const k = peerOf(r); if (!k) continue; (map.get(k) ?? map.set(k, []).get(k)!).push(r); }
  const threads = [...map.entries()].map(([peer, msgs]) => {
    msgs.sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""));
    const last = msgs[msgs.length - 1];
    return { peer, last, count: msgs.length, unanswered: last.direction === "inbound" };
  });
  threads.sort((a, b) => Number(b.unanswered) - Number(a.unanswered) || Date.parse(b.last.created_at ?? "") - Date.parse(a.last.created_at ?? ""));
  return { threads, received: rows.filter((r) => r.direction === "inbound").length, sent: rows.filter((r) => r.direction !== "inbound").length, unanswered: threads.filter((t) => t.unanswered).length };
}

export const fmtPhone = (v: unknown) => { const d = String(v ?? "").replace(/\D/g, "").slice(-10); return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}` : String(v ?? "—"); };
const fmtDur = (s: number) => s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`;
const trend = (now: number, prev?: number) => prev === undefined ? "" : now > prev ? `<span style="color:#16a34a;">▲ ${now - prev}</span>` : now < prev ? `<span style="color:#dc2626;">▼ ${prev - now}</span>` : `<span style="color:#94a3b8;">＝</span>`;

function card(title: string, accent: string, count: number | string, inner: string) {
  return `<tr><td style="padding:16px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<tr><td style="padding:12px 16px;border-left:4px solid ${accent};background:#f8fafc;font:700 15px Arial,sans-serif;color:#0f172a;">${esc(title)} <span style="color:#64748b;font-weight:400;">(${count})</span></td></tr>${inner}</table></td></tr>`;
}
const line = (left: string, right = "", sub = "") => `<tr><td style="padding:10px 16px;border-bottom:1px solid #eef0f6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font:600 14px/1.4 Arial,sans-serif;color:#0f172a;">${left}</td><td align="right" style="font:12px Arial,sans-serif;color:#64748b;white-space:nowrap;padding-left:8px;">${right}</td></tr>${sub ? `<tr><td colspan="2" style="font:13px/1.5 Arial,sans-serif;color:#475569;padding-top:3px;">${sub}</td></tr>` : ""}</table></td></tr>`;
const emptyRow = (t: string) => `<tr><td style="padding:14px 16px;font:13px Arial,sans-serif;color:#64748b;">${esc(t)}</td></tr>`;

function hourChart(byHour: Array<{ answered: number; missed: number }>) {
  const hours = byHour.slice(7, 21);
  const max = Math.max(1, ...hours.map((h) => h.answered + h.missed));
  const H = 90;
  const cols = hours.map((h, i) => {
    const a = Math.round((h.answered / max) * H), m = Math.round((h.missed / max) * H), pad = H - a - m;
    return `<td valign="bottom" align="center" style="padding:0 2px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${pad > 0 ? `<tr><td height="${pad}" style="font-size:0;line-height:0;">&nbsp;</td></tr>` : ""}${m > 0 ? `<tr><td height="${m}" style="background:#ef4444;font-size:0;line-height:0;border-radius:3px 3px 0 0;">&nbsp;</td></tr>` : ""}${a > 0 ? `<tr><td height="${a}" style="background:#0023e6;font-size:0;line-height:0;${m ? "" : "border-radius:3px 3px 0 0;"}">&nbsp;</td></tr>` : ""}</table>
<div style="font:10px Arial,sans-serif;color:#94a3b8;padding-top:4px;">${i + 7}h</div></td>`;
  }).join("");
  return `<tr><td style="padding:14px 12px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr>${cols}</tr></table>
<div style="font:12px Arial,sans-serif;color:#64748b;padding:8px 4px 0;"><span style="display:inline-block;width:10px;height:10px;background:#0023e6;border-radius:2px;"></span> Répondus / sortants &nbsp; <span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:2px;"></span> Manqués</div></td></tr>`;
}
function splitBar(a: number, b: number) {
  const t = a + b; if (!t) return "";
  const pa = Math.max(1, Math.round((a / t) * 100));
  return `<tr><td style="padding:4px 16px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;"><tr>
<td width="${pa}%" style="background:#0023e6;height:12px;font-size:0;">&nbsp;</td>${pa < 100 ? `<td style="background:#ef4444;height:12px;font-size:0;">&nbsp;</td>` : ""}</tr></table>
<div style="font:12px Arial,sans-serif;color:#64748b;padding-top:6px;">${Math.round((a / t) * 100)} % des appels entrants répondus</div></td></tr>`;
}

export type DailyReportInput = {
  brokerName: string; dateLabel: string; tz?: string; settingsUrl?: string;
  sections?: Partial<ReportSections>;
  calls: ReportCall[]; voicemails: ReportVoicemail[]; sms: ReportSms[];
  mails?: DigestMail[] | null; mailSummaries?: MailSummary[];
  events?: Array<{ subject?: string; start?: string; location?: string }>;
  tasks?: Array<{ title?: string; due?: string }>;
  yesterday?: { calls?: number; sms?: number; mails?: number };
  nameFor?: (phone: string | null | undefined) => string | null;
};

export function buildDailyReportHtml(input: DailyReportInput) {
  const tz = input.tz ?? "America/Toronto";
  const sec = { ...DEFAULT_SECTIONS, ...(input.sections ?? {}) };
  const who = (num: string | null | undefined, name?: string | null) => esc(name || input.nameFor?.(num) || fmtPhone(num));
  const cs = callStats(input.calls, tz);
  const ss = smsThreads(input.sms);
  const mails = [...(input.mails ?? [])].sort((a, b) => Date.parse(b.receivedDateTime ?? "") - Date.parse(a.receivedDateTime ?? ""));
  const { groups } = summarizeCounts(mails);
  const sumById = new Map((input.mailSummaries ?? []).map((s) => [s.id, s]));
  const vmByCaller = new Set(input.voicemails.map((v) => String(v.from_number ?? "").replace(/\D/g, "").slice(-10)));
  const inboundCount = cs.answered + cs.missed.length - cs.outbound + Math.max(0, cs.outbound - (cs.outbound));
  const kpi = (n: number | string, label: string, color: string, t = "") => `<td width="33%" align="center" style="padding:14px 4px;"><div style="font:700 26px Arial,sans-serif;color:${color};">${n}</div><div style="font:12px Arial,sans-serif;color:#64748b;">${esc(label)}</div><div style="font:11px Arial,sans-serif;padding-top:2px;">${t}</div></td>`;

  const mailRow = (m: DigestMail, preview: boolean) => {
    const s = sumById.get(m.id);
    const name = m.from?.emailAddress?.name || m.from?.emailAddress?.address || "Expéditeur inconnu";
    const text = s?.summary ? esc(clip(s.summary, 160)) : preview && m.bodyPreview ? esc(clip(m.bodyPreview, 160)) : "";
    const act = s?.action ? `<br/><span style="color:#0023e6;font-weight:600;">→ ${esc(clip(s.action, 100))}</span>` : "";
    const link = m.webLink ? ` · <a href="${esc(m.webLink)}" style="color:#0023e6;text-decoration:none;">Ouvrir</a>` : "";
    return line(`${m.isRead ? "" : "● "}${esc(clip(m.subject || "(sans objet)", 100))}`, esc(timeLabel(m.receivedDateTime, tz)), `${esc(clip(name, 60))}${link}${text ? `<br/>${text}` : ""}${act}`);
  };

  const parts: string[] = [];
  if (sec.calls) {
    parts.push(card("Activité d'appels", "#0023e6", cs.total, `${hourChart(cs.byHour)}${splitBar(input.calls.filter((c) => c.direction !== "outbound" && isAnsweredCall(c)).length, cs.missed.length)}`));
    parts.push(card("Appels manqués / sans réponse", "#ef4444", cs.missed.length, cs.missed.length ? cs.missed.slice(0, 40).map((c) => line(who(c.from_number, c.from_name), esc(timeLabel(c.started_at, tz)), vmByCaller.has(String(c.from_number ?? "").replace(/\D/g, "").slice(-10)) ? "📬 A laissé un message vocal" : "Aucun message laissé — à rappeler")).join("") : emptyRow("Aucun appel manqué aujourd'hui. 👏")));
  }
  if (sec.voicemails) parts.push(card("Messages vocaux", "#f59e0b", input.voicemails.length, input.voicemails.length ? input.voicemails.slice(0, 30).map((v) => line(who(v.from_number, v.from_name), `${esc(timeLabel(v.received_at, tz))}${v.duration_seconds ? ` · ${Math.max(1, Math.round(Number(v.duration_seconds)))} s` : ""}`, v.transcript ? `« ${esc(clip(v.transcript, 180))} »` : "")).join("") : emptyRow("Aucun message vocal.")));
  if (sec.texts) parts.push(card("Textos", "#8b5cf6", ss.threads.length, ss.threads.length ? ss.threads.slice(0, 30).map((t) => line(`${t.unanswered ? '<span style="color:#ef4444;">● Sans réponse</span> · ' : ""}${who(t.peer)}`, esc(timeLabel(t.last.created_at, tz)), `${t.last.direction === "inbound" ? "" : "Vous : "}${esc(clip(t.last.body, 140))} <span style="color:#94a3b8;">(${t.count} msg)</span>`)).join("") : emptyRow("Aucun texto aujourd'hui.")));
  if (sec.emails && input.mails) {
    parts.push(card("Courriels — à traiter en priorité", "#ef4444", groups.priority.length, groups.priority.length ? groups.priority.map((m) => mailRow(m, true)).join("") : emptyRow("Rien d'urgent.")));
    parts.push(card("Courriels — clients et partenaires", "#0023e6", groups.people.length, groups.people.length ? groups.people.map((m) => mailRow(m, true)).join("") : emptyRow("Aucun autre courriel.")));
    parts.push(card("Courriels — informations et infolettres", "#94a3b8", groups.info.length, groups.info.length ? groups.info.map((m) => mailRow(m, false)).join("") : emptyRow("Aucune infolettre.")));
  }
  if (sec.agenda) {
    const ev = input.events ?? [], tk = input.tasks ?? [];
    parts.push(card("Demain", "#10b981", ev.length + tk.length, (ev.length ? ev.map((e) => line(`${esc(timeLabel(e.start, tz))} — ${esc(clip(e.subject || "(sans titre)", 90))}`, "", e.location ? esc(clip(e.location, 60)) : "")).join("") : emptyRow("Aucun rendez-vous prévu.")) + tk.map((t) => line(`☐ ${esc(clip(t.title, 100))}`, esc(t.due ? t.due.slice(0, 10) : ""))).join("")));
  }
  void inboundCount;
  const y = input.yesterday ?? {};
  const html = `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:0;background:#eef2f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;"><tr><td align="center" style="padding:24px 10px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
<tr><td style="background:#0023e6;background-image:linear-gradient(135deg,#0023e6,#1e3a8a);border-radius:14px 14px 0 0;padding:26px 24px;">
<div style="font:700 11px Arial,sans-serif;letter-spacing:3px;color:#c7d2fe;">PLANIPRÊT · AVA</div>
<div style="font:700 24px Arial,sans-serif;color:#ffffff;padding-top:8px;">Ton résumé de la journée</div>
<div style="font:14px Arial,sans-serif;color:#e0e7ff;padding-top:4px;">${esc(input.brokerName)} · ${esc(input.dateLabel)}</div></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 14px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${kpi(cs.total, "appels", "#0023e6", trend(cs.total, y.calls))}${kpi(cs.missed.length, "manqués", cs.missed.length ? "#ef4444" : "#16a34a")}${kpi(input.voicemails.length, "messages vocaux", "#f59e0b")}</tr>
<tr>${kpi(`${ss.received}/${ss.sent}`, "textos reçus/envoyés", "#8b5cf6", trend(input.sms.length, y.sms))}${kpi(ss.unanswered, "textos sans réponse", ss.unanswered ? "#ef4444" : "#16a34a")}${kpi(input.mails ? mails.length : "—", input.mails ? `courriels · ${groups.priority.length} à traiter` : "courriels (M365 non relié)", "#0f172a", input.mails ? trend(mails.length, y.mails) : "")}</tr>
<tr><td colspan="3" style="padding:0 16px 14px;font:12px Arial,sans-serif;color:#64748b;text-align:center;">Temps en ligne : <b>${fmtDur(cs.talkSeconds)}</b> · Appels sortants : <b>${cs.outbound}</b> (${cs.outboundNoAnswer} sans réponse)</td></tr></table></td></tr>
${parts.join("")}
<tr><td style="padding:20px 8px;font:12px/1.6 Arial,sans-serif;color:#94a3b8;text-align:center;">Envoyé par AVA à ton adresse seulement.${input.settingsUrl ? ` <a href="${esc(input.settingsUrl)}" style="color:#64748b;">Modifier l'heure ou désactiver</a>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  const subject = `Ton résumé du ${input.dateLabel} — ${cs.missed.length} manqué(s), ${input.voicemails.length} vocal(aux), ${ss.unanswered} texto(s) sans réponse`;
  return { html, subject, stats: { calls: cs.total, missed: cs.missed.length, voicemails: input.voicemails.length, sms: input.sms.length, unansweredSms: ss.unanswered, mails: input.mails ? mails.length : null } };
}
