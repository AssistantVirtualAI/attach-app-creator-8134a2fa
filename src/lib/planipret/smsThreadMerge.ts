// Merges the broker's own SMS rows with the server-provided other half of an
// internal extension thread (peer-owned replies are RLS-hidden client-side).
// One physical message can exist twice — the broker's own log and the webhook
// mirror — so identical body within the same minute collapses to one bubble
// (same rule as the admin thread view).
export function mergeSmsThreadMessages(own: any[], extra: any[]): any[] {
  const byId = new Map<string, any>();
  const byContent = new Map<string, string>();
  for (const m of [...(own ?? []), ...(extra ?? [])]) {
    if (!m?.id) continue;
    if (byId.has(m.id)) continue;
    const contentKey = `${String(m.body ?? "").trim()}|${String(m.created_at ?? "").slice(0, 16)}`;
    const keptId = byContent.get(contentKey);
    if (keptId) continue;
    byId.set(m.id, m);
    byContent.set(contentKey, m.id);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}
