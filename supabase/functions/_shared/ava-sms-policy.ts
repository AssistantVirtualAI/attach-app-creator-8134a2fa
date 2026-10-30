export const MARC_SMS_USER_ID = "a7df1872-f25a-4925-b763-a573e7452462";
export const MARC_SMS_PROFILE_ID = "f9e829ad-e5ff-42ff-8337-2cb508bdd3b5";
export function pilotOwner(profile: { id?: string; user_id?: string; extension?: string; ns_domain?: string }) {
  return profile.id === MARC_SMS_PROFILE_ID && profile.user_id === MARC_SMS_USER_ID && profile.extension === "1136" && profile.ns_domain === "planipret.ca";
}
export function smsPeer(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!/^\+?[\d ()-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  if (/^\d{2,6}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}
export function safeThread(rows: any[], profileId: string, peer: string) {
  return rows.filter(row => row.user_id === profileId && smsPeer(row.direction === "inbound" ? row.from_number : row.to_number) === peer);
}
export function eligibleInbound(row: any, config: any, profile: any) {
  return pilotOwner(profile) && config?.enabled === true && row?.user_id === profile.id && row?.direction === "inbound"
    && Date.parse(row.created_at) >= Date.parse(config.activated_at) && !!smsPeer(row.from_number)
    && smsPeer(row.from_number) !== smsPeer(row.to_number) && !row.metadata?.ava_sms_job;
}
export function hasCalendarConflict(start: string, end: string, events: any[]) {
  return events.some(event => {
    const from=Date.parse(event.start?.dateTime??event.start),to=Date.parse(event.end?.dateTime??event.end);
    return !Number.isFinite(from)||!Number.isFinite(to)||(from<Date.parse(end)&&to>Date.parse(start));
  });
}
export function explicitBookingRequest(text:string) {
  return /\b(réserve|reserver|réserver|book|prendre|fixer|planifier)\b/i.test(text)
    && /rendez[- ]?vous|appointment|rencontre/i.test(text)
    && /\b\d{1,2}(?:h\d{0,2}|:\d{2})\b/.test(text)
    && /\b\d{4}-\d{2}-\d{2}\b/.test(text)
    && /\b\d{1,3}\s*(?:minutes?|min)\b/i.test(text);
}export const AVA_SMS_SIGNATURE = "— AVA, assistante de Marc Maglieri";
/** Server-side signature: every automated text says AVA wrote it, never Marc. Idempotent. */
export function signAvaSms(text: string): string {
  const body = String(text ?? "").replace(/\s*—\s*AVA[^\n]*$/u, "").trim();
  return `${body}\n${AVA_SMS_SIGNATURE}`;
}
const MARC_AOR = "1136@planipret.ca";
const nsTime = (v: unknown) => { const s = String(v ?? "").trim(); if (!s) return null; const d = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`); return Number.isFinite(d) ? new Date(d).toISOString() : null; };
const endpoint = (v: unknown) => String(v ?? "").trim().split("@")[0];
/** Inbound NS v2 message on Marc's line → local row. Outbound/foreign/echo messages return null. */
export function pilotInboundRow(m: any, profileId: string, orgId: string) {
  if (String(m?.direction ?? "").toLowerCase() !== "orig" || String(m?.["terminating-user-id"] ?? "") !== MARC_AOR) return null;
  if (String(m?.["deleted-datetime"] ?? "")) return null;
  const from = endpoint(m?.["from-user-id"]) || endpoint(m?.["from-number"]);
  const sentAt = nsTime(m?.timestamp);
  if (!m?.id || !smsPeer(from) || from === "1136" || !sentAt) return null;
  return { user_id: profileId, organization_id: orgId, ns_message_id: String(m.id), thread_id: m?.["messagesession-id"] ?? null,
    direction: "inbound", from_number: from, to_number: m?.dialed != null ? String(m.dialed) : "1136",
    body: typeof m?.text === "string" ? m.text : (m?.["media-type"] ? "[média]" : ""), sent_at: sentAt, status: "received",
    metadata: { source: "ava_sms_watch", messagesession_id: m?.["messagesession-id"] ?? null } };
}
/** Session worth reading: updated since activation and the last word is not Marc's line (AVA replies count as Marc's). */
export function sessionNeedsRead(s: any, activatedAt: string, nowMs = Date.now()) {
  const last = Date.parse(nsTime(s?.["messagesession-last-datetime"]) ?? "");
  return Number.isFinite(last) && last >= Date.parse(activatedAt) && last >= nowMs - 24 * 3600_000
    && String(s?.["messagesession-last-sender"] ?? "") !== MARC_AOR && !!s?.["messagesession-id"];
}
/** Full conversation from the provider, restricted to one peer, oldest first. */
export function providerHistory(msgs: any[], peer: string, limit = 20) {
  return msgs.filter(m => !String(m?.["deleted-datetime"] ?? "")).map(m => {
    const inbound = String(m?.direction ?? "").toLowerCase() === "orig";
    const other = inbound ? (endpoint(m?.["from-user-id"]) || endpoint(m?.["from-number"])) : (endpoint(m?.["terminating-user-id"]) || endpoint(m?.["terminating-number"]) || endpoint(m?.dialed));
    return { at: nsTime(m?.timestamp) ?? "", peer: smsPeer(other), role: inbound ? "user" : "assistant", text: String(m?.text ?? "").slice(0, 1200) };
  }).filter(x => x.peer === peer && x.at && x.text).sort((a, b) => a.at.localeCompare(b.at)).slice(-limit).map(({ role, text }) => ({ role, text }));
}

/** Booking intent anywhere in the sender's recent words (date/time resolved by the model, verified by the server). */
export function bookingIntent(text: string) {
  return /rendez[- ]?vous|\brdv\b|appointment|rencontre|meeting|réunion|reunion|booker|réserv|reserv|planifier|céduler|ceduler|disponib/i.test(text);
}
/** Customer asking where their mortgage file stands. */
export function fileStatusIntent(text: string) {
  return /\b(dossier|file|demande|prêt|pret|hypoth[eè]que|mortgage|approbation|approval|statut|status|où en est|ou en est|update|nouvelles?)\b/i.test(text);
}
const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();
const tenDigits = (s: unknown) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 ? d : null; };
function collect(obj: any, test: (k: string, v: any) => boolean, out: string[] = [], depth = 0): string[] {
  if (!obj || typeof obj !== "object" || depth > 4) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") collect(v, test, out, depth + 1);
    else if (test(k, v)) out.push(String(v));
  }
  return out;
}
export function profilePhones(profile: any): string[] {
  return [...new Set(collect(profile, (k, v) => /phone|tel|cell|mobile/i.test(k) && !!tenDigits(v)).map(tenDigits) as string[])];
}
export function profileFullNames(profile: any): string[] {
  const p = profile ?? {};
  const first = p.first_name ?? p.firstname ?? p.prenom ?? p.firstName, last = p.last_name ?? p.lastname ?? p.nom ?? p.lastName;
  return [first && last ? `${first} ${last}` : "", p.full_name, p.name, p.fullName].map(fold).filter(n => n.split(" ").length >= 2);
}
/**
 * Security check for file updates by SMS: the sender gave a first AND last name that
 * appears in their own messages, it matches the Maestro profile, and the texting number
 * is one of that profile's phone numbers. All three or nothing.
 */
export function smsIdentityVerified(claimedName: unknown, senderWords: string, senderPeer: string, profile: any) {
  const claimed = fold(claimedName);
  if (claimed.split(" ").length < 2 || !fold(senderWords).includes(claimed)) return false;
  const sender = tenDigits(senderPeer);
  if (!sender || !profilePhones(profile).includes(sender)) return false;
  const tokens = claimed.split(" ");
  return profileFullNames(profile).some(n => { const parts = n.split(" "); return parts.every(t => tokens.includes(t)) && tokens.every(t => parts.includes(t)); });
}
