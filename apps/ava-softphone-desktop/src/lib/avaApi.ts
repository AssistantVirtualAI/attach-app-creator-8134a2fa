/**
 * AVA Desktop API Client.
 *
 * Backend: Supabase project gejxisrqtvxavbrfcoxz.supabase.co
 *   Auth      — Supabase Auth (JWT in Authorization header).
 *   Tables    — pbx_call_records, pbx_extensions, pbx_ai_insights,
 *               pbx_sms_threads, pbx_softphone_users.
 *   Functions — fusionpbx-proxy, ai-analyze-call, telnyx-sms,
 *               elevenlabs-generate-greeting, softphone-credentials.
 *
 * Set MOCK=false (and provide a Supabase session token via `setAuthToken`)
 * to route through the live backend. PBX/SIP/SMS secrets NEVER live in the
 * desktop app — they are held by the Edge Functions above.
 */
import { BACKEND, TABLES, FN, fnUrl } from './config';
import { isMockMode } from './buildGuard';
import { supabase as _supabase } from './supabaseClient';

/**
 * MOCK is true ONLY in dev builds with VITE_AVA_MOCK=true.
 * Production builds with that flag refuse to boot (see buildGuard.ts),
 * so this constant is always false in any shipped binary.
 */
export const MOCK: boolean = isMockMode();

/** Normalize any PostgREST/Edge response shape into an array (handles {data:[]}, {rows:[]}, null, single object). */
function asArray<T = any>(raw: any): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw == null) return [];
  if (Array.isArray(raw?.data)) return raw.data as T[];
  if (Array.isArray(raw?.rows)) return raw.rows as T[];
  if (Array.isArray(raw?.items)) return raw.items as T[];
  if (Array.isArray(raw?.result)) return raw.result as T[];
  if (typeof raw === 'object') return [raw as T];
  return [];
}

/** Trim/normalize a possibly-null text value; returns empty string if not usable. */
function cleanText(v: any): string {
  if (v == null) return '';
  const s = String(v).trim();
  return s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined' ? s : '';
}

function rangeStartIso(days?: 7 | 30 | null): string | null {
  if (!days) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** A CDR row counts as a voicemail when the PBX attached a voicemail message or marked it as such. */
function isVoicemailLike(r: any): boolean {
  if (!r) return false;
  const vm = r.voicemail_message;
  if (vm && vm !== 'false' && vm !== false) return true;
  if (r.call_status === 'voicemail') return true;
  if (r.has_voicemail === true) return true;
  return false;
}

/** Map a pbx_ai_insights row (or undefined) into the CallInsight UI shape. */
function mapInsightRow(callId: string, row: any): CallInsight {
  const r = row || {};
  return {
    callId,
    summary: cleanText(r.summary) || 'No AI summary available yet.',
    sentiment: cleanText(r.sentiment) || 'neutral',
    topics: Array.isArray(r.topics) ? r.topics : [],
    actionItems: Array.isArray(r.action_items) ? r.action_items : (Array.isArray(r.actionItems) ? r.actionItems : []),
    risks: Array.isArray(r.risks) ? r.risks : [],
    opportunities: Array.isArray(r.opportunities) ? r.opportunities : [],
    qualityScore: Number(r.quality_score ?? r.qualityScore ?? 0) || 0,
    ai_model: cleanText(r.ai_model) || null,
  } as any;
}


let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
  _meCache = null;
}

type MeContext = {
  organization_id: string | null;
  extension: string | null;
  display_name: string | null;
  user_id: string | null;
};
let _meCache: MeContext | null = null;
let _meInflight: Promise<MeContext> | null = null;

const EMPTY_ME: MeContext = { organization_id: null, extension: null, display_name: null, user_id: null };

export async function getMeContext(): Promise<MeContext> {
  if (_meCache) return _meCache;
  if (_meInflight) return _meInflight;
  _meInflight = (async () => {
    try {
      if (!authToken) return EMPTY_ME;
      // Decode current auth user id from JWT payload (no network round-trip).
      let uid: string | null = null;
      try {
        const payload = JSON.parse(atob(authToken.split('.')[1] || '')) as any;
        uid = payload?.sub ?? null;
      } catch {}
      const filter = uid ? `portal_user_id=eq.${uid}` : `limit=1`;
      const url = `${BACKEND.url}/rest/v1/pbx_softphone_users?select=organization_id,extension,display_name,portal_user_id&${filter}&limit=1`;
      const r = await fetch(url, { headers: authHeaders() });
      if (!r.ok) return EMPTY_ME;
      const rows = await r.json();
      let row = Array.isArray(rows) && rows[0] ? rows[0] : {};
      // Fallback: admin users may not have a softphone — resolve org via membership tables
      if (!row.organization_id && uid) {
        try {
          const memUrl = `${BACKEND.url}/rest/v1/organization_members?select=organization_id&user_id=eq.${uid}&limit=1`;
          const m = await fetch(memUrl, { headers: authHeaders() });
          if (m.ok) {
            const mrows = await m.json();
            if (Array.isArray(mrows) && mrows[0]?.organization_id) row = { ...row, organization_id: mrows[0].organization_id };
          }
        } catch { /* noop */ }
      }
      _meCache = {
        organization_id: row.organization_id ?? null,
        extension: row.extension ?? null,
        display_name: row.display_name ?? null,
        user_id: row.portal_user_id ?? uid,
      };
      return _meCache;
    } catch {
      return EMPTY_ME;
    } finally {
      _meInflight = null;
    }
  })();
  return _meInflight;
}


function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: BACKEND.anonKey,
  };
  if (authToken) h.Authorization = `Bearer ${authToken}`;
  return h;
}

/**
 * Path routing convention for live mode:
 *   `/fn/<function-name>`   → POST  ${BACKEND.url}/functions/v1/<name>
 *   `/db/<table>?<query>`   → GET   ${BACKEND.url}/rest/v1/<table>?<query>
 * Everything else is treated as a relative REST path under PostgREST.
 */
function resolveUrl(path: string): string {
  if (path.startsWith('/fn/')) {
    const [fnPath, qs] = path.slice(4).split('?');
    const base = fnUrl(fnPath);
    return qs ? `${base}?${qs}` : base;
  }
  if (path.startsWith('/db/')) return `${BACKEND.url}/rest/v1/${path.slice(4)}`;
  return `${BACKEND.url}${path}`;
}

