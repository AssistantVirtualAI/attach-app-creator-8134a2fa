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
