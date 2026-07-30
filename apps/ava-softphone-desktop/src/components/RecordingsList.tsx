import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { theme } from '../lib/theme';
import { ava, RecordingItem } from '../lib/avaApi';
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh';
import { useOrgId } from '../lib/useOrgId';
import { audit } from '../lib/audit';

const { colors: c, glow } = theme;

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

function displayError(e: any) {
  const text = String(e?.context?.error || e?.message || e?.details || e?.error || 'Analysis failed');
  if (/MISSING_SECRET/i.test(text)) return 'AI analysis is not configured yet.';
  if (/Unauthorized|Forbidden/i.test(text)) return 'You do not have permission to analyze this recording.';
  if (/required fields missing/i.test(text)) return 'A transcript is required before AI analysis can run.';
  return text;
}

// Module-level cache: survives unmount/remount when navigating between pages,
// so users don't have to re-download the same PBX audio every time they revisit.
const audioCache = new Map<string, string>();

type JobStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';

export default function RecordingsList({ onAnalyze, extension }: { onAnalyze?: (id: string) => void; extension?: string | null }) {
  const [items, setItems] = useState<RecordingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, JobStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [itemSuccess, setItemSuccess] = useState<Record<string, string>>({});
  const [audio, setAudio] = useState<Record<string, string>>(() => Object.fromEntries(audioCache));
  const [audioErrors, setAudioErrors] = useState<Record<string, string>>({});
  const [audioLoading, setAudioLoading] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [rangeDays, setRangeDays] = useState<7 | 30>(7);

  const hydrateTranscripts = useCallback(async (rows: RecordingItem[]) => {
    const ids = rows.map(r => r.callId || r.id).filter(Boolean);
    if (!ids.length) return;
    const { data } = await supabase
      .from('pbx_call_transcripts')
      .select('call_record_id, transcript_text, provider')
      .in('call_record_id', ids);
    if (!data?.length) return;
    const byId = new Map(data.map((t: any) => [t.call_record_id, t]));
    setItems(prev => prev.map(r => {
      const t = byId.get(r.callId || r.id);
      if (!t) return r;
      const isStub = String(t.provider || '').startsWith('stub');
      return {
        ...r,
        transcript_text: r.transcript_text || t.transcript_text,
        analyzed: (r as any).analyzed || (!isStub && Boolean(t.transcript_text)),
      } as RecordingItem;
    }));
    setStatuses(prev => {
      const next = { ...prev };
      for (const [cid, t] of byId.entries()) {
        const isStub = String((t as any).provider || '').startsWith('stub');
        const row = rows.find(r => (r.callId || r.id) === cid);
        if (row && !next[row.id]) next[row.id] = isStub ? 'failed' : 'succeeded';
      }
      return next;
    });
  }, []);

  const load = useCallback(async (silent = false, force = false) => {
    if (!silent) { setLoading(true); setError(null); }
    if (force) setRefreshing(true);
    try {
      const data = force ? await ava.refreshRecordings(200, { extension, rangeDays }) : await ava.recordings(200, { extension, rangeDays });
      const list = Array.isArray(data) ? data : [];
      setItems(list);
      // Hydrate persisted transcripts so reload shows them.
      void hydrateTranscripts(list);
    } catch (e: any) {
      if (!silent || force) {
        setError(e?.message || 'Unable to load recordings.');
        setItems([]);
      }
    } finally {
      if (!silent) setLoading(false);
      if (force) setRefreshing(false);
    }
  }, [extension, rangeDays, hydrateTranscripts]);

  const silentLoad = useCallback(() => { void load(true); }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('lemtel:phone-sync-complete', silentLoad);
    return () => window.removeEventListener('lemtel:phone-sync-complete', silentLoad);
  }, [silentLoad]);

  // Realtime: new/updated call records with recordings trigger a silent refetch (no flicker).
  const orgId = useOrgId();
  useRealtimeRefresh({ table: 'pbx_call_records', organizationId: orgId, events: ['INSERT', 'UPDATE'], debounceMs: 10_000, throttleMs: 30_000, shouldRefresh: isRecordingRealtimeChange }, silentLoad);



  const setStatus = (id: string, s: JobStatus) => setStatuses(prev => ({ ...prev, [id]: s }));

  const analyze = async (r: RecordingItem) => {
    setWorking(r.id); setError(null);
    setStatus(r.id, 'queued');
    setItemErrors((all) => { const n = { ...all }; delete n[r.id]; return n; });
    setItemSuccess((all) => { const n = { ...all }; delete n[r.id]; return n; });
    try {
      const organization_id = r.organization_id || '71755d33-ed64-4ad5-a828-61c9d2029eb7';
      let transcript_text = String(r.transcript_text || '').trim();
      setStatus(r.id, 'running');
      const r1 = await supabase.functions.invoke('ai-transcribe-call', {
        body: {
          callId: r.callId || r.id,
          call_record_id: r.callId || r.id,
          xml_cdr_uuid: (r as any).xml_cdr_uuid || r.callId || r.id,
          organization_id,
          recording_path: r.recording_path,
          recording_name: r.recording_name,
          record_path: r.recording_path,
          record_name: r.recording_name,
          domain_uuid: (r as any).domain_uuid,
        },
      });
      if (r1.error) throw r1.error;
      const d1 = (r1.data as any) || {};
      if (d1.stub === true) {
        const reason = d1.reason || d1.error || 'transcription unavailable';
        throw new Error(`Transcription unavailable (${reason}).`);
      }
      transcript_text = transcript_text || String(d1.transcript_text || '').trim();
      if (!transcript_text) throw new Error('No transcript available for AI analysis yet');
      const r2 = await supabase.functions.invoke('ai-analyze-call', {
        body: {
          callId: r.callId || r.id,
          call_record_id: r.callId || r.id,
          organization_id,
          recording_path: r.recording_path,
          recording_name: r.recording_name,
          transcript_text,
        },
      });
      if (r2.error) throw r2.error;
      const ai = (r2.data as any)?.analysis || (r2.data as any) || null;

      // Re-fetch the persisted transcript so a page reload shows it.
      const callRecId = r.callId || r.id;
      const { data: persisted } = await supabase
        .from('pbx_call_transcripts')
        .select('transcript_text, provider')
        .eq('call_record_id', callRecId)
        .maybeSingle();
      const finalTranscript = (persisted?.transcript_text as string) || transcript_text;
      if (!finalTranscript || !finalTranscript.trim()) {
        throw new Error('Transcript was not persisted — please retry.');
      }

      setItems((all) => all.map((x) => x.id === r.id ? {
        ...x,
        transcript_text: finalTranscript,
        summary: ai?.summary || x.summary,
        topics: ai?.topics || x.topics,
        sentiment: ai?.sentiment || x.sentiment,
        analyzed: true,
      } as RecordingItem : x));
      setStatus(r.id, 'succeeded');
      setItemSuccess((all) => ({ ...all, [r.id]: 'Analyzed ✓' }));
      onAnalyze?.(r.id);
    } catch (e: any) {
      const msg = displayError(e);
      setError(msg);
      setItemErrors((all) => ({ ...all, [r.id]: msg }));
      setStatus(r.id, 'failed');
    } finally {
      setWorking(null);
    }
  };

  const play = async (r: RecordingItem) => {
    setError(null);
    setAudioErrors((all) => { const next = { ...all }; delete next[r.id]; return next; });
    if (audio[r.id] || audioCache.has(r.id)) {
      const cached = audio[r.id] || audioCache.get(r.id)!;
      if (!audio[r.id]) setAudio((a) => ({ ...a, [r.id]: cached }));
      return;
    }
    setAudioLoading(r.id);
    try {
      // Prefer short-lived signed URL (no client download); fallback to proxy blob.
      const signed = await ava.getRecordingSignedUrl(r as any);
      const url = signed?.url || (await ava.getRecordingAudioUrl(r as any));
      if (!url) {
        setAudioErrors((all) => ({
          ...all,
          [r.id]: 'PBX metadata exists, but the audio file is not reachable from FusionPBX storage yet.',
        }));
        return;
      }
      audioCache.set(r.id, url);
      setAudio((a) => ({ ...a, [r.id]: url }));
      audit('recording.played', r.callId || r.id, { recording_name: r.recording_name });
    } finally {
      setAudioLoading(null);
    }
  };

  const recoverAudio = async (r: RecordingItem) => {
    audioCache.delete(r.id);
    setAudio((a) => {
      const next = { ...a };
      delete next[r.id];
      return next;
    });
    setAudioLoading(r.id);
    setError(null);
    try {
      const url = await ava.getRecordingAudioUrl(r as any);
      if (url) {
        audioCache.set(r.id, url);
        setAudio((a) => ({ ...a, [r.id]: url }));
        return;
      }
      setError('Recording file is listed in PBX, but the audio bytes are not reachable yet. Refresh the PBX sync and retry.');
    } finally {
      setAudioLoading(null);
    }
  };


  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: c.textSub }}>Loading recordings…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 11, color: c.textSub, letterSpacing: 1, textTransform: 'uppercase' }}>
          {items.length} recording{items.length !== 1 ? 's' : ''}
        </div>
        <button onClick={() => load(true, true)} disabled={refreshing} style={{
          background: 'rgba(255,255,255,0.05)', border: `1px solid ${c.border}`,
          color: c.text, padding: '4px 10px', borderRadius: 8, fontSize: 11, cursor: refreshing ? 'wait' : 'pointer', opacity: refreshing ? 0.55 : 1,
        }}>{refreshing ? 'Syncing…' : '↻ Refresh'}</button>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, number, extension…" style={{ flex: 1, minWidth: 0, padding: '7px 9px', borderRadius: 8, border: `1px solid ${c.border}`, background: 'rgba(255,255,255,0.06)', color: c.text, fontSize: 11, outline: 'none' }} />
        {([7, 30] as const).map((d) => (
          <button key={d} onClick={() => setRangeDays(d)} style={{ background: rangeDays === d ? 'rgba(255,215,0,0.16)' : 'rgba(255,255,255,0.05)', border: `1px solid ${rangeDays === d ? c.yellow : c.border}`, color: rangeDays === d ? c.yellow : c.textSub, padding: '6px 8px', borderRadius: 8, fontSize: 11, cursor: 'pointer' }}>{d}d</button>
        ))}
      </div>

      {error && (
        <div style={{ padding: 10, background: 'rgba(239,68,68,0.10)', color: c.red, fontSize: 11, borderRadius: 8 }}>
          {error}
        </div>
      )}

      {items.filter((r) => !search.trim() || [r.customer, r.from, r.to, (r as any).extension, (r as any).source_number, r.summary, r.transcript_text].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase())).length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: c.textSub, fontSize: 12 }}>
          No recordings match this filter.
        </div>
      ) : items.filter((r) => !search.trim() || [r.customer, r.from, r.to, (r as any).extension, (r as any).source_number, r.summary, r.transcript_text].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase())).map(r => {
        const sentiment = r.sentiment;
        const sentColor =
          sentiment?.includes('positive') ? c.green :
          sentiment?.includes('negative') ? c.red : c.yellow;
        return (
          <div key={r.id} style={{ ...theme.glass.card, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: c.text }}>
                  {r.from || '—'} {r.to ? `→ ${r.to}` : ''}
                </div>
                <div style={{ fontSize: 10, color: c.textSub, marginTop: 2 }}>
                  {r.recordedAt ? new Date(r.recordedAt).toLocaleString() : ''} · {r.durationSec || 0}s
                </div>
              </div>
              {sentiment && (
                <span style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 6,
                  background: `${sentColor}22`, color: sentColor, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
                }}>{sentiment}</span>
              )}
            </div>

            {audio[r.id] ? (
              <audio
                controls
autoPlay
                src={audio[r.id]}
                style={{ width: '100%', marginTop: 8, height: 32 }}
                onError={() => {
                  if (String(audio[r.id] || '').startsWith('blob:')) {
                    setAudio((a) => {
                      const next = { ...a };
                      delete next[r.id];
                      return next;
                    });
                    setAudioErrors((all) => ({
                      ...all,
                      [r.id]: 'PBX returned an audio file, but Electron could not decode it. The file may still be transcoding or may be corrupted on PBX storage.',
                    }));
                    return;
                  }
                  void recoverAudio(r);
                }}
              />
            ) : (
              <button onClick={() => play(r)} disabled={audioLoading === r.id} style={{ marginTop: 8, width: '100%', padding: 7, borderRadius: 8, background: audioErrors[r.id] ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.06)', border: `1px solid ${audioErrors[r.id] ? c.red : c.border}`, color: audioErrors[r.id] ? c.red : c.text, fontSize: 11, cursor: audioLoading === r.id ? 'wait' : 'pointer' }}>{audioLoading === r.id ? 'Loading PBX audio…' : audioErrors[r.id] ? 'Audio file not reachable on PBX' : `▶ Load PBX audio${r.recording_name ? ` · ${r.recording_name}` : ''}`}</button>
            )}
            {audioErrors[r.id] && <div style={{ marginTop: 6, fontSize: 10, color: c.textSub, lineHeight: 1.35 }}>{audioErrors[r.id]}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {(() => {
                const st: JobStatus = statuses[r.id] || ((r as any).analyzed ? 'succeeded' : 'idle');
                const isBusy = st === 'queued' || st === 'running' || working === r.id;
                const pillMap: Record<JobStatus, { bg: string; color: string; label: string }> = {
                  idle: { bg: 'transparent', color: c.textSub, label: '' },
                  queued: { bg: 'rgba(234,179,8,0.15)', color: c.yellow, label: 'Queued' },
                  running: { bg: 'rgba(59,130,246,0.18)', color: c.text, label: 'Transcribing…' },
                  succeeded: { bg: 'rgba(16,185,129,0.15)', color: c.green, label: '✓ Succeeded' },
                  failed: { bg: 'rgba(239,68,68,0.15)', color: c.red, label: '⚠ Failed' },
                };
                const pill = pillMap[st];
                return (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {!(r as any).analyzed ? (
                      <button
                        onClick={() => analyze(r)}
                        disabled={isBusy}
                        style={{
                          flex: 1, padding: '6px 10px', borderRadius: 8,
                          border: `1px solid ${c.borderAI}`, background: 'rgba(124,58,237,0.15)',
                          color: c.aiLight, fontSize: 11, fontWeight: 600,
                          cursor: isBusy ? 'wait' : 'pointer',
                          opacity: isBusy ? 0.6 : 1,
                          boxShadow: isBusy ? glow.ai : 'none',
                        }}
                      >
                        {isBusy ? '✨ Analyzing…' : '✨ Transcribe & Analyze'}
                      </button>
                    ) : (
                      <span style={{
                        fontSize: 10, padding: '4px 8px', borderRadius: 6,
                        background: 'rgba(16,185,129,0.15)', color: c.green, fontWeight: 600,
                      }}>✓ Analyzed</span>
                    )}
                    {pill.label && (
                      <span style={{ fontSize: 9, padding: '3px 7px', borderRadius: 6, background: pill.bg, color: pill.color, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{pill.label}</span>
                    )}
                  </div>
                );
              })()}
              {itemErrors[r.id] && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: c.red, lineHeight: 1.35, padding: '4px 6px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>
                  <span style={{ flex: 1 }}>{itemErrors[r.id]}</span>
                  <button
                    onClick={() => analyze(r)}
                    disabled={working === r.id}
                    style={{ background: 'transparent', border: `1px solid ${c.red}`, color: c.red, fontSize: 10, padding: '2px 8px', borderRadius: 6, cursor: working === r.id ? 'wait' : 'pointer' }}
                  >Retry</button>
                </div>
              )}
              {itemSuccess[r.id] && !itemErrors[r.id] && (
                <div style={{ fontSize: 10, color: c.green, lineHeight: 1.35 }}>{itemSuccess[r.id]}</div>
              )}
            </div>

            {r.summary && (
              <div style={{ marginTop: 8, padding: 8, background: 'rgba(0,0,0,0.25)', borderRadius: 8, fontSize: 11, color: c.textSub, lineHeight: 1.4 }}>
                <div style={{ fontSize: 9, color: c.aiLight, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Summary</div>
                {r.summary}
              </div>
            )}
            {r.transcript_text && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 10, color: c.aiLight, cursor: 'pointer', letterSpacing: 1, textTransform: 'uppercase' }}>Transcript</summary>
                <div style={{ marginTop: 6, padding: 8, background: 'rgba(0,0,0,0.25)', borderRadius: 8, fontSize: 11, color: c.text, lineHeight: 1.5, maxHeight: 220, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                  {r.transcript_text}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
