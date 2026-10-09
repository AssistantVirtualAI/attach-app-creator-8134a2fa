// Resolve a planipret_phone_calls row from an identifier that may be either the
// local UUID (id) or a NetSapiens call id (ns_call_id). The mobile calls list
// keys rows by ns_call_id, so edge functions must accept both.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveCallRow(
  admin: any,
  callDbId: string | null | undefined,
  columns: string,
): Promise<any | null> {
  if (!callDbId) return null;
  if (UUID_RE.test(callDbId)) {
    const { data } = await admin
      .from("planipret_phone_calls")
      .select(columns)
      .eq("id", callDbId)
      .maybeSingle();
    if (data) return data;
  }
  const { data: byNsId } = await admin
    .from("planipret_phone_calls")
    .select(columns)
    .eq("ns_call_id", callDbId)
    .maybeSingle();
  return byNsId ?? null;
}
