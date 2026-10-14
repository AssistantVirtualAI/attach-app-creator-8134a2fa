// Recherche de la transcription sur le segment jumeau NetSapiens (même appel,
// autre jambe inbound/outbound). SÉCURITÉ : strictement limitée au propriétaire
// de l'appel (row.user_id). Jamais de recherche si user_id est absent — un admin
// analysant l'appel d'un courtier ne doit lire que les segments de ce courtier.

export interface TwinRow {
  id: string;
  transcript: string | null;
  transcript_segments: unknown;
}

export async function fetchTwinTranscript(
  admin: any,
  row: { user_id?: string | null; ns_orig_callid?: string | null; ns_callid?: string | null; ns_call_id?: string | null },
  callId: string,
): Promise<TwinRow | null> {
  if (!row.user_id) return null; // pas de propriétaire connu → aucune recherche
  const ids = [row.ns_orig_callid, row.ns_callid, row.ns_call_id]
    .filter((v): v is string => typeof v === "string" && v.length > 5);
  if (!ids.length) return null;
  const list = ids.map((v) => `"${v.replace(/"/g, "")}"`).join(",");
  const { data: twins } = await admin.from("planipret_phone_calls")
    .select("id,transcript,transcript_segments")
    .eq("user_id", row.user_id)
    .neq("id", callId)
    .is("deleted_at", null)
    .not("transcript", "is", null)
    .or(`ns_orig_callid.in.(${list}),ns_callid.in.(${list}),ns_call_id.in.(${list})`)
    .limit(3);
  return (twins ?? []).find((t: TwinRow) => String(t.transcript ?? "").trim().length >= 20) ?? null;
}
