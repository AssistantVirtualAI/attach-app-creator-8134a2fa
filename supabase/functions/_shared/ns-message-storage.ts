// Provider history is mapped only in the authenticated / verified line context.
export function nsSessionId(session: any): string | null {
  const value = session?.["messagesession-id"] ?? session?.session_id ?? session?.["session-id"] ?? session?.id;
  return value == null || !String(value).trim() ? null : String(value).trim();
}
const endpoint = (value: unknown) => String(value ?? "").trim().split("@")[0];
export function nsMessageRow(message: any, owner: { profileId: string; extension: string; domain: string; organizationId: string }, threadId?: string) {
  const id = message?.id ?? message?.message_id ?? message?.["message-id"];
  const fromUser = String(message?.["from-user-id"] ?? "");
  const toUser = String(message?.["terminating-user-id"] ?? "");
  const aor = `${owner.extension}@${owner.domain}`;
  if (!id || message?.["deleted-datetime"]) return null;
  // A foreign named subscriber cannot be imported into this broker's history.
  const rawDirection = String(message?.direction ?? "").toLowerCase();
  const outbound = fromUser === aor || ["outbound", "out", "term"].includes(rawDirection);
  if (outbound ? (fromUser && fromUser !== aor) : (toUser && toUser !== aor)) return null;
  const rawTime = String(message?.timestamp ?? message?.sent_at ?? message?.created_at ?? "").trim().replace(" ", "T");
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(rawTime) ? rawTime : `${rawTime}Z`);
  if (!rawTime || !Number.isFinite(ms)) return null;
  const from = endpoint(message?.["from-number"] ?? message?.from_number ?? message?.from) || endpoint(fromUser);
  const to = endpoint(message?.["terminating-number"] ?? message?.to_number ?? message?.["to-number"] ?? message?.dialed ?? message?.to) || endpoint(toUser);
  if (!from || !to) return null;
  return {
    user_id: owner.profileId, organization_id: owner.organizationId, ns_message_id: String(id),
    thread_id: nsSessionId({ ...message, id: undefined }) ?? threadId ?? null,
    direction: outbound ? "outbound" : "inbound", from_number: from, to_number: to,
    body: String(message?.text ?? message?.body ?? message?.message ?? ""),
    media_urls: message?.media_urls ?? message?.["media-urls"] ?? message?.attachments ?? [],
    sent_at: new Date(ms).toISOString(), status: message?.status ?? message?.delivery_status ?? (outbound ? null : "received"),
    metadata: { source: "ns_history", extension: owner.extension },
  };
}
export async function persistNsMessages(admin: any, messages: any[], owner: Parameters<typeof nsMessageRow>[1], threadId?: string) {
  const rows = [...new Map(messages.map(m => nsMessageRow(m, owner, threadId)).filter(Boolean).map(row => [row?.ns_message_id, row])).values()];
  if (!rows.length) return 0;
  const { error } = await admin.from("planipret_phone_messages").upsert(rows, { onConflict: "ns_message_id", ignoreDuplicates: true });
  if (error) throw new Error(`sms_storage_failed:${error.code ?? "unknown"}`);
  return rows.length;
}