async function call<T>(path: string, init: RequestInit = {}, mockData?: T): Promise<T> {
  if (MOCK && mockData !== undefined) {
    await new Promise((r) => setTimeout(r, 180));
    return mockData;
  }
  const res = await fetch(resolveUrl(path), {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`AVA ${path} ${res.status}`);
  return res.json() as Promise<T>;
}

/** Concrete backend wiring exposed for components that need it directly. */
export const BACKEND_WIRING = {
  url: BACKEND.url,
  tables: TABLES,
  functions: FN,
} as const;

/* ---------- Types ---------- */
export interface Me {
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  extension: string;
  role: 'end_user' | 'agent' | 'client_admin' | 'lemtel_admin' | 'ava_super_admin';
  permissions: string[];
}

export interface DashboardBrief {
  missed: number; answered: number; unreadSms: number;
  voicemail: number; aiActions: number;
  pbxHealth: 'ok' | 'degraded' | 'down';
  brief: string;
}

export interface CallRecord {
  id: string; direction: 'in' | 'out'; status: 'answered' | 'missed' | 'voicemail';
  from: string; to: string; startedAt: string; durationSec: number;
  hasRecording: boolean; hasTranscript: boolean;
  sentiment?: 'positive' | 'neutral' | 'negative';
  customer?: string;
  organization_id?: string; extension?: string | null; source_number?: string | null; extension_uuid?: string | null; transcript_text?: string;
  pbx_uuid?: string | null; domain_uuid?: string | null; domain_name?: string | null;
  recording_path?: string | null; recording_name?: string | null;
  record_path?: string | null; record_name?: string | null; recording_url?: string | null;
}

export interface CallInsight {
  callId: string; summary: string; sentiment: string; topics: string[];
  actionItems: string[]; risks: string[]; opportunities: string[]; qualityScore: number;
}

export interface SmsThread {
  id: string; contact: string; lastMessage: string; lastAt: string;
  unread: number; number: string;
}
export interface SmsMessage {
  id: string; threadId: string; from: 'me' | 'them'; body: string; at: string; status?: string;
}

export interface PbxActiveCall {
  uuid: string;
  direction?: string;
  caller?: string;
  destination?: string;
  created?: string;
  durationSec?: number;
  state?: string;
  raw?: Record<string, any>;
}
export interface PbxSystemStatus {
  ok: boolean;
  statusText?: string;
  sofiaText?: string;
  uptime?: string;
  registrations?: number;
  channels?: number;
  latency_ms?: number;
  raw?: Record<string, any>;
}

export interface Extension {
  id: string; extension: string; displayName: string;
  user?: string; voicemailEnabled: boolean; enabled: boolean;
}
export interface Device { id: string; vendor: string; mac: string; template: string; registered: boolean; assignedTo?: string; }
export interface PhoneNumber { id: string; number: string; assignedTo: string; type: 'extension' | 'ivr' | 'queue' | 'agent' | 'sms'; }
export interface Ivr { id: string; name: string; greeting: string; options: number; }
export interface CallQueue { id: string; name: string; strategy: string; agents: number; waiting: number; }
export interface RingGroup { id: string; name: string; members: number; strategy: string; }

export type Feedback = 'up' | 'down' | null;

export interface VoicemailItem {
  id: string; from: string; customer?: string; receivedAt: string;
  durationSec: number; isNew: boolean; transcript: string;
  summary: string; sentiment: 'positive' | 'neutral' | 'negative';
  priority: 'low' | 'normal' | 'high';
  handled?: boolean; feedback?: Feedback;
  organization_id?: string; extension?: string | null; source_number?: string | null; extension_uuid?: string | null; callId?: string;
  pbx_uuid?: string | null; domain_uuid?: string | null; domain_name?: string | null;
  recording_path?: string | null; recording_name?: string | null;
  record_path?: string | null; record_name?: string | null; recording_url?: string | null;
}
export interface RecordingItem {
  id: string; callId: string; from: string; to: string; customer?: string;
  recordedAt: string; durationSec: number; sizeKb: number;
  qualityScore: number; sentiment: 'positive' | 'neutral' | 'negative';
  summary: string | null; topics: string[]; tags: string[]; feedback?: Feedback;
  organization_id?: string; extension?: string | null; source_number?: string | null; extension_uuid?: string | null; transcript_text?: string | null;
  pbx_uuid?: string | null; domain_uuid?: string | null; domain_name?: string | null;
  recording_path?: string | null; recording_name?: string | null;
  record_path?: string | null; record_name?: string | null; recording_url?: string | null;
  recordingUrl?: string | null;
  raw_data?: any; analyzed?: boolean;
}
export interface ContactInteraction {
  id: string; kind: 'call' | 'sms' | 'voicemail';
  direction: 'in' | 'out'; at: string; preview: string; durationSec?: number;
}
export interface ContactItem {
  id: string; name: string; company?: string; phone: string; email?: string;
  lastInteraction: string; totalCalls: number; totalMessages: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  aiNote: string; notes?: string; tags: string[]; favorite: boolean;
  interactions?: ContactInteraction[];
}

/* ---------- Mock data ---------- */
const MOCK_ME: Me = {
  userId: 'u_1', email: 'demo@lemtel.tel', displayName: 'Demo User',
  organizationId: 'org_lemtel', organizationName: 'Lemtel Communications',
  extension: '301', role: 'client_admin',
  permissions: ['calls.read', 'messages.send', 'admin.extensions', 'admin.devices', 'admin.ivr', 'admin.queues', 'ai.use'],
};

const MOCK_CALLS: CallRecord[] = [
  { id: 'c1', direction: 'in', status: 'answered', from: '+15145550182', to: '301', startedAt: new Date(Date.now()-3600e3).toISOString(), durationSec: 245, hasRecording: true, hasTranscript: true, sentiment: 'positive', customer: 'Marie Tremblay' },
  { id: 'c2', direction: 'in', status: 'missed', from: '+14385550199', to: '301', startedAt: new Date(Date.now()-7200e3).toISOString(), durationSec: 0, hasRecording: false, hasTranscript: false, customer: 'Acme Corp' },
  { id: 'c3', direction: 'out', status: 'answered', from: '301', to: '+15145550141', startedAt: new Date(Date.now()-10800e3).toISOString(), durationSec: 612, hasRecording: true, hasTranscript: true, sentiment: 'neutral' },
  { id: 'c4', direction: 'in', status: 'voicemail', from: '+15145550101', to: '301', startedAt: new Date(Date.now()-14400e3).toISOString(), durationSec: 38, hasRecording: true, hasTranscript: true, sentiment: 'negative', customer: 'Unknown' },
];

const MOCK_THREADS: SmsThread[] = [
  { id: 't1', contact: 'Marie Tremblay', lastMessage: 'Perfect, I\'ll review the quote tonight.', lastAt: new Date(Date.now()-1800e3).toISOString(), unread: 0, number: '+15145550100' },
  { id: 't2', contact: 'Acme Corp', lastMessage: 'Can we reschedule to Thursday?', lastAt: new Date(Date.now()-3600e3).toISOString(), unread: 2, number: '+15145550100' },
  { id: 't3', contact: '+15145550141', lastMessage: 'Thanks for the call earlier.', lastAt: new Date(Date.now()-7200e3).toISOString(), unread: 1, number: '+15145550100' },
];
const MOCK_MESSAGES: Record<string, SmsMessage[]> = {
  t1: [
    { id: 'm1', threadId: 't1', from: 'them', body: 'Hi, did you get the updated quote?', at: new Date(Date.now()-3600e3).toISOString() },
    { id: 'm2', threadId: 't1', from: 'me', body: 'Yes, sending the revised version this afternoon.', at: new Date(Date.now()-3300e3).toISOString() },
    { id: 'm3', threadId: 't1', from: 'them', body: 'Perfect, I\'ll review the quote tonight.', at: new Date(Date.now()-1800e3).toISOString() },
  ],
  t2: [
    { id: 'm4', threadId: 't2', from: 'them', body: 'Can we reschedule to Thursday?', at: new Date(Date.now()-3800e3).toISOString() },
    { id: 'm5', threadId: 't2', from: 'them', body: 'Same time works for us.', at: new Date(Date.now()-3600e3).toISOString() },
  ],
  t3: [{ id: 'm6', threadId: 't3', from: 'them', body: 'Thanks for the call earlier.', at: new Date(Date.now()-7200e3).toISOString() }],
};

const MOCK_EXT: Extension[] = [
  { id: 'e1', extension: '301', displayName: 'Demo User', user: 'demo@lemtel.tel', voicemailEnabled: true, enabled: true },
  { id: 'e2', extension: '302', displayName: 'Reception', voicemailEnabled: true, enabled: true },
  { id: 'e3', extension: '303', displayName: 'Sales Queue', voicemailEnabled: false, enabled: true },
];
const MOCK_DEV: Device[] = [
  { id: 'd1', vendor: 'Yealink', mac: '00:15:65:AA:BB:01', template: 'T46U-default', registered: true, assignedTo: '301' },
  { id: 'd2', vendor: 'Polycom', mac: '00:04:F2:AB:CD:02', template: 'VVX-411', registered: false, assignedTo: '302' },
];
const MOCK_NUM: PhoneNumber[] = [
  { id: 'n1', number: '+15145550100', assignedTo: 'Main IVR', type: 'ivr' },
  { id: 'n2', number: '+15145550101', assignedTo: 'Sales Queue', type: 'queue' },
  { id: 'n3', number: '+15145550102', assignedTo: 'Ext 301', type: 'extension' },
];
const MOCK_IVR: Ivr[] = [
  { id: 'i1', name: 'Main IVR', greeting: 'Welcome to Lemtel Communications…', options: 4 },
  { id: 'i2', name: 'After Hours', greeting: 'Thank you for calling. Our offices are closed…', options: 2 },
];
const MOCK_QUEUES: CallQueue[] = [
  { id: 'q1', name: 'Sales', strategy: 'ring-all', agents: 3, waiting: 0 },
  { id: 'q2', name: 'Support', strategy: 'longest-idle', agents: 5, waiting: 1 },
];
const MOCK_RG: RingGroup[] = [
  { id: 'r1', name: 'Management', members: 3, strategy: 'simultaneous' },
];

const SAMPLE_VOICEMAIL_EMPTY: VoicemailItem[] = [
  { id: 'v1', from: '+15145550101', customer: 'Marie Tremblay', receivedAt: new Date(Date.now()-1800e3).toISOString(), durationSec: 42, isNew: true, transcript: 'Hi, this is Marie. Just calling to confirm our meeting on Thursday at 2pm. Please call me back to confirm. Thanks!', summary: 'Marie confirms Thursday 2pm meeting and asks for callback confirmation.', sentiment: 'positive', priority: 'high' },
  { id: 'v2', from: '+14385550199', customer: 'Acme Corp', receivedAt: new Date(Date.now()-7200e3).toISOString(), durationSec: 28, isNew: true, transcript: 'Hello, we need an update on the proposal. Can you call us back today?', summary: 'Acme Corp requesting proposal update, urgent callback today.', sentiment: 'neutral', priority: 'high' },
  { id: 'v3', from: '+15145550141', receivedAt: new Date(Date.now()-86400e3).toISOString(), durationSec: 15, isNew: false, transcript: 'Sorry, wrong number.', summary: 'Wrong number — no action needed.', sentiment: 'neutral', priority: 'low' },
  { id: 'v4', from: '+15145550182', customer: 'Jean-Luc Roy', receivedAt: new Date(Date.now()-172800e3).toISOString(), durationSec: 67, isNew: false, transcript: 'Bonjour, I was disappointed by the last support call. Please contact me to discuss.', summary: 'Customer complaint regarding recent support interaction.', sentiment: 'negative', priority: 'high' },
];

const SAMPLE_RECORDING_EMPTY: RecordingItem[] = [
  { id: 'rec1', callId: 'c1', from: '+15145550182', to: '301', customer: 'Marie Tremblay', recordedAt: new Date(Date.now()-3600e3).toISOString(), durationSec: 245, sizeKb: 980, qualityScore: 92, sentiment: 'positive', summary: 'Customer confirmed renewal pricing and requested quote by Friday.', topics: ['renewal', 'pricing', 'quote'], tags: ['sales', 'follow-up'] },
  { id: 'rec2', callId: 'c3', from: '301', to: '+15145550141', recordedAt: new Date(Date.now()-10800e3).toISOString(), durationSec: 612, sizeKb: 2450, qualityScore: 78, sentiment: 'neutral', summary: 'Discovery call covering technical requirements for integration.', topics: ['integration', 'API', 'requirements'], tags: ['discovery'] },
  { id: 'rec3', callId: 'c4', from: '+15145550101', to: '301', customer: 'Jean-Luc Roy', recordedAt: new Date(Date.now()-14400e3).toISOString(), durationSec: 38, sizeKb: 150, qualityScore: 41, sentiment: 'negative', summary: 'Customer expressed frustration about support response time.', topics: ['support', 'complaint'], tags: ['escalation'] },
  { id: 'rec4', callId: 'c5', from: '+14385550120', to: '302', customer: 'Sophie Beaulieu', recordedAt: new Date(Date.now()-432000e3).toISOString(), durationSec: 184, sizeKb: 730, qualityScore: 88, sentiment: 'positive', summary: 'Onboarding session completed successfully.', topics: ['onboarding', 'training'], tags: ['success'] },
];

const mkInteractions = (seed: number): ContactInteraction[] => [
  { id: `${seed}-i1`, kind: 'call', direction: 'in', at: new Date(Date.now()-3600e3).toISOString(), preview: 'Discussed renewal terms and timing.', durationSec: 245 },
  { id: `${seed}-i2`, kind: 'sms', direction: 'out', at: new Date(Date.now()-7200e3).toISOString(), preview: 'Sent updated quote PDF.' },
  { id: `${seed}-i3`, kind: 'voicemail', direction: 'in', at: new Date(Date.now()-86400e3).toISOString(), preview: 'Left a voicemail about Thursday meeting.', durationSec: 42 },
  { id: `${seed}-i4`, kind: 'call', direction: 'out', at: new Date(Date.now()-172800e3).toISOString(), preview: 'Follow-up call, no answer.', durationSec: 0 },
];

const MOCK_CONTACTS: ContactItem[] = [
  { id: 'k1', name: 'Marie Tremblay', company: 'Tremblay & Co', phone: '+15145550182', email: 'marie@tremblay.co', lastInteraction: new Date(Date.now()-3600e3).toISOString(), totalCalls: 14, totalMessages: 23, sentiment: 'positive', aiNote: 'High-value account, renewal due in 30 days. Prefers email follow-ups.', tags: ['vip', 'renewal'], favorite: true, interactions: mkInteractions(1) },
  { id: 'k2', name: 'Acme Corp', company: 'Acme Corp', phone: '+14385550199', email: 'ops@acme.com', lastInteraction: new Date(Date.now()-7200e3).toISOString(), totalCalls: 8, totalMessages: 11, sentiment: 'neutral', aiNote: 'Proposal pending. Decision maker is responsive between 9am-11am.', tags: ['prospect'], favorite: false, interactions: mkInteractions(2) },
  { id: 'k3', name: 'Jean-Luc Roy', phone: '+15145550101', lastInteraction: new Date(Date.now()-14400e3).toISOString(), totalCalls: 3, totalMessages: 2, sentiment: 'negative', aiNote: 'Recent complaint about support — recommend manager outreach.', tags: ['at-risk'], favorite: false, interactions: mkInteractions(3) },
  { id: 'k4', name: 'Sophie Beaulieu', company: 'Beaulieu Studio', phone: '+14385550120', email: 'sophie@beaulieu.studio', lastInteraction: new Date(Date.now()-432000e3).toISOString(), totalCalls: 6, totalMessages: 9, sentiment: 'positive', aiNote: 'Recently onboarded, opportunity to upsell premium plan in Q3.', tags: ['onboarded', 'upsell'], favorite: true, interactions: mkInteractions(4) },
];

/* ---------- API surface ----------
 * Live routes map to Supabase:
 *   /db/<table>?...        → PostgREST SELECT/PATCH on a table.
 *   /fn/<edge-function>    → Supabase Edge Function (POST JSON).
 * Mocks short-circuit when MOCK=true.
 */


/* ─── Mappeurs CDR FusionPBX → UI (champs réels Supabase) ─── */
function mapCdrToCall(r: any): CallRecord {
  const billsec = Number(r.billsec ?? r.duration_seconds ?? 0);
  const missed  = r.missed_call === true || r.call_status === 'missed' ||
                  r.hangup_cause === 'NO_ANSWER' || (billsec === 0 && r.direction !== 'outbound');
  const isVm    = r.voicemail_message && r.voicemail_message !== 'false';
  return {
    id:           r.id ?? r.pbx_uuid ?? String(Math.random()),
    direction:    (r.direction === 'outbound' ? 'out' : 'in') as 'in' | 'out',
    status:       (isVm ? 'voicemail' : missed ? 'missed' : 'answered') as any,
    from:         r.caller_number ?? r.source_number ?? '',
    to:           r.destination ?? r.destination_number ?? '',
    customer:     r.caller_name && r.caller_name !== r.caller_number ? r.caller_name : undefined,
    pbx_uuid:     r.pbx_uuid ?? null,
    domain_uuid:  r.domain_uuid ?? null,
    domain_name:  r.domain_name ?? null,
    startedAt:    r.start_at ?? r.start_stamp ?? r.created_at ?? r.received_at ?? new Date(0).toISOString(),
    durationSec:  billsec,
    hasRecording: !!(r.has_recording || r.recording_path || r.recording_name),
    hasTranscript: !!r.transcribed,
    extension:    r.extension ?? null,
    source_number: r.source_number ?? null,
    sentiment:    undefined,
  };
}

function mapCdrToVoicemail(r: any): VoicemailItem {
  const vm = r.voicemail_message && r.voicemail_message !== 'false' ? r.voicemail_message : null;
  return {
    id:          r.id ?? String(Math.random()),
    from:        r.caller_number ?? r.source_number ?? '',
    customer:    r.caller_name && r.caller_name !== r.caller_number ? r.caller_name : undefined,
    receivedAt:  r.start_at ?? new Date().toISOString(),
    durationSec: Number(r.billsec ?? r.duration_seconds ?? 0),
    isNew:       !r.voicemail_read,
    transcript:  vm ?? 'Transcription non disponible.',
    summary:     vm ? vm.slice(0, 120) + (vm.length > 120 ? '…' : '') : 'Aucun résumé disponible.',
    sentiment:   'neutral' as const,
    priority:    'normal' as const,
    organization_id: r.organization_id ?? undefined,
    extension: r.extension ?? null,
    source_number: r.source_number ?? null,
    extension_uuid: r.extension_uuid ?? null,
    callId:      r.id ?? undefined,
    pbx_uuid:    r.pbx_uuid ?? null,
    domain_uuid: r.domain_uuid ?? null,
    domain_name: r.domain_name ?? null,
    recording_path: r.recording_path ?? null,
    recording_name: r.recording_name ?? null,
    handled:     false,
    feedback:    null,
  };
}

function mapCdrToRecording(r: any): RecordingItem {
  // Audio is fetched on demand via the fusionpbx-proxy edge function
  // (keeps the PBX API key server-side). See getRecordingAudioUrl().
  const directUrl: string | null = null;
  const ai = r.raw_data?.ai || r.raw_data || {};
  const summary = (ai.summary || r.notes || '').toString().trim() || null;
  const topics = Array.isArray(ai.topics) ? ai.topics : [];
  const tags = Array.isArray(r.tags) ? r.tags : (Array.isArray(ai.tags) ? ai.tags : []);
  const sentiment = (ai.sentiment === 'positive' || ai.sentiment === 'negative' || ai.sentiment === 'neutral')
    ? ai.sentiment : 'neutral';

  return {
    id:          r.id ?? String(Math.random()),
    callId:      r.id ?? '',
    from:        r.caller_number ?? r.source_number ?? '',
    to:          r.destination ?? r.destination_number ?? '',
    customer:    r.caller_name && r.caller_name !== r.caller_number ? r.caller_name : undefined,
    recordedAt:  r.start_at ?? new Date().toISOString(),
    durationSec: Number(r.billsec ?? r.duration_seconds ?? 0),
    sizeKb:      0,
    qualityScore: Math.round((r.mos ?? 0) * 20),
    sentiment,
    summary,
    topics,
    tags,
    feedback:    null,
    organization_id: r.organization_id ?? undefined,
    extension: r.extension ?? null,
    extension_uuid: r.extension_uuid ?? null,
    pbx_uuid: r.pbx_uuid ?? null,
    domain_uuid: r.domain_uuid ?? null,
    domain_name: r.domain_name ?? null,
    recording_path: r.recording_path ?? null,
    recording_name: r.recording_name ?? null,
    recordingUrl: directUrl,
    transcript_text: r.raw_data?.transcript_text ?? null,
    raw_data: r.raw_data ?? null,
    analyzed: Boolean(ai.summary || r.transcribed),
  } as RecordingItem;
}



async function readCallRecordRows(limit = 100, opts?: { scope?: 'mine' | 'org'; extension?: string | null; rangeDays?: 7 | 30 | null }): Promise<any[]> {
  const me = await getMeContext();
  const orgFilter = me.organization_id ? `&organization_id=eq.${me.organization_id}` : '';
  const scopeOrg = opts?.scope === 'org';
  const scopedExtension = cleanText(opts?.extension || me.extension);
  const extFilter = opts?.extension
    ? `&or=(extension.eq.${encodeURIComponent(cleanText(opts.extension))},caller_number.eq.${encodeURIComponent(cleanText(opts.extension))},destination_number.eq.${encodeURIComponent(cleanText(opts.extension))},source_number.eq.${encodeURIComponent(cleanText(opts.extension))})`
    : scopeOrg
      ? ''
      : scopedExtension
      ? `&or=(extension.eq.${encodeURIComponent(scopedExtension)},caller_number.eq.${encodeURIComponent(scopedExtension)},destination_number.eq.${encodeURIComponent(scopedExtension)},source_number.eq.${encodeURIComponent(scopedExtension)})`
      : '&id=is.null';
  const rangeStart = rangeStartIso(opts?.rangeDays);
  const sinceFilter = rangeStart ? `&start_at=gte.${encodeURIComponent(rangeStart)}` : '';
  const url = `${BACKEND.url}/rest/v1/pbx_call_records?select=id,organization_id,extension,extension_uuid,pbx_uuid,domain_uuid,domain_name,caller_name,caller_number,destination,source_number,destination_number,start_at,duration_seconds,billsec,direction,call_status,missed_call,has_recording,recording_path,recording_name,hangup_cause,voicemail_message,transcribed,analyzed,mos,raw_data,notes,tags${orgFilter}${extFilter}${sinceFilter}&order=start_at.desc&limit=${limit}`;

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'apikey': BACKEND.anonKey,
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
  });
  if (!res.ok) { console.warn('[AVA] readCallRecordRows failed', res.status); return []; }
  return res.json();
}

