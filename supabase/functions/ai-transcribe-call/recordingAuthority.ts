// Phase 30A — do not let an authenticated client lend the service-role its
// recording path, URL, organization or PBX identity for an AI transcription.
// Service-role jobs retain their separate existing contract in index.ts.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuthorizedTranscription = {
  call: Record<string, any>;
  recording: Record<string, any> | null;
};

export async function resolveAuthorizedTranscription(
  admin: any,
  userId: string,
  requestedId: unknown,
): Promise<AuthorizedTranscription | null> {
  const id = String(requestedId ?? '').trim();
  if (!userId || !UUID.test(id)) return null;

  const select = 'id,pbx_uuid,organization_id,extension,raw_data,caller_number,caller_name,destination_number,destination,direction,start_at,duration_seconds,billsec,hangup_cause,recording_url,recording_path,recording_name,voicemail_message,domain_uuid,domain_name';
  // Match proxy precedence: the FusionPBX XML CDR UUID, then our database UUID.
  let result = await admin.from('pbx_call_records').select(select).eq('pbx_uuid', id).maybeSingle();
  if (result.error) return null;
  let call = result.data;
  if (!call) {
    result = await admin.from('pbx_call_records').select(select).eq('id', id).maybeSingle();
    if (result.error) return null;
    call = result.data;
  }

  let recording: Record<string, any> | null = null;
  if (!call) {
    const row = await admin.from('pbx_call_recordings')
      .select('id,call_record_id,organization_id,recording_url,recording_path,recording_name')
      .eq('id', id).maybeSingle();
    if (row.error || !row.data?.call_record_id || !UUID.test(String(row.data.call_record_id))) return null;
    recording = row.data;
    result = await admin.from('pbx_call_records').select(select).eq('id', row.data.call_record_id).maybeSingle();
    if (result.error) return null;
    call = result.data;
  }

  const organizationId = String(call?.organization_id ?? '').trim();
  const extension = String(call?.extension ?? '').trim();
  if (!call?.id || !organizationId || !extension || (recording && recording.organization_id !== organizationId)) return null;
  const owner = await admin.from('pbx_softphone_users').select('extension')
    .eq('portal_user_id', userId).eq('organization_id', organizationId)
    .eq('extension', extension).maybeSingle();
  if (owner.error || !owner.data) return null;
  return { call, recording };
}
