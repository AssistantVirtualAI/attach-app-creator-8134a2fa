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
}