/**
 * Invoke a fusionpbx-proxy action and return the JSON response.
 * Throws on non-2xx responses so callers can handle errors explicitly.
 */
async function invokeFusionSync(body: Record<string, unknown>): Promise<any> {
  // Use supabase.functions.invoke() so the Supabase JWT is always attached
  // automatically (even after token refresh). Using fetch() with authToken
  // was causing 401 Unauthorized when the token had not yet been initialized.
  const { data, error } = await _supabase.functions.invoke(FN.fusionpbxProxy, { body });
  if (error) {
    throw new Error(`fusionpbx-proxy ${String(body.action ?? '')} — ${error.message || String(error)}`);
  }
  return data;
}

let cdrSyncInFlight: Promise<void> | null = null;
let lastCdrSyncAt = 0;
// Auto-retry state for NO_CDR_ENDPOINT — when the PBX live-CDR endpoint is
// unreachable we keep showing cached rows but schedule a background retry
// with exponential backoff so the dialer recovers without manual refresh.
let cdrEndpointDownSince = 0;
let cdrRetryAttempt = 0;
let cdrRetryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCdrEndpointRetry(limit: number) {
  if (cdrRetryTimer) return;
  cdrRetryAttempt = Math.min(cdrRetryAttempt + 1, 8);
  const delay = Math.min(15_000 * 2 ** (cdrRetryAttempt - 1), 5 * 60_000); // 15s → 5m cap
  console.info('[AVA] CDR endpoint retry scheduled', { attempt: cdrRetryAttempt, delayMs: delay });
  cdrRetryTimer = setTimeout(() => {
    cdrRetryTimer = null;
    void bestEffortCdrSync(limit, 0, true).then(() => {
      if (cdrEndpointDownSince === 0) {
        console.info('[AVA] CDR endpoint recovered after retry');
        cdrRetryAttempt = 0;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lemtel:cdr-endpoint-recovered'));
        }
      }
    }).catch(() => { /* will reschedule via bestEffortCdrSync */ });
  }, delay);
}

