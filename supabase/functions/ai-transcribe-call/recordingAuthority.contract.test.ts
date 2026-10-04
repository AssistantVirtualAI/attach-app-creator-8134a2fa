// Phase 30A — no network, database, STT service, PBX or Supabase secrets.
import { resolveAuthorizedTranscription } from './recordingAuthority.ts';

const ownId = '00000000-0000-4000-8000-000000000001';
const pbxId = '00000000-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';
const recId = '00000000-0000-4000-8000-000000000004';
const ownCall = { id: ownId, pbx_uuid: pbxId, organization_id: 'org-a', extension: '201', recording_path: '/server/path', recording_name: 'server.wav', recording_url: 'https://server.invalid/own' };
const otherCall = { id: otherId, pbx_uuid: otherId, organization_id: 'org-a', extension: '305', recording_path: '/other/path', recording_name: 'other.wav' };

function fakeAdmin(overrides: { owner?: boolean; calls?: Record<string, any>[]; recording?: Record<string, any> } = {}) {
  const calls = overrides.calls ?? [ownCall, otherCall];
  const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
  return {
    queries,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select(_columns: string) { return query; },
        eq(column: string, value: unknown) { filters[column] = value; return query; },
        async maybeSingle() {
          queries.push({ table, filters: { ...filters } });
          const rows = table === 'pbx_call_records' ? calls
            : table === 'pbx_call_recordings' ? [overrides.recording].filter(Boolean)
            : table === 'pbx_softphone_users' && overrides.owner !== false
              ? [{ portal_user_id: 'user-a', organization_id: 'org-a', extension: '201' }]
              : [];
          return { data: rows.find((row) => row && Object.entries(filters).every(([k, v]) => row[k] === v)) ?? null, error: null };
        },
      };
      return query;
    },
  };
}

function assert(condition: unknown, message: string) { if (!condition) throw new Error(message); }

Deno.test('own CDR is resolved from the server, never from client metadata', async () => {
  const admin = fakeAdmin();
  const result = await resolveAuthorizedTranscription(admin, 'user-a', pbxId);
  assert(result?.call === ownCall, 'canonical call must be returned');
  assert(admin.queries.some((q) => q.table === 'pbx_softphone_users' && q.filters.extension === '201' && q.filters.organization_id === 'org-a'), 'exact user/org/extension membership required');
});

Deno.test('a same-organization foreign extension cannot reach audio through transcription', async () => {
  const admin = fakeAdmin();
  assert(await resolveAuthorizedTranscription(admin, 'user-a', otherId) === null, 'foreign extension denied');
  assert(admin.queries.every((q) => q.table !== 'pbx_call_recordings'), 'no unrelated fallback on a foreign CDR');
});

Deno.test('missing user membership, missing extension or forged org on recording id fail closed', async () => {
  assert(await resolveAuthorizedTranscription(fakeAdmin({ owner: false }), 'user-a', ownId) === null, 'membership mandatory');
  assert(await resolveAuthorizedTranscription(fakeAdmin({ calls: [{ ...ownCall, extension: '' }] }), 'user-a', ownId) === null, 'extension mandatory');
  const forged = fakeAdmin({ recording: { id: recId, call_record_id: ownId, organization_id: 'org-b' } });
  assert(await resolveAuthorizedTranscription(forged, 'user-a', recId) === null, 'recording and CDR organizations must agree');
});

Deno.test('recording id resolves only to its authorized CDR, with no pointer-only fallback', async () => {
  const admin = fakeAdmin({ recording: { id: recId, call_record_id: ownId, organization_id: 'org-a', recording_path: '/server/recording' } });
  const result = await resolveAuthorizedTranscription(admin, 'user-a', recId);
  assert(result?.call.id === ownId && result.recording?.recording_path === '/server/recording', 'authorized recording resolves via CDR');
  assert(await resolveAuthorizedTranscription(fakeAdmin(), 'user-a', recId) === null, 'absent CDR denied even if body has a URL');
  assert(await resolveAuthorizedTranscription(fakeAdmin(), 'user-a', 'https://internal.invalid/audio') === null, 'URL is not a CDR identifier');
});

Deno.test('handler passes user JWT to the proxy and never uses direct-URL fallback for it', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assert(source.includes('resolveAuthorizedTranscription(admin, user.id, call_record_id)'), 'user authorization precedes audio');
  assert(source.includes('const proxyBearer = isServiceCall ? SERVICE_KEY : authHeader;'), 'proxy reauthorizes user JWT');
  assert(source.includes('if (isServiceCall && !audioBytes && sourceUrl && !isTwilio)'), 'only service role can fetch URL directly');
  assert(source.includes('recording_url = call.recording_url || resolved.recording?.recording_url || null;'), 'body URL overwritten by server');
  assert(source.includes('xml_cdr_uuid = call.pbx_uuid || call.id;'), 'body PBX identity overwritten by server');
});

Deno.test('PBX AI analysis authorizes the CDR before reading cached transcripts or insights', async () => {
  const source = await Deno.readTextFile(new URL('../ai-analyze-call/index.ts', import.meta.url));
  const pbxBranch = source.split('// ================== PLANIPRET COACHING BRANCH ==================')[0];
  const guard = pbxBranch.indexOf('resolveAuthorizedTranscription(admin, user.id, call_id)');
  const transcriptRead = pbxBranch.indexOf('admin.from("pbx_call_transcripts")');
  const insightRead = pbxBranch.indexOf('admin.from("pbx_ai_insights").select("*")');
  assert(guard > 0 && guard < transcriptRead && guard < insightRead, 'exact extension authorization must precede PBX cache reads');
  assert(pbxBranch.includes('transcript = null;'), 'user-provided transcript must not be persisted or analyzed');
  assert(pbxBranch.includes('organization_id = isServiceCall ? (organization_id || (pbxCall as any).organization_id) : (pbxCall as any).organization_id;'), 'user organization must come from the CDR');
  assert(!pbxBranch.includes('admin.from("organization_members")'), 'organization membership alone must not authorize PBX analysis');
});

Deno.test('mobile call history and detail use the CDR extension, not numbers belonging to other participants', async () => {
  const source = await Deno.readTextFile(new URL('../mobile-calls/index.ts', import.meta.url));
  assert(source.includes('.eq("id", id).eq("organization_id", sp.organization_id).eq("extension", ext)'), 'detail must authorize exact CDR extension before transcript read');
  assert(source.includes('.eq("organization_id", sp.organization_id)\n      .eq("extension", ext)'), 'history list must match detail scope');
  assert(!source.includes('caller_number.eq.${ext}') && !source.includes('source_number.eq.${ext}'), 'participant number is not CDR ownership');
  const mapCall = source.split('Deno.serve')[0];
  assert(!mapCall.includes('recording_url:') && !mapCall.includes('recording_path:'), 'do not expose server PBX pointers in call payloads');
});

Deno.test('mobile voicemail list exposes a CDR identifier but not PBX file metadata', async () => {
  const source = await Deno.readTextFile(new URL('../mobile-voicemails/index.ts', import.meta.url));
  assert(source.includes('.eq("extension", sp.extension)'), 'voicemail list must match server-owned extension');
  assert(source.includes('xml_cdr_uuid: r.pbx_uuid || r.id'), 'voicemail playback only needs CDR identity');
  assert(!source.includes('record_path:') && !source.includes('record_name:') && !source.includes('domain_name:'), 'voicemail must not return PBX file metadata');
});
