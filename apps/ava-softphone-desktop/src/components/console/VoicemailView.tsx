import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { theme } from '../../lib/theme';
import { ava, VoicemailItem, Feedback } from '../../lib/avaApi';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useOrgId } from '../../lib/useOrgId';
import PageHeader, { EmptyState, ListSkeleton } from './PageHeader';
import VoicemailGreetingCard from '../VoicemailGreetingCard';

const { colors: c } = theme;

type Filter = 'all' | 'new' | 'high' | 'negative' | 'handled' | 'open';

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtDur(s?: number | null) {
  s = Number(s || 0);
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const SPEEDS = [1, 1.25, 1.5, 2] as const;

export default function VoicemailView() {
  const [items, setItems] = useState<VoicemailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<VoicemailItem | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);

  // Playback
  const [playing, setPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [pos, setPos] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false, force = false) => {
    if (!silent) { setLoading(true); setError(null); }
    if (force) setRefreshing(true);
    try {
      const d = force ? await ava.refreshVoicemails() : await ava.voicemails();
      setItems(Array.isArray(d) ? d : []);
    } catch (err: any) {
      if (!silent || force) {
        setItems([]);
        setError(err?.message || 'Unable to load voicemail from the phone system.');
      }
    } finally {
      if (!silent) setLoading(false);
      if (force) setRefreshing(false);
    }
  }, []);

  const silentLoad = useCallback(() => { void load(true); }, [load]);

  useEffect(() => { load(); }, [load]);

  // Realtime: refresh on new voicemail / call rows for this tenant.
  const orgId = useOrgId();
  useRealtimeRefresh({ table: 'pbx_voicemails', organizationId: orgId }, silentLoad);
  useRealtimeRefresh({ table: 'pbx_call_records', organizationId: orgId }, silentLoad);


  // Reset playback when selection changes
  useEffect(() => {
    setPlaying(false); setPos(0); setPlaybackError(null);
    if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    if (tickRef.current) clearInterval(tickRef.current);
  }, [sel?.id]);

  // Tick
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (playing && sel && !audioUrl) {
      tickRef.current = setInterval(() => {
        setPos((p) => {
          const next = p + 0.2 * speed;
          const dur = Number(sel.durationSec || 0);
          if (next >= dur) { setPlaying(false); return dur; }
          return next;
        });
      }, 200);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [playing, speed, sel, audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
    if (playing) audio.play().catch(() => setPlaybackError('Playback requires a user click.'));
    else audio.pause();
  }, [playing, speed, audioUrl]);

  const filtered = useMemo(() => items.filter((v) =>
    filter === 'all' ? true :
    filter === 'new' ? v.isNew :
    filter === 'high' ? v.priority === 'high' :
    filter === 'negative' ? v.sentiment === 'negative' :
    filter === 'handled' ? !!v.handled :
    filter === 'open' ? !v.handled : true
  ), [items, filter]);

  const updateItem = (id: string, patch: Partial<VoicemailItem>) => {
    setItems((all) => all.map((x) => x.id === id ? { ...x, ...patch } : x));
    if (sel?.id === id) setSel({ ...sel, ...patch });
  };

  const playSelected = async () => {
    if (!sel) return;
    setPlaybackError(null);
    if (!audioUrl) {
      const signed = await ava.getRecordingSignedUrl(sel);
      const url = signed?.url || (await ava.getRecordingAudioUrl(sel));
      if (!url) {
        setPlaying(false);
        setPlaybackError('No voicemail audio available yet');
        return;
      }
      setAudioUrl(url);
    }
    setPlaying((p) => !p);
  };

  const markRead = (v: VoicemailItem) => {
    if (!v.isNew) return;
    ava.markVoicemailRead(v.id);
    updateItem(v.id, { isNew: false });
  };

  const cyclePriority = () => {
    if (!sel) return;
    const order: VoicemailItem['priority'][] = ['low', 'normal', 'high'];
    const next = order[(order.indexOf(sel.priority || 'normal') + 1) % order.length];
    ava.setVoicemailPriority(sel.id, next);
    updateItem(sel.id, { priority: next });
  };

  const toggleHandled = () => {
    if (!sel) return;
    const next = !sel.handled;
    ava.markVoicemailHandled(sel.id, next);
    updateItem(sel.id, { handled: next });
  };

  const regen = async () => {
    if (!sel) return;
    setRegenLoading(true);
    try {
      const { summary } = await ava.regenerateSummary('voicemail', sel.id, sel.transcript);
      updateItem(sel.id, { summary, feedback: null });
    } finally { setRegenLoading(false); }
  };

  const feedback = (f: Feedback) => {
    if (!sel) return;
    const next: Feedback = sel.feedback === f ? null : f;
    ava.submitSummaryFeedback('voicemail', sel.id, next);
    updateItem(sel.id, { feedback: next });
  };

  const sentimentColor = (s: VoicemailItem['sentiment']) =>
    s === 'positive' ? c.success : s === 'negative' ? c.danger : c.mutedSilver;
  const priColor = (p: VoicemailItem['priority']) =>
    p === 'high' ? c.danger : p === 'normal' ? c.warning : c.mutedSilver;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0, padding: '24px 28px', overflowY: 'auto' }}>
        <PageHeader
          eyebrow="Inbox"
          title="Voicemail"
          subtitle="Playback, AVA transcription, priority, and one-click handled state."
          accent={c.signalGold}
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="12.5" r="4.5"/><circle cx="18.5" cy="12.5" r="4.5"/><line x1="5.5" y1="17" x2="18.5" y2="17"/></svg>}
          right={<button onClick={() => load(true, true)} disabled={refreshing} style={{ ...chip(false), opacity: refreshing ? 0.55 : 1 }}>{refreshing ? 'SYNCING…' : 'SYNC NOW'}</button>}
        />

        <VoicemailGreetingCard />

        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {(['all', 'new', 'open', 'handled', 'high', 'negative'] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={chip(filter === f)}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading && <ListSkeleton rows={6} />}
        {!loading && <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {filtered.map((v) => (
            <button key={v.id} onClick={() => { setSel(v); markRead(v); }} style={{
              display: 'grid', gridTemplateColumns: '10px 1fr 60px 80px 90px',
              alignItems: 'center', gap: 12, width: '100%',
              padding: '12px 14px',
              background: sel?.id === v.id ? 'rgba(255,230,0,0.06)' : 'transparent',
              border: 'none', borderBottom: `1px solid ${c.border}`,
              color: c.textIce, cursor: 'pointer', textAlign: 'left',
              opacity: v.handled ? 0.55 : 1,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: v.isNew ? c.signalGold : 'transparent',
                boxShadow: v.isNew ? `0 0 8px ${c.signalGold}` : 'none',
              }} />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: v.isNew ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {v.customer || v.from || 'Unknown caller'}
                  {v.handled && <span style={{ marginLeft: 6, color: c.success, fontSize: 10 }}>✓ handled</span>}
                </span>
                <span style={{ fontSize: 10.5, color: c.mutedSilver, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {v.summary || 'Message vocal ou appel manqué à traiter.'}
                </span>
              </span>
              <span style={{ fontSize: 11, color: c.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>{fmtDur(v.durationSec)}</span>
              <span style={{ fontSize: 11, color: c.mutedSilver }}>{fmtDate(v.receivedAt)}</span>
              <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {(v.priority || 'normal') !== 'low' && <span style={tag(priColor(v.priority || 'normal'))}>{(v.priority || 'normal').toUpperCase()}</span>}
                <span style={dot(sentimentColor(v.sentiment || 'neutral'))}>●</span>
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <EmptyState
              icon="✉"
              title="Inbox is clear"
              hint="No voicemails match this filter. Switch filter or wait for new messages — AVA will transcribe instantly."
              accent={c.signalGold}
              cta={{ label: 'View all', onClick: () => setFilter('all') }}
            />
          )}
        </div>}
      </div>

      <aside style={{ width: 380, flexShrink: 0, borderLeft: `1px solid ${c.border}`, background: c.deepPanel, padding: '24px 22px', overflowY: 'auto' }}>
        {!sel && (
          <EmptyState
            icon="✉"
            title="Pick a voicemail"
            hint="Select a message to view transcript, AVA summary, and playback controls."
            accent={c.signalGold}
          />
        )}
        {sel && (
          <>
            <div style={{ fontSize: 11, color: c.signalGold, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Voicemail</div>
            <h2 style={{ fontSize: 18, color: c.textIce, margin: '0 0 4px' }}>{sel.customer || sel.from || 'Unknown caller'}</h2>
            <div style={{ fontSize: 11, color: c.mutedSilver, marginBottom: 14 }}>
              {sel.from || 'Unknown'} · {fmtDur(sel.durationSec)} · {fmtDate(sel.receivedAt)}
            </div>

            {/* Playback */}
            <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 30, marginBottom: 8 }}>
                {Array.from({ length: 40 }).map((_, i) => {
                  const active = (i / 40) <= (pos / Math.max(Number(sel.durationSec || 0), 1));
                  return (
                    <span key={i} style={{
                      flex: 1, height: `${20 + Math.abs(Math.sin(i * 0.9)) * 70}%`,
                      background: active ? c.signalGold : c.avaCyan,
                      opacity: active ? 0.9 : 0.35, borderRadius: 1,
                    }} />
                  );
                })}
              </div>
              <input
                type="range" min={0} max={Number(sel.durationSec || 0)} step={0.1} value={pos}
                onChange={(e) => setPos(Number(e.target.value))}
                style={{ width: '100%', accentColor: c.signalGold }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 10, color: c.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>{fmtDur(pos)}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={() => setPos((p) => { const next = Math.max(0, p - 5); if (audioRef.current) audioRef.current.currentTime = next; return next; })} style={iconBtn}>«5s</button>
                  <button onClick={playSelected} style={{ ...iconBtn, background: c.signalGold, color: c.midnight, fontWeight: 700, padding: '6px 14px' }}>
                    {playing ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button onClick={() => setPos((p) => { const next = Math.min(Number(sel.durationSec || 0), p + 5); if (audioRef.current) audioRef.current.currentTime = next; return next; })} style={iconBtn}>5s»</button>
                  <button onClick={() => { const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(next); if (audioRef.current) audioRef.current.playbackRate = next; }} style={iconBtn}>{speed}x</button>
                </div>
                <span style={{ fontSize: 10, color: c.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>{fmtDur(sel.durationSec)}</span>
              </div>
              {audioUrl && <audio ref={audioRef} src={audioUrl} controls style={{ width: '100%', marginTop: 8, height: 30 }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onLoadedMetadata={(e) => { e.currentTarget.playbackRate = speed; if (playing) e.currentTarget.play().catch(() => setPlaybackError('Playback requires a user click.')); }} onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setPlaybackError('PBX voicemail audio is not reachable yet. Sync the phone system and try again.'); }} />}
              {playbackError && <div style={{ fontSize: 11, color: c.mutedSilver, marginTop: 8 }}>{playbackError}</div>}
            </div>

            {/* Lifecycle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button onClick={cyclePriority} style={{ ...iconBtn, flex: 1, color: priColor(sel.priority || 'normal'), borderColor: priColor(sel.priority || 'normal') + '55' }}>
                Priority · {(sel.priority || 'normal').toUpperCase()}
              </button>
              <button onClick={toggleHandled} style={{
                ...iconBtn, flex: 1,
                background: sel.handled ? c.success : 'transparent',
                color: sel.handled ? c.midnight : c.success,
                borderColor: c.success + '55', fontWeight: 700,
              }}>
                {sel.handled ? '✓ Handled' : 'Mark handled'}
              </button>
            </div>

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
              <p style={{ fontSize: 12, lineHeight: 1.55, color: c.textIce, margin: 0 }}>{sel.summary || 'Message vocal ou appel manqué à traiter.'}</p>
              {sel.feedback && (
                <div style={{ fontSize: 10, color: c.mutedSilver, marginTop: 6 }}>
                  Feedback recorded — AVA will adapt future summaries.
                </div>
              )}
            </Panel>

            <Panel title="Transcript" accent={c.avaCyan}>
              <p style={{ fontSize: 12, lineHeight: 1.55, color: c.textIce, margin: 0, whiteSpace: 'pre-wrap' }}>{sel.transcript || 'Transcription non disponible.'}</p>
            </Panel>

            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button style={btnPrimary}>Call back</button>
              <button style={btnGhost}>Reply SMS</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

const chip = (active: boolean): React.CSSProperties => ({
  padding: '6px 11px', borderRadius: 999,
  background: active ? 'rgba(255,230,0,0.12)' : 'transparent',
  border: `1px solid ${active ? c.borderGold : c.border}`,
  color: active ? c.signalGold : c.mutedSilver,
  fontSize: 10, fontWeight: 700, letterSpacing: 1, cursor: 'pointer',
});
const dot = (col: string): React.CSSProperties => ({ color: col, fontSize: 9 });
const tag = (col: string): React.CSSProperties => ({
  fontSize: 9.5, padding: '3px 7px', borderRadius: 999,
  background: c.overlay04, color: col,
  border: `1px solid ${col}33`, fontWeight: 700, letterSpacing: 0.6,
});
const iconBtn: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 8,
  background: 'transparent', color: c.textIce,
  border: `1px solid ${c.border}`, fontSize: 11, fontWeight: 600, cursor: 'pointer',
};
const miniBtn: React.CSSProperties = {
  padding: '3px 7px', borderRadius: 6,
  background: 'transparent', border: `1px solid ${c.border}`,
  color: c.mutedSilver, fontSize: 10, fontWeight: 600, cursor: 'pointer',
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