async function bestEffortCdrSync(limit = 200, minIntervalMs = 30_000, force = false) {
  const now = Date.now();
  if (cdrSyncInFlight) {
    console.debug('[AVA] CDR sync coalesced — request already in flight');
    return cdrSyncInFlight;
  }
  if (!force && now - lastCdrSyncAt < minIntervalMs) return;
  lastCdrSyncAt = now;
  console.debug('[AVA] CDR sync start', { limit, force });
  cdrSyncInFlight = (async () => {
    try {
      const me = await getMeContext();
      await invokeFusionSync({
        action: 'sync-cdrs',
        organization_id: me.organization_id || undefined,
        limit,
        page_size: Math.max(limit, 250),
        max_pages: 2,
        from_beginning: true,
      });
      if (cdrEndpointDownSince) {
        console.info('[AVA] CDR endpoint back online', { downForMs: Date.now() - cdrEndpointDownSince });
        cdrEndpointDownSince = 0;
        cdrRetryAttempt = 0;
        if (cdrRetryTimer) { clearTimeout(cdrRetryTimer); cdrRetryTimer = null; }
      }
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      if (/NO_CDR_ENDPOINT/i.test(msg)) {
        if (!cdrEndpointDownSince) cdrEndpointDownSince = Date.now();
        console.warn('[AVA] CDR sync skipped — PBX endpoint unavailable; scheduling auto-retry', { attempt: cdrRetryAttempt + 1 });
        scheduleCdrEndpointRetry(limit);
        if (force) throw new Error('Reconnecting to PBX… realtime updates continue in the background.');
      } else {
        console.warn('[AVA] CDR sync failed', e);
        if (force) throw new Error('Reconnecting to PBX… realtime CDR stream is still active.');
      }
    } finally {
      cdrSyncInFlight = null;
      console.debug('[AVA] CDR sync done');
    }
  })();
  return cdrSyncInFlight;
}

