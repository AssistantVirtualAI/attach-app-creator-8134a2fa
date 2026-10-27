// Merges the broker's own SMS rows with the server-provided other half of an
// internal extension thread (peer-owned replies are RLS-hidden client-side).
export function mergeSmsThreadMessages(own: any[], extra: any[]): any[] {
  const byId = new Map<string, any>();
  for (const m of [...(own ?? []), ...(extra ?? [])]) {
    if (m?.id) byId.set(m.id, m);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}
