import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { theme } from '../../lib/theme';
import { ava, RecordingItem, Feedback } from '../../lib/avaApi';
import { supabase } from '../../lib/supabaseClient';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useOrgId } from '../../lib/useOrgId';
import { toast } from '../../lib/toast';
import PageHeader, { EmptyState, ListSkeleton } from './PageHeader';

const LEMTEL_ORG = '71755d33-ed64-4ad5-a828-61c9d2029eb7';

function aiErr(e: any) {
  const t = String(e?.context?.error || e?.message || e?.details || e?.error || 'AI analysis failed');
  if (/MISSING_SECRET/i.test(t)) return 'AI is not configured yet — contact an admin.';
  if (/Unauthorized|Forbidden/i.test(t)) return 'You do not have permission to run AI here.';
  if (/required fields missing|No transcript/i.test(t)) return 'No transcript available yet — try playing the recording first or retry.';
  return t;
}

const { colors: c } = theme;

type Quality = 'all' | 'high' | 'medium' | 'low';
type Sent = 'all' | 'positive' | 'neutral' | 'negative';
type Sort = 'recent' | 'oldest' | 'longest' | 'quality_desc' | 'quality_asc';
type Range = 'all' | '24h' | '7d' | '30d' | '90d';

function isRecordingRealtimeChange(payload: unknown) {
  const p = payload as { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> };
  const next = p.new || {};
  const prev = p.old || {};
  if (p.eventType === 'INSERT') return next.has_recording === true || Boolean(next.recording_path || next.recording_name);
  if (p.eventType !== 'UPDATE') return false;
  const hasComparableOldRow = Object.prototype.hasOwnProperty.call(prev, 'has_recording')
    || Object.prototype.hasOwnProperty.call(prev, 'recording_path')
    || Object.prototype.hasOwnProperty.call(prev, 'recording_name');
  if (!hasComparableOldRow) return false;
  return next.has_recording === true && (
    prev.has_recording !== true ||
    next.recording_path !== prev.recording_path ||
    next.recording_name !== prev.recording_name
  );
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDur(s?: number | null) {
  s = Number(s || 0);
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
function fmtSize(kb?: number | null) {
  kb = Number(kb || 0);
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}
// Module-level blob cache so re-selecting a recording is instant and prefetched audio survives renders.
const audioBlobCache = new Map<string, string>();
const audioInFlight = new Map<string, Promise<string | null>>();

function rangeCutoff(r: Range): number {
  const ms = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5, '90d': 90 * 864e5 } as const;
  return r === 'all' ? 0 : Date.now() - (ms as any)[r];
}

export default function RecordingsView({ scope = 'mine' }: { scope?: 'mine' | 'org' } = {}) {
  const [items, setItems] = useState<RecordingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState<Quality>('all');
  const [s, setS] = useState<Sent>('all');
  const [range, setRange] = useState<Range>('7d');
  const [sort, setSort] = useState<Sort>('recent');
  const [search, setSearch] = useState('');
  const [extensionQuery, setExtensionQuery] = useState('');
  const [sel, setSel] = useState<RecordingItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [analysis, setAnalysis] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiStage, setAiStage] = useState<'idle' | 'fetching' | 'transcribing' | 'analyzing' | 'done' | 'error'>('idle');

  const load = useCallback(async (opts?: { silent?: boolean; force?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    if (opts?.force) setRefreshing(true);
    setError(null);
    try {
      const rangeDays: 7 | 30 | null = range === '7d' ? 7 : range === '30d' ? 30 : null;
      const apiOpts: { scope: 'mine' | 'org'; extension: string | null; rangeDays: 7 | 30 | null } = { scope, extension: scope === 'org' ? (extensionQuery.trim() || null) : null, rangeDays };
      const d = opts?.force ? await ava.refreshRecordings(500, apiOpts) : await ava.recordings(500, apiOpts);
      setItems(Array.isArray(d) ? d : []);
    } catch (err: any) {
      if (!opts?.silent || opts?.force) setItems([]);
      setError(err?.message || 'Unable to load recordings from the phone system.');
    } finally {
      if (!opts?.silent) setLoading(false);
      if (opts?.force) setRefreshing(false);
    }
  }, [scope, extensionQuery, range]);

  const silentLoad = useCallback(() => { void load({ silent: true }); }, [load]);

  useEffect(() => { load(); }, [load]);

  // Realtime: new recordings trigger a silent refetch (no list flicker / no audio reset).
  const orgId = useOrgId();
  useRealtimeRefresh({ table: 'pbx_call_records', organizationId: orgId, events: ['INSERT', 'UPDATE'], throttleMs: 30_000, shouldRefresh: isRecordingRealtimeChange }, silentLoad);


  // Helper: fetch (or reuse cached) signed audio URL for a recording, deduping concurrent calls.
  const fetchAudio = useCallback(async (rec: RecordingItem): Promise<string | null> => {
    const cached = audioBlobCache.get(rec.id);
    if (cached) return cached;
    const pending = audioInFlight.get(rec.id);
    if (pending) return pending;
    const p = (async () => {
      // Prefer short-lived signed URL (no client-side blob download); fallback to proxy stream.
      const signed = await ava.getRecordingSignedUrl(rec as any);
      const url = signed?.url || (await ava.getRecordingAudioUrl(rec as any));
      if (url) audioBlobCache.set(rec.id, url);
      return url;
    })().finally(() => audioInFlight.delete(rec.id));
    audioInFlight.set(rec.id, p);
    return p;
  }, []);

  // When selection changes: show cached URL immediately, otherwise fetch silently in background.
  useEffect(() => {
    setPlaybackError(null);
    setAudioUrl(null);
    setTranscript(String((sel as any)?.transcript_text || (sel as any)?.raw_data?.transcript_text || ''));
    setAnalysis((sel as any)?.raw_data?.ai || null);
    setAiError(null);
    if (!sel) return;
    const cached = audioBlobCache.get(sel.id);
    if (cached) { setAudioUrl(cached); return; }
    let cancelled = false;
    setPlaybackLoading(true);
    fetchAudio(sel)
      .then((u) => { if (!cancelled && u) setAudioUrl(u); })
      .finally(() => { if (!cancelled) setPlaybackLoading(false); });
    return () => { cancelled = true; };
  }, [sel?.id, fetchAudio]);

  // No background prefetch: signed URLs are cheap on demand and each issuance is audited.


  const filtered = useMemo(() => {
    const cutoff = rangeCutoff(range);
    const list = items.filter((r) => {
      if (q === 'high' && r.qualityScore < 80) return false;
      if (q === 'medium' && (r.qualityScore < 50 || r.qualityScore >= 80)) return false;
      if (q === 'low' && r.qualityScore >= 50) return false;
      if (s !== 'all' && r.sentiment !== s) return false;
      if (cutoff && new Date(r.recordedAt).getTime() < cutoff) return false;
      if (search) {
        const t = search.toLowerCase();
        const hay = `${r.customer || ''} ${r.from || ''} ${r.to || ''} ${(r as any).extension || ''} ${(r as any).source_number || ''} ${r.summary || ''} ${(r.topics || []).join(' ')} ${(r.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      switch (sort) {
        case 'oldest': return +new Date(a.recordedAt) - +new Date(b.recordedAt);
        case 'longest': return (b.durationSec || 0) - (a.durationSec || 0);
        case 'quality_desc': return (b.qualityScore || 0) - (a.qualityScore || 0);
        case 'quality_asc': return (a.qualityScore || 0) - (b.qualityScore || 0);
        default: return +new Date(b.recordedAt) - +new Date(a.recordedAt);
      }
    });
    return list;
  }, [items, q, s, range, sort, search]);

  const qualityColor = (score: number) =>
    score >= 80 ? c.success : score >= 50 ? c.warning : c.danger;
  const sentColor = (x: RecordingItem['sentiment']) =>
    x === 'positive' ? c.success : x === 'negative' ? c.danger : c.mutedSilver;

  const updateItem = (id: string, patch: Partial<RecordingItem>) => {
    setItems((all) => all.map((x) => x.id === id ? { ...x, ...patch } : x));
    if (sel?.id === id) setSel({ ...sel, ...patch });
  };

  const toggleSel = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    const allIds = filtered.map((r) => r.id);
    const allSelected = allIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };
  const downloadSelectedRecording = async () => {
    if (!sel) return;
    setPlaybackError(null); setPlaybackLoading(true);
    try {
      const url = await fetchAudio(sel);
      if (!url) { setPlaybackError('Recording file not available from PBX yet'); return; }
      const a = document.createElement('a');
      const safeName = `${(sel.recording_name || sel.callId || sel.id || 'recording').replace(/[^a-z0-9._-]+/gi, '_')}.wav`;
      a.href = url;
      a.download = safeName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally { setPlaybackLoading(false); }
  };

  const shareSelectedRecording = async () => {
    if (!sel) return;
    setPlaybackError(null);
    const meta = `${sel.customer || `${sel.from || 'Unknown'} → ${sel.to || 'Unknown'}`} · ${fmtDate(sel.recordedAt)} · ${fmtDur(sel.durationSec)}`;
    try {
      if (navigator.share) await navigator.share({ title: 'AVA recording', text: meta });
      else { await navigator.clipboard?.writeText(meta); setPlaybackError('Recording details copied. Audio sharing uses the secure AVA portal link only.'); }
    } catch { /* user cancelled or clipboard unavailable */ }
  };

  const exportSelected = async () => {
    if (selectedIds.size === 0) return;
    setExporting(true); setExportNote(null);
    try {
      const res = await ava.exportRecordings(Array.from(selectedIds));
      setExportNote(`Exported ${res.count} recording${res.count === 1 ? '' : 's'} · ${res.url}`);
    } catch {
      setExportNote('Export is unavailable until PBX audio files are downloadable.');
    } finally { setExporting(false); }
  };

  const playSelected = async () => {
    if (!sel) return;
    setPlaybackError(null); setPlaybackLoading(true);
    try {
      const url = await fetchAudio(sel);
      if (!url) { setPlaybackError('Recording file not available from PBX yet'); return; }
      setAudioUrl(url);
    } finally {
      setPlaybackLoading(false);
    }
  };

  const runTranscribeAnalyze = async () => {
    if (!sel) return;
    setAiLoading(true); setAiError(null); setAiStage('fetching');
    try {
      const organization_id = (sel as any).organization_id || LEMTEL_ORG;
      const callId = (sel as any).callId || sel.id;
      let txt = transcript;
      if (!txt) {
        setAiStage('transcribing');
        const r1 = await supabase.functions.invoke('ai-transcribe-call', {
          body: { callId, call_record_id: callId, organization_id,
                  recording_path: (sel as any).recording_path, recording_name: (sel as any).recording_name },
        });
      if (r1.error) throw r1.error;
      if ((r1.data as any)?.stub || (r1.data as any)?.error) {
        throw new Error([((r1.data as any)?.error || (r1.data as any)?.reason || 'transcription unavailable'), ...(((r1.data as any)?.fetchErrors || []) as string[])].filter(Boolean).join(' · '));
      }
        txt = String((r1.data as any)?.transcript_text || '').trim();
        if (txt) setTranscript(txt);
      }
      if (!txt) throw new Error('No transcript available for AI analysis yet');
      setAiStage('analyzing');
      const r2 = await supabase.functions.invoke('ai-analyze-call', {
        body: { callId, call_record_id: callId, organization_id, transcript_text: txt,
                recording_path: (sel as any).recording_path, recording_name: (sel as any).recording_name },
      });
      if (r2.error) throw r2.error;
      const ai = (r2.data as any)?.analysis || (r2.data as any) || null;
      setAnalysis(ai);
      if (ai?.summary) updateItem(sel.id, { summary: ai.summary, topics: ai.topics || sel.topics, sentiment: ai.sentiment || sel.sentiment });
      setAiStage('done');
      toast.success((r2.data as any)?.cached ? 'AI analysis: déjà traité — cache réutilisé' : 'Transcrit, scoré et analysé');
    } catch (e: any) {
      const msg = aiErr(e);
      setAiError(msg);
      toast.error(`Transcription/scoring failed — ${msg}`);
      setAiStage('error');
    } finally {
      setAiLoading(false);
    }
  };

  const regen = async () => {
    if (!sel) return;
    setRegenLoading(true);
    try {
      const { summary } = await ava.regenerateSummary('recording', sel.id, sel.summary || '');
      updateItem(sel.id, { summary, feedback: null });
    } finally { setRegenLoading(false); }
  };
  const feedback = (f: Feedback) => {
    if (!sel) return;
    const next: Feedback = sel.feedback === f ? null : f;
    ava.submitSummaryFeedback('recording', sel.id, next);
    updateItem(sel.id, { feedback: next });
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0, padding: '24px 28px', overflowY: 'auto' }}>
        <PageHeader
          eyebrow="Archive"
          title="Recordings"
          subtitle="Searchable archive with AVA quality, sentiment, date range, and bulk export."
          accent={c.avaCyan}
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>}
          right={<button onClick={() => load({ silent: true, force: true })} disabled={refreshing} style={{ ...chip(false), opacity: refreshing ? 0.55 : 1 }}>{refreshing ? 'SYNCING…' : 'SYNC NOW'}</button>}
        />

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search recordings, customers, extension, topics…"
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 10,
            background: c.bgCard, border: `1px solid ${c.border}`,
            color: c.textIce, fontSize: 13, marginBottom: 10, outline: 'none',
          }}
        />

        {scope === 'org' && (
          <input
            value={extensionQuery}
            onChange={(e) => setExtensionQuery(e.target.value.replace(/[^0-9*]/g, ''))}
            placeholder="Filter by extension #"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 10,
              background: c.bgCard, border: `1px solid ${c.border}`,
              color: c.textIce, fontSize: 13, marginBottom: 10, outline: 'none', fontFamily: 'JetBrains Mono, monospace',
            }}
          />
        )}

        <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
          <FilterGroup label="Quality" value={q} onChange={(v) => setQ(v as Quality)} options={['all', 'high', 'medium', 'low']} />
          <FilterGroup label="Sentiment" value={s} onChange={(v) => setS(v as Sent)} options={['all', 'positive', 'neutral', 'negative']} />
          <FilterGroup label="Range" value={range} onChange={(v) => setRange(v as Range)} options={['all', '24h', '7d', '30d', '90d']} />
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: c.mutedSilver, textTransform: 'uppercase', marginBottom: 5 }}>Sort</div>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{
              padding: '5px 8px', borderRadius: 8, background: c.bgCard,
              border: `1px solid ${c.border}`, color: c.textIce, fontSize: 11, fontWeight: 600,
            }}>
              <option value="recent">Most recent</option>
              <option value="oldest">Oldest first</option>
              <option value="longest">Longest first</option>
              <option value="quality_desc">Quality ↓</option>
              <option value="quality_asc">Quality ↑</option>
            </select>
          </div>
        </div>

        {/* Bulk bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', marginBottom: 10, borderRadius: 10,
          background: selectedIds.size ? 'rgba(255,230,0,0.07)' : c.bgCard,
          border: `1px solid ${selectedIds.size ? c.borderGold : c.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={toggleAll} style={miniBtn}>
              {filtered.length && filtered.every((r) => selectedIds.has(r.id)) ? 'Clear' : 'Select all'}
            </button>
            <span style={{ fontSize: 11, color: c.mutedSilver }}>
              {selectedIds.size} selected · {filtered.length} shown
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {exportNote && <span style={{ fontSize: 10, color: c.success }}>{exportNote}</span>}
            <button onClick={exportSelected} disabled={!selectedIds.size || exporting} style={{
              ...miniBtn, background: selectedIds.size ? c.signalGold : 'transparent',
              color: selectedIds.size ? c.midnight : c.mutedSilver, fontWeight: 700,
              borderColor: selectedIds.size ? c.signalGold : c.border, opacity: exporting ? 0.6 : 1,
            }}>{exporting ? 'Exporting…' : '⬇ Export ZIP'}</button>
          </div>
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading && <ListSkeleton rows={7} />}
        {!loading && <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {filtered.map((r) => (
            <div key={r.id} onClick={() => setSel(r)} style={{
              display: 'grid', gridTemplateColumns: '22px 1fr 60px 80px 80px 70px',
              alignItems: 'center', gap: 12, width: '100%',
              padding: '12px 14px',
              background: sel?.id === r.id ? 'rgba(35,214,255,0.06)' : 'transparent',
              borderBottom: `1px solid ${c.border}`, color: c.textIce, cursor: 'pointer',
            }}>
              <input
                type="checkbox" checked={selectedIds.has(r.id)}
                onChange={() => {}} onClick={(e) => toggleSel(r.id, e)}
                style={{ accentColor: c.signalGold, cursor: 'pointer' }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.customer || `${r.from || 'Unknown'} → ${r.to || 'Unknown'}`}
                </span>
                <span style={{ fontSize: 10.5, color: c.mutedSilver, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.summary || 'No AI summary yet — open to transcribe.'}
                </span>
              </span>
              <span style={{ fontSize: 11, color: qualityColor(r.qualityScore || 0), fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{r.qualityScore || 0}</span>
              <span style={{ fontSize: 11, color: c.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>{fmtDur(r.durationSec)}</span>
              <span style={{ fontSize: 11, color: c.mutedSilver }}>{fmtDate(r.recordedAt)}</span>
              <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <span style={dot(sentColor(r.sentiment || 'neutral'))}>●</span>
              </span>
            </div>
          ))}
          {filtered.length === 0 && (
            <EmptyState
              icon="◉"
              title="No recordings yet"
              hint="Recordings will appear here automatically. Adjust filters or clear search to widen results."
              accent={c.avaCyan}
              cta={{ label: 'Clear filters', onClick: () => { setQ('all'); setS('all'); setRange('all'); setSearch(''); } }}
            />
          )}
        </div>}
      </div>

      <aside style={{ width: 380, flexShrink: 0, borderLeft: `1px solid ${c.border}`, background: c.deepPanel, padding: '24px 22px', overflowY: 'auto' }}>
        {!sel && (
          <EmptyState
            icon="◉"
            title="Pick a recording"
            hint="Select a recording to view waveform, AVA summary, and topics."
            accent={c.avaCyan}
          />
        )}
        {sel && (
          <>
            <div style={{ fontSize: 11, color: c.signalGold, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Recording</div>
            <h2 style={{ fontSize: 18, color: c.textIce, margin: '0 0 4px' }}>{sel.customer || `${sel.from || 'Unknown'} → ${sel.to || 'Unknown'}`}</h2>
            <div style={{ fontSize: 11, color: c.mutedSilver, marginBottom: 18 }}>
              {fmtDate(sel.recordedAt)} · {fmtDur(sel.durationSec)} · {fmtSize(sel.sizeKb)}
            </div>

            <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
              {audioUrl ? (
                <audio
                  controls
                  preload="auto"
                  src={audioUrl}
                  style={{ width: '100%', height: 36 }}
                  onEnded={() => {
                    // Auto-trigger AI when listening completes — the analyze
                    // endpoint is idempotent so cached transcripts/insights
                    // return without re-burning tokens.
                    if (!aiLoading && aiStage !== 'done') {
                      try { runTranscribeAnalyze(); } catch { /* surfaces in aiStage */ }
                    }
                  }}
                  onError={() => {
                    setPlaybackError('PBX recording file is not reachable yet. Sync the phone system and try again.');
                    if (sel) { const u = audioBlobCache.get(sel.id); if (u) { URL.revokeObjectURL(u); audioBlobCache.delete(sel.id); } }
                    setAudioUrl(null);
                  }}
                />
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 36 }}>
                    {Array.from({ length: 60 }).map((_, i) => (
                      <span key={i} style={{
                        flex: 1, height: `${15 + Math.abs(Math.sin(i * 0.5)) * 80}%`,
                        background: c.signalGold, opacity: 0.6, borderRadius: 1,
                      }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: c.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>
                    <span>0:00</span><button onClick={playSelected} disabled={playbackLoading} style={{ ...miniBtn, padding: '2px 8px' }}>{playbackLoading ? 'Loading…' : '▶ Play'}</button><span>{fmtDur(sel.durationSec)}</span>
                  </div>
                </>
              )}
              {playbackError && <div style={{ fontSize: 11, color: c.mutedSilver, marginTop: 8 }}>{playbackError}</div>}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button onClick={runTranscribeAnalyze} disabled={aiLoading} style={{ ...miniBtn, flex: 1, padding: '8px 10px', background: aiLoading ? 'transparent' : 'rgba(35,214,255,0.10)', color: c.avaCyan, borderColor: `${c.avaCyan}55`, fontWeight: 700 }}>
                {aiLoading
                  ? (aiStage === 'fetching' ? '⏳ Preparing audio…'
                    : aiStage === 'transcribing' ? '🎙 Transcribing with AI…'
                    : aiStage === 'analyzing' ? '🧠 Analyzing call…'
                    : 'Running AI…')
                  : aiStage === 'done' ? '✓ Done — re-run'
                  : (transcript ? '↻ Re-analyze' : '✨ Transcribe & Analyze')}
              </button>
            </div>
            <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, background: analysis ? 'rgba(16,185,129,0.08)' : aiLoading ? 'rgba(35,214,255,0.08)' : c.overlay04, border: `1px solid ${analysis ? c.success + '55' : c.border}`, color: analysis ? c.success : c.mutedSilver, fontSize: 11, fontWeight: 700 }}>
              {aiLoading ? 'AI analysis: en cours' : analysis ? 'AI analysis: déjà traité — cache réutilisé' : 'AI analysis: non traité'}
            </div>
            {aiLoading && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: c.mutedSilver, marginBottom: 4 }}>
                  <span style={{ color: aiStage === 'fetching' ? c.avaCyan : c.mutedSilver }}>1. Fetch audio</span>
                  <span style={{ color: aiStage === 'transcribing' ? c.avaCyan : c.mutedSilver }}>2. Transcribe</span>
                  <span style={{ color: aiStage === 'analyzing' ? c.avaCyan : c.mutedSilver }}>3. Analyze</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: c.overlay06, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: aiStage === 'fetching' ? '20%' : aiStage === 'transcribing' ? '60%' : aiStage === 'analyzing' ? '90%' : '100%',
                    background: `linear-gradient(90deg, ${c.avaCyan}, ${c.avaViolet})`,
                    transition: 'width 300ms ease',
                  }} />
                </div>
              </div>
            )}
            {!aiLoading && aiStage === 'done' && (
              <div style={{ marginBottom: 12, fontSize: 11, color: c.signalGold }}>
                ✓ Transcription and analysis complete
              </div>
            )}
            {aiError && (
              <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.10)', border: `1px solid ${c.danger}55`, color: c.textIce, fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <span>{aiError}</span>
                <button onClick={runTranscribeAnalyze} style={{ ...miniBtn, color: c.danger, borderColor: `${c.danger}66` }}>↻ Retry</button>
              </div>
            )}
            {transcript && (
              <Panel title="Transcript" accent={c.avaCyan}>
                <p style={{ fontSize: 12, lineHeight: 1.55, color: c.textIce, margin: 0, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>{transcript}</p>
              </Panel>
            )}
            {analysis && (
              <Panel title="AI Analysis" accent={c.avaViolet}>
                <div style={{ fontSize: 12, color: c.textIce, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {analysis.sentiment && <div><span style={{ color: c.mutedSilver }}>Sentiment:</span> {analysis.sentiment}</div>}
                  {analysis.quality_score != null && <div><span style={{ color: c.mutedSilver }}>Score:</span> {analysis.quality_score}/10</div>}
                  {analysis.coaching_score != null && <div><span style={{ color: c.mutedSilver }}>Coaching:</span> {analysis.coaching_score}/5</div>}
                  {analysis.summary && <div>{analysis.summary}</div>}
                  {Array.isArray(analysis.coaching_notes) && analysis.coaching_notes.length > 0 && (
                    <ul style={{ margin: '4px 0 0 14px', padding: 0 }}>
                      {analysis.coaching_notes.map((n: string, i: number) => <li key={i} style={{ fontSize: 11.5 }}>{n}</li>)}
                    </ul>
                  )}
                  {Array.isArray(analysis.action_items) && analysis.action_items.length > 0 && (
                    <ul style={{ margin: '4px 0 0 14px', padding: 0 }}>
                      {analysis.action_items.map((a: string, i: number) => <li key={i} style={{ fontSize: 11.5 }}>{a}</li>)}
                    </ul>
                  )}
                </div>
              </Panel>
            )}

            <Panel title="Quality Score" accent={c.signalGold}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: qualityColor(sel.qualityScore || 0), fontFamily: 'JetBrains Mono, monospace' }}>{sel.qualityScore || 0}</span>
                <span style={{ fontSize: 11, color: c.mutedSilver }}>/100</span>
              </div>
            </Panel>

            <Panel
              title="AVA Summary"
              accent={c.avaViolet}
              right={
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={regen} disabled={regenLoading} style={miniBtn}>{regenLoading ? '…' : '↻ Regenerate'}</button>
                  <button onClick={() => feedback('up')} style={{ ...miniBtn, color: sel.feedback === 'up' ? c.success : c.mutedSilver }}>👍</button>
                  <button onClick={() => feedback('down')} style={{ ...miniBtn, color: sel.feedback === 'down' ? c.danger : c.mutedSilver }}>👎</button>
                </div>
              }
            >
              <p style={{ fontSize: 12, lineHeight: 1.55, color: c.textIce, margin: 0 }}>{sel.summary || 'No AI summary yet. Click ✨ Transcribe & Analyze to generate one.'}</p>
              {sel.feedback && (
                <div style={{ fontSize: 10, color: c.mutedSilver, marginTop: 6 }}>
                  Feedback recorded — AVA will adapt future summaries.
                </div>
              )}
            </Panel>

            <Panel title="Topics" accent={c.avaCyan}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(sel.topics || []).map((t) => <span key={t} style={tag(c.avaCyan)}>{t}</span>)}
                  {(!sel.topics || sel.topics.length === 0) && <span style={{ fontSize: 11, color: c.mutedSilver }}>No topics yet</span>}
              </div>
            </Panel>
            <Panel title="Tags" accent={c.mutedSilver}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(sel.tags || []).map((t) => <span key={t} style={tag(c.signalGold)}>#{t}</span>)}
                  {(!sel.tags || sel.tags.length === 0) && <span style={{ fontSize: 11, color: c.mutedSilver }}>No tags yet</span>}
              </div>
            </Panel>

            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button onClick={downloadSelectedRecording} disabled={playbackLoading} style={{ ...btnPrimary, opacity: playbackLoading ? 0.65 : 1 }}>{playbackLoading ? 'Preparing…' : 'Download'}</button>
              <button onClick={shareSelectedRecording} style={btnGhost}>Share details</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function FilterGroup({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: c.mutedSilver, textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', gap: 5 }}>
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)} style={chip(value === o)}>{o.toUpperCase()}</button>
        ))}
      </div>
    </div>
  );
}

const chip = (active: boolean): React.CSSProperties => ({
  padding: '5px 10px', borderRadius: 999,
  background: active ? 'rgba(35,214,255,0.10)' : 'transparent',
  border: `1px solid ${active ? c.avaCyan + '55' : c.border}`,
  color: active ? c.avaCyan : c.mutedSilver,
  fontSize: 10, fontWeight: 700, letterSpacing: 0.8, cursor: 'pointer',
});
const dot = (col: string): React.CSSProperties => ({ color: col, fontSize: 9 });
const tag = (col: string): React.CSSProperties => ({
  fontSize: 10, padding: '3px 8px', borderRadius: 999,
  background: c.overlay04, color: col,
  border: `1px solid ${col}33`, fontWeight: 600,
});
const miniBtn: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 8,
  background: 'transparent', border: `1px solid ${c.border}`,
  color: c.textIce, fontSize: 11, fontWeight: 600, cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  flex: 1, padding: '10px 12px', borderRadius: 10,
  background: c.signalGold, color: c.midnight, border: 'none',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  flex: 1, padding: '10px 12px', borderRadius: 10,
  background: 'transparent', color: c.textIce,
  border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600, cursor: 'pointer',
};

function Panel({ title, accent, children, right }: { title: string; accent: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 1.5, color: accent, textTransform: 'uppercase' }}>{title}</div>
        {right}
      </div>
      <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 10, padding: '10px 12px' }}>{children}</div>
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: 'rgba(239,68,68,0.10)', border: `1px solid ${c.danger}55`, color: c.textIce, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
      <span style={{ fontSize: 12 }}>{message}</span>
      <button onClick={onRetry} style={{ ...miniBtn, color: c.danger, borderColor: `${c.danger}66` }}>Retry</button>
    </div>
  );
}