async function bestEffortRecentTelephonySync(limit = 200, throwOnFailure = false) {
  try {
    const me = await getMeContext();
    const scope = {
      organization_id: me.organization_id || undefined,
      extension: me.extension || undefined,
    };
    const results = await Promise.allSettled([
      invokeFusionSync({ action: 'sync-cdrs', organization_id: scope.organization_id, limit, page_size: Math.max(limit, 250), max_pages: 2, from_beginning: true }),
      invokeFusionSync({ action: 'sync-voicemail-messages', ...scope, params: { extension: scope.extension, page_size: Math.max(limit, 200), max_pages: 1 } }),
      invokeFusionSync({ action: 'list-recordings', ...scope, limit, params: { extension: scope.extension, limit } }),
    ]);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (throwOnFailure && failed) throw failed.reason;
  } catch (e) {
    console.warn('[AVA] recent telephony sync failed', e);
    if (throwOnFailure) throw e;
  }
}

export const ava = {
  me: () => call<Me>(`/db/${TABLES.softphoneUsers}?select=*&limit=1`, {}, MOCK_ME),
  dashboard: () => call<DashboardBrief>(`/fn/${FN.aiAnalyzeCall}?view=dashboard`, { method: 'POST', body: JSON.stringify({ view: 'dashboard' }) }, {
    missed: 3, answered: 12, unreadSms: 5, voicemail: 2, aiActions: 4, pbxHealth: 'ok',
    brief: 'You have 3 missed calls and 2 unread voicemails requiring callbacks. One conversation flagged a renewal opportunity.',
  }),
  calls: async (limit = 100, opts?: { scope?: 'mine' | 'org'; extension?: string | null; rangeDays?: 7 | 30 | null }) => {
    if (MOCK) return MOCK_CALLS;
    await bestEffortCdrSync(Math.max(limit, 200));
    return (await readCallRecordRows(limit, opts)).map(mapCdrToCall);
  },
  refreshCalls: async (limit = 150, opts?: { scope?: 'mine' | 'org'; extension?: string | null; rangeDays?: 7 | 30 | null }) => {
    if (MOCK) return MOCK_CALLS;
    await bestEffortCdrSync(Math.max(limit, 250), 0, true);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('lemtel:phone-sync-complete'));
    return (await readCallRecordRows(limit, opts)).map(mapCdrToCall);
  },
  scopedCallRecords: async (limit = 100, opts?: { scope?: 'mine' | 'org'; extension?: string | null; rangeDays?: 7 | 30 | null }) => {
    if (MOCK) return MOCK_CALLS as any[];
    await bestEffortCdrSync(Math.max(limit, 200));
    return readCallRecordRows(limit, opts);
  },
  callDetail: (id: string) => call<any>(`/db/${TABLES.aiInsights}?call_record_id=eq.${id}&select=*&limit=1`, {}, {
    callId: id,
    summary: 'Customer asked about Q4 invoicing. Agent confirmed updated pricing and committed to sending a revised quote by Friday.',
    sentiment: 'positive', topics: ['invoicing', 'pricing', 'renewal'],
    actionItems: ['Send revised quote by Friday', 'Schedule follow-up call next week'],
    risks: [], opportunities: ['Annual renewal mentioned'],
    qualityScore: 87,
  }).then((raw: any) => MOCK ? raw as CallInsight : mapInsightRow(id, asArray(raw)[0])),
  startCall: (to: string) => call<{ callId: string }>(`/fn/${FN.fusionpbxProxy}`, { method: 'POST', body: JSON.stringify({ op: 'start_call', to }) }, { callId: 'mock' }),
  threads: async () => {
    if (MOCK) return MOCK_THREADS;
    const me = await getMeContext();
    const orgFilter = me.organization_id ? `&organization_id=eq.${me.organization_id}` : '';
    const raw = await call<any>(`/db/${TABLES.smsThreads}?select=*${orgFilter}&order=last_message_at.desc&limit=200`, {}, MOCK_THREADS);
    return asArray(raw).map((t: any) => ({
      id: t.id,
      contact: t.contact_name || t.contact_phone || '—',
      lastMessage: t.last_message_preview || '',
      lastAt: t.last_message_at || t.updated_at || new Date().toISOString(),
      unread: Number(t.unread_count ?? 0),
      number: t.did_number || t.contact_phone || '',
    })) as SmsThread[];
  },
  messages: async (threadId: string): Promise<SmsMessage[]> => {
    if (MOCK) return MOCK_MESSAGES[threadId] || [];
    const me = await getMeContext();
    const orgFilter = me.organization_id ? `&organization_id=eq.${me.organization_id}` : '';
    try {
      const raw = await call<any>(`/db/${TABLES.smsMessages}?select=*&thread_id=eq.${threadId}${orgFilter}&order=created_at.asc&limit=500`, {}, [] as any);
      return asArray(raw).map((m: any) => {
        const direction = cleanText(m.direction || m.message_direction || m.type).toLowerCase();
        const outbound = direction === 'outbound' || direction === 'out' || m.is_outbound === true || m.sender === 'me';
        return {
          id: String(m.id ?? `${threadId}-${Math.random()}`),
          threadId,
          from: outbound ? 'me' : 'them',
          body: cleanText(m.body ?? m.message ?? m.text ?? m.content),
          at: m.created_at ?? m.sent_at ?? m.received_at ?? m.updated_at ?? new Date().toISOString(),
          status: cleanText(m.status),
        } as SmsMessage;
      }).filter((m: SmsMessage) => m.body);
    } catch (err) {
      console.warn('[avaApi] messages failed:', err);
      return [];
    }
  },
  markThreadRead: async (threadId: string) => {
    if (!threadId) return { ok: true as const };
    if (MOCK) return { ok: true as const };
    try {
      await call<any>(`/db/${TABLES.smsThreads}?id=eq.${encodeURIComponent(threadId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ unread_count: 0 }),
      });
      await ava.audit('sms.thread_marked_read', 'pbx_sms_threads', threadId, { source: 'desktop' });
      return { ok: true as const };
    } catch (err) {
      console.warn('[avaApi] markThreadRead failed:', err);
      return { ok: false as const };
    }
  },
  sendMessage: (threadId: string, body: string) =>
    call<{ ok: true }>(`/fn/${FN.telnyxSms}`, { method: 'POST', body: JSON.stringify({ op: 'send', threadId, body }) }, { ok: true }),
  audit: (action: string, resourceType?: string, resourceId?: string, metadata?: Record<string, any>) =>
    call<{ ok: true }>(`/fn/${FN.fusionpbxProxy}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'desktop-audit', params: { action, resource_type: resourceType, resource_id: resourceId, metadata } }),
    }, { ok: true }).catch(() => ({ ok: true as const })),
  activeCalls: async (): Promise<PbxActiveCall[]> => {
    const data = await call<any>(`/fn/${FN.fusionpbxProxy}`, { method: 'POST', body: JSON.stringify({ action: 'list-active-calls' }) }, { ok: true, data: [] });
    return asArray(data?.data ?? data?.rows ?? data).map((r: any) => {
      const uuid = cleanText(r.uuid || r.call_uuid || r.channel_uuid || r['Unique-ID'] || r.variable_uuid || r.id);
      const createdEpoch = Number(r.created_epoch || r.created || r.created_time || 0);
      const created = createdEpoch > 1000000000 ? new Date(createdEpoch * 1000).toISOString() : cleanText(r.created_at || r.created_time);
      return {
        uuid: uuid || String(Math.random()),
        direction: cleanText(r.direction || r.call_direction || r.variable_direction),
        caller: cleanText(r.cid_num || r.caller_id_number || r.caller || r.from || r['Caller-Caller-ID-Number']),
        destination: cleanText(r.dest || r.destination_number || r.destination || r.to || r['Caller-Destination-Number']),
        created,
        durationSec: Number(r.duration || r.callstate_time || r.billsec || 0) || undefined,
        state: cleanText(r.callstate || r.state || r.channel_state || r.status),
        raw: r,
      };
    }).filter((x) => x.uuid);
  },
  killActiveCall: (uuid: string) =>
    call<any>(`/fn/${FN.fusionpbxProxy}`, { method: 'POST', body: JSON.stringify({ action: 'kill-active-call', params: { uuid }, uuid }) }),
  systemStatus: async (): Promise<PbxSystemStatus> => {
    const data = await call<any>(`/fn/${FN.fusionpbxProxy}`, { method: 'POST', body: JSON.stringify({ action: 'system-status' }) }, { ok: true });
    return {
      ok: data?.ok !== false && !data?.error,
      statusText: cleanText(data?.status_text || data?.status || data?.data?.status || data?.data?.status_text),
      sofiaText: cleanText(data?.sofia_text || data?.sofia || data?.data?.sofia || data?.data?.sofia_text),
      uptime: cleanText(data?.uptime || data?.data?.uptime),
      registrations: Number(data?.registrations ?? data?.data?.registrations ?? 0) || undefined,
      channels: Number(data?.channels ?? data?.data?.channels ?? 0) || undefined,
      latency_ms: Number(data?.latency_ms ?? data?.data?.latency_ms ?? 0) || undefined,
      raw: data,
    };
  },
  aiRewrite: (text: string, action: 'professional' | 'shorten' | 'translate' | 'rewrite') =>
    call<{ text: string }>(`/fn/${FN.aiAnalyzeCall}`, { method: 'POST', body: JSON.stringify({ op: 'rewrite', text, action }) }, {
      text: action === 'shorten' ? text.split('.')[0] + '.' :
            action === 'professional' ? `Hi,\n\n${text}\n\nBest regards,` :
            action === 'translate' ? `[FR] ${text}` :
            `${text} — refined by AVA.`,
    }),
  generateGreeting: (prompt: string) =>
    call<{ text: string; audioUrl?: string }>(`/fn/${FN.elevenlabsGreeting}`, { method: 'POST', body: JSON.stringify({ prompt }) }, {
      text: `Thank you for calling Lemtel Communications. ${prompt}. Please hold while we connect you to the right team.`,
    }),
  /* Admin */
  extensions: async () => {
    if (MOCK) return MOCK_EXT as Extension[];
    const me = await getMeContext();
    const orgFilter = me.organization_id ? `&organization_id=eq.${me.organization_id}` : '';
    const raw = await call<any>(`/db/telecom_extensions_v?select=id,extension,effective_cid_name,effective_cid_number,directory_first_name,directory_last_name,description,voicemail_enabled,enabled,do_not_disturb,portal_user_id,softphone_display_name,softphone_status,softphone_last_seen_at${orgFilter}&order=extension.asc&limit=500`, {}, []);
    return asArray(raw)
      .filter((e: any) => e.extension)
      .map((e: any) => {
        const directoryName = cleanText(`${cleanText(e.directory_first_name)} ${cleanText(e.directory_last_name)}`);
        return {
          id: e.id,
          extension: String(e.extension),
          displayName: cleanText(e.softphone_display_name) || cleanText(e.effective_cid_name) || directoryName || cleanText(e.description) || `Ext ${e.extension}`,
          user: cleanText(e.effective_cid_number) || undefined,
          voicemailEnabled: !!e.voicemail_enabled,
          enabled: e.enabled !== false,
          doNotDisturb: !!e.do_not_disturb,
          status: cleanText(e.softphone_status) || 'offline',
          lastSeenAt: e.softphone_last_seen_at ?? null,
          portalUserId: e.portal_user_id ?? null,
        } as Extension & Record<string, any>;
      });
  },
  devices: () => call<any>(`/db/pbx_devices?select=*&order=label.asc`, {}, MOCK_DEV)
    .then((raw: any) => MOCK ? raw as Device[] : asArray(raw).map((d: any) => ({ id: d.id, vendor: d.vendor || 'Device', mac: d.mac_address || '—', template: d.template || '—', registered: !!d.enabled, assignedTo: d.label || undefined }))),
  phoneNumbers: () => call<any>(`/db/pbx_phone_number_assignments?select=*&limit=100`, {}, MOCK_NUM)
    .then((raw: any) => MOCK ? raw as PhoneNumber[] : asArray(raw).map((n: any) => ({ id: n.id, number: n.phone_number || n.number || '—', assignedTo: n.extension || n.destination || '—', type: n.assignment_type || 'extension' }))),
  ivrs: () => call<any>(`/db/pbx_ivrs?select=*&order=name.asc`, {}, MOCK_IVR)
    .then((raw: any) => MOCK ? raw as Ivr[] : asArray(raw).map((i: any) => ({ id: i.id, name: i.name || 'IVR', greeting: i.greet_long || i.greet_short || '—', options: 0 }))),
  queues: () => call<any>(`/db/pbx_call_queues?select=*&order=name.asc`, {}, MOCK_QUEUES)
    .then((raw: any) => MOCK ? raw as CallQueue[] : asArray(raw).map((q: any) => ({ id: q.id, name: q.name || 'Queue', strategy: q.strategy || '—', agents: 0, waiting: 0 }))),
  ringGroups: () => call<any>(`/db/pbx_ring_groups?select=*&order=name.asc`, {}, MOCK_RG)
    .then((raw: any) => MOCK ? raw as RingGroup[] : asArray(raw).map((r: any) => ({ id: r.id, name: r.name || 'Ring Group', members: 0, strategy: r.strategy || '—' }))),
  /* Phase 3 */
  voicemails: async (limit = 50, opts?: { extension?: string | null }) => {
    if (MOCK) return SAMPLE_VOICEMAIL_EMPTY;
    await bestEffortCdrSync(Math.max(limit, 200));
    try {
      const rows = await readCallRecordRows(Math.max(limit, 200), opts);
      return rows.filter(isVoicemailLike).map(mapCdrToVoicemail).slice(0, limit);
    } catch (err) {
      console.warn('[avaApi] voicemail mapping failed:', err);
      return [] as VoicemailItem[];
    }
  },
  refreshVoicemails: async (limit = 50, opts?: { extension?: string | null }) => {
    if (MOCK) return SAMPLE_VOICEMAIL_EMPTY;
    await bestEffortRecentTelephonySync(Math.max(limit, 250), true);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('lemtel:phone-sync-complete'));
    const rows = await readCallRecordRows(Math.max(limit, 200), opts);
    return rows.filter(isVoicemailLike).map(mapCdrToVoicemail).slice(0, limit);
  },
  markVoicemailRead: (id: string) =>
    call<{ ok: true }>(`/fn/${FN.fusionpbxProxy}`, { method: 'POST', body: JSON.stringify({ action: 'voicemail-read', id }) }, { ok: true }).catch(() => ({ ok: true as const })),
  recordings: async (limit = 100, opts?: { scope?: 'mine' | 'org'; extension?: string | null; rangeDays?: 7 | 30 | null }) => {
    if (MOCK) return SAMPLE_RECORDING_EMPTY;
    await bestEffortCdrSync(Math.max(limit, 200));
    try {
      const me = await getMeContext();
      const orgFilter = me.organization_id ? `&organization_id=eq.${me.organization_id}` : '';
      const scopeOrg = opts?.scope === 'org';
      const scopedExtension = cleanText(opts?.extension || me.extension);
      const rangeStart = rangeStartIso(opts?.rangeDays);
      const sinceFilter = rangeStart ? `&start_at=gte.${encodeURIComponent(rangeStart)}` : '';
      const extFilter = opts?.extension
        ? `&or=(extension.eq.${encodeURIComponent(cleanText(opts.extension))},caller_number.eq.${encodeURIComponent(cleanText(opts.extension))},destination_number.eq.${encodeURIComponent(cleanText(opts.extension))},source_number.eq.${encodeURIComponent(cleanText(opts.extension))})`
        : scopeOrg
          ? ''
          : scopedExtension
          ? `&or=(extension.eq.${encodeURIComponent(scopedExtension)},caller_number.eq.${encodeURIComponent(scopedExtension)},destination_number.eq.${encodeURIComponent(scopedExtension)},source_number.eq.${encodeURIComponent(scopedExtension)})`
          : '&id=is.null';
      const url = `${BACKEND.url}/rest/v1/pbx_call_records?select=id,organization_id,extension,extension_uuid,pbx_uuid,domain_uuid,domain_name,caller_name,caller_number,destination,destination_number,source_number,start_at,billsec,duration_seconds,has_recording,recording_path,recording_name,mos,raw_data,transcribed&has_recording=eq.true${orgFilter}${extFilter}${sinceFilter}&order=start_at.desc&limit=${limit}`;
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          apikey: BACKEND.anonKey,
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });
      if (!res.ok) { console.warn('[AVA] recordings query failed', res.status); return [] as RecordingItem[]; }
      const rows = await res.json();
      return (Array.isArray(rows) ? rows : []).map(mapCdrToRecording);
    } catch (err) {
      console.warn('[avaApi] recording mapping failed:', err);
      return [] as RecordingItem[];
    }
  },
  refreshRecordings: async (limit = 100, opts?: { scope?: 'mine' | 'org'; extension?: string | null; rangeDays?: 7 | 30 | null }) => {
    if (MOCK) return SAMPLE_RECORDING_EMPTY;
    await bestEffortRecentTelephonySync(Math.max(limit, 250), true);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('lemtel:recordings-updated'));
    const rows = await readCallRecordRows(Math.max(limit, 300), opts);
    return rows
      .filter((r) => r.has_recording === true || r.recording_path || r.recording_name)
      .map(mapCdrToRecording)
      .slice(0, limit);
  },

  /**
   * Get a short-lived signed URL (default 5 min) for a recording / voicemail.
   * The audio bytes are pulled from FusionPBX by the edge function and
   * re-uploaded to private Supabase Storage; the player never sees raw
   * FusionPBX URLs or PHP endpoints. Every issuance is audited.
   */
  getRecordingSignedUrl: async (
    recording: Partial<RecordingItem & VoicemailItem & CallRecord & { record_path?: string | null; record_name?: string | null }>,
    expiresInSec = 300,
  ): Promise<{ url: string; expiresInSec: number; contentType: string } | null> => {
    const record_path = cleanText(recording.record_path ?? recording.recording_path);
    const record_name = cleanText(recording.record_name ?? recording.recording_name);
    const xml_cdr_uuid = cleanText(recording.pbx_uuid || (recording as any).callId || recording.id);
    const domain_uuid = cleanText(recording.domain_uuid);
    const domain_name = cleanText(recording.domain_name);
    const recorded_at = cleanText((recording as any).recordedAt ?? (recording as any).start_at ?? (recording as any).startedAt ?? (recording as any).receivedAt);
    const local_recording_url = cleanText(recording.recording_url ?? (recording as any).recordingUrl);
    if (!xml_cdr_uuid && !record_name && (!record_path || !record_name)) return null;
    try {
      const res = await fetch(resolveUrl(`/fn/${FN.fusionpbxProxy}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'get-recording-signed-url',
          organization_id: recording.organization_id,
          params: { xml_cdr_uuid, record_path, record_name, domain_uuid, domain_name, recorded_at, local_recording_url, expires_in: expiresInSec },
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.ok || !data?.url) return null;
      return { url: data.url, expiresInSec: data.expiresInSec, contentType: data.contentType };
    } catch (err) {
      console.warn('[avaApi] get-recording-signed-url failed:', err);
      return null;
    }
  },

  /**
   * Stream the recording bytes through the edge proxy and return a blob URL.
   * Kept for callers that need a guaranteed-local URL (e.g. download button).
   * Prefer `getRecordingSignedUrl` for `<audio>` playback.
   */
  getRecordingAudioUrl: async (recording: Partial<RecordingItem & VoicemailItem & CallRecord & { record_path?: string | null; record_name?: string | null }>) => {
    // SECURITY: never trust a raw `recording_url` value — that would bypass the
    // proxy and leak FusionPBX paths / credentials to the client. Always go
    // through the edge function.
    const record_path = cleanText(recording.record_path ?? recording.recording_path);
    const record_name = cleanText(recording.record_name ?? recording.recording_name);
    const xml_cdr_uuid = cleanText(recording.pbx_uuid || (recording as any).callId || recording.id);
    const domain_uuid = cleanText(recording.domain_uuid);
    const domain_name = cleanText(recording.domain_name);
    const recorded_at = cleanText((recording as any).recordedAt ?? (recording as any).start_at ?? (recording as any).startedAt ?? (recording as any).receivedAt);
    const local_recording_url = cleanText(recording.recording_url ?? (recording as any).recordingUrl);
    if (!xml_cdr_uuid && !record_name && (!record_path || !record_name)) return null;
    try {
      const res = await fetch(resolveUrl(`/fn/${FN.fusionpbxProxy}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'get-recording', organization_id: recording.organization_id, params: { xml_cdr_uuid, record_path, record_name, domain_uuid, domain_name, recorded_at, local_recording_url } }),
      });
      if (!res.ok) throw new Error(`Recording unavailable (${res.status})`);
      const ct = res.headers.get('content-type') || '';
      if (!ct.startsWith('audio/') && !ct.includes('octet-stream')) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg.slice(0, 180) || 'PBX did not return audio');
      }
      const buf = await res.arrayBuffer();
      if (!buf.byteLength) throw new Error('Empty recording');
      const lower = record_name.toLowerCase();
      const fallbackMime = lower.endsWith('.mp3') ? 'audio/mpeg'
        : lower.endsWith('.ogg') ? 'audio/ogg'
        : lower.endsWith('.m4a') ? 'audio/mp4'
        : 'audio/wav';
      const blob = new Blob([buf], { type: ct.split(';')[0].trim() || fallbackMime });
      return URL.createObjectURL(blob);
    } catch (err) {
      console.warn('[avaApi] get-recording failed:', err);
      return null;
    }
  },
  domains: async (): Promise<any[]> => {
    try {
      const res = await fetch(resolveUrl(`/fn/${FN.fusionpbxProxy}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'list-domains' }),
      });
      if (!res.ok) throw new Error(`list-domains failed (${res.status})`);
      const data = await res.json();
      return Array.isArray(data?.data) ? data.data : [];
    } catch (err) {
      console.warn('[avaApi] domains failed:', err);
      return [];
    }
  },
  contacts: async (): Promise<ContactItem[]> => {
    if (MOCK) return MOCK_CONTACTS;
    try {
      const rows = await readCallRecordRows(500);
      const me = await getMeContext();
      const myExt = me.extension || '';
      const byPhone = new Map<string, ContactItem>();
      for (const r of rows) {
        const inbound = r.direction !== 'outbound';
        const remoteRaw = inbound
          ? (r.caller_number ?? r.source_number ?? '')
          : (r.destination ?? r.destination_number ?? '');
        const remote = String(remoteRaw || '').trim();
        if (!remote || remote === myExt) continue;
        const name = (r.caller_name && r.caller_name !== r.caller_number) ? r.caller_name : remote;
        const at = r.start_at ?? new Date().toISOString();
        const existing = byPhone.get(remote);
        if (existing) {
          existing.totalCalls += 1;
          if (new Date(at) > new Date(existing.lastInteraction)) {
            existing.lastInteraction = at;
            if (name && name !== remote) existing.name = name;
          }
        } else {
          byPhone.set(remote, {
            id: `cdr-${remote}`,
            name,
            phone: remote,
            lastInteraction: at,
            totalCalls: 1,
            totalMessages: 0,
            sentiment: 'neutral',
            aiNote: 'Auto-derived from call history.',
            tags: [],
            favorite: false,
            interactions: [],
          });
        }
      }
      return Array.from(byPhone.values()).sort(
        (a, b) => +new Date(b.lastInteraction) - +new Date(a.lastInteraction),
      );
    } catch (err) {
      console.warn('[avaApi] contacts derivation failed:', err);
      return [];
    }
  },
  /* Phase 3.1 — AI feedback + lifecycle */
  regenerateSummary: (kind: 'voicemail' | 'recording', id: string, sourceText?: string) =>
    call<{ summary: string }>(`/fn/${FN.aiAnalyzeCall}`, { method: 'POST', body: JSON.stringify({ op: 'regenerate_summary', kind, id, sourceText }) }, {
      summary: sourceText
        ? `AVA v2 · ${sourceText.split(/[.!?]/)[0].trim()}. Key points refined and prioritized for action.`
        : `AVA regenerated this summary with the latest model and tone refinements.`,
    }),
  submitSummaryFeedback: (kind: 'voicemail' | 'recording', id: string, feedback: Feedback) =>
    call<{ ok: true }>(`/fn/${FN.aiAnalyzeCall}`, { method: 'POST', body: JSON.stringify({ op: 'summary_feedback', kind, id, feedback }) }, { ok: true }),
  setVoicemailPriority: (id: string, priority: VoicemailItem['priority']) =>
    call<{ ok: true }>(`/fn/${FN.fusionpbxProxy}`, { method: 'POST', body: JSON.stringify({ action: 'voicemail-priority', id, priority }) }, { ok: true }).catch(() => ({ ok: true as const })),
  markVoicemailHandled: (id: string, handled: boolean) =>
    call<{ ok: true }>(`/fn/${FN.fusionpbxProxy}`, { method: 'POST', body: JSON.stringify({ action: 'voicemail-handled', id, handled }) }, { ok: true }).catch(() => ({ ok: true as const })),
  exportRecordings: (ids: string[]) =>
    call<{ ok: true; count: number; url: string }>(`/fn/${FN.fusionpbxProxy}`, { method: 'POST', body: JSON.stringify({ action: 'export-recordings', ids }) }, {
      ok: true, count: ids.length, url: `https://ava.local/exports/recordings-${Date.now()}.zip`,
    }).catch(() => ({ ok: true as const, count: 0, url: 'PBX export unavailable' })),
  updateContact: (id: string, patch: Partial<Pick<ContactItem, 'notes' | 'tags' | 'favorite'>>) => {
    // Only persist if id looks like a real softphone-user UUID (derived/manual ids stay local).
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUuid) return Promise.resolve({ ok: true as const });
    return call<{ ok: true }>(`/db/${TABLES.softphoneUsers}?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } }, { ok: true });
  },
  syncStatus: () => call<{ lastSync: string; status: 'ok' | 'error'; jobs: { kind: string; finishedAt: string; ok: boolean }[] }>(`/fn/${FN.fusionpbxProxy}`, { method: 'POST', body: JSON.stringify({ action: 'sync-status' }) }, {
    lastSync: new Date(Date.now() - 600e3).toISOString(),
    status: 'ok',
    jobs: [
      { kind: 'extensions', finishedAt: new Date(Date.now()-600e3).toISOString(), ok: true },
      { kind: 'cdr', finishedAt: new Date(Date.now()-900e3).toISOString(), ok: true },
      { kind: 'devices', finishedAt: new Date(Date.now()-1800e3).toISOString(), ok: true },
    ],
  }),
  syncPhoneSystemFull: async () => {
    if (MOCK) return { ok: true, success: true, stats: { cdrs: MOCK_CALLS.length }, errors: [], syncedAt: new Date().toISOString() };
    try {
      const me = await getMeContext();
      const data = await call<any>(`/fn/${FN.fusionpbxProxy}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'sync-all', organization_id: me.organization_id || undefined, resources: ['cdrs', 'extensions', 'queues', 'ivrs', 'ring_groups'] }),
      });
      const recent = await Promise.allSettled([
        bestEffortCdrSync(500, 0, true),
        invokeFusionSync({ action: 'sync-voicemail-messages', organization_id: me.organization_id || undefined, extension: me.extension || undefined, params: { extension: me.extension || undefined, page_size: 500, max_pages: 1 } }),
        invokeFusionSync({ action: 'list-recordings', organization_id: me.organization_id || undefined, extension: me.extension || undefined, limit: 500, params: { extension: me.extension || undefined, limit: 500 } }),
      ]);
      const recentErrors = recent.filter((r) => r.status === 'rejected').map((r: any) => r.reason?.message || 'recent telephony refresh failed');
      const errors = [...(data?.errors || (data?.error ? [data.error] : [])), ...recentErrors];
      return { ok: data?.success !== false && !data?.error && recentErrors.length === 0, success: data?.success !== false && recentErrors.length === 0, stats: data?.stats || {}, errors, syncedAt: new Date().toISOString(), raw: data };
    } catch (err: any) {
      console.warn('[avaApi] sync-all failed:', err);
      return { ok: false, success: false, stats: {}, errors: [err?.message || 'Phone-system sync failed'], syncedAt: new Date().toISOString() };
    }
  },
  syncPhoneSystemRecent: async (limit = 200) => {
    if (MOCK) return { ok: true, success: true, stats: { cdrs: MOCK_CALLS.length }, errors: [], syncedAt: new Date().toISOString() };
    await bestEffortRecentTelephonySync(limit);
    return { ok: true, success: true, stats: {}, errors: [], syncedAt: new Date().toISOString() };
  },
};

/* ─── Initialisation du token depuis la session Supabase ───── */
import { supabase as _sb } from './supabaseClient';
(async () => {
  const { data: { session } } = await _sb.auth.getSession();
  if (session?.access_token) setAuthToken(session.access_token);
  _sb.auth.onAuthStateChange((_ev, s) => setAuthToken(s?.access_token ?? null));
})();

