import React, { useEffect, useState, useCallback } from 'react';
import { ava, VoicemailItem } from '@/lib/avaApi';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';
import { useOrgId } from '@/lib/useOrgId';
import { audit } from '@/lib/audit';
import SkeletonRows from './ui/SkeletonRows';
import { theme } from '../lib/theme';

const { colors: c } = theme;

interface Props {
  extension: string;
  onCall: (n: string) => void;
}

// Module-level cache: survives unmount/remount when navigating between pages.
const voicemailAudioCache = new Map<string, string>();

function fmtTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function VoicemailList({ extension, onCall }: Props) {
  const [rows, setRows] = useState<VoicemailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [audio, setAudio] = useState<Record<string, string>>(() => {
    const cached: Record<string, string> = {};
    voicemailAudioCache.forEach((url, id) => { cached[id] = url; });
    return cached;
  });

  const load = useCallback(async (silent = false, force = false) => {
    if (!silent) { setLoading(true); setErr(null); }
    if (force) setRefreshing(true);
    try {
      const data = force ? await ava.refreshVoicemails(50, { extension }) : await ava.voicemails(50, { extension });
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      if (!silent || force) {
        setErr(e?.message || 'Unable to load voicemail.');
        setRows([]);
      }
    } finally {
      if (!silent) setLoading(false);
      if (force) setRefreshing(false);
    }
  }, [extension]);

  const silentLoad = useCallback(() => { void load(true); }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onSync = () => { void load(true); };
    window.addEventListener('lemtel:phone-sync-complete', onSync);
    return () => window.removeEventListener('lemtel:phone-sync-complete', onSync);
  }, [load]);

  // Realtime: new voicemails for this tenant trigger a refetch.
  const orgId = useOrgId();
  useRealtimeRefresh({ table: 'pbx_voicemails', organizationId: orgId }, silentLoad);
  useRealtimeRefresh({ table: 'pbx_call_records', organizationId: orgId }, silentLoad);


  const togglePlay = async (r: VoicemailItem) => {
    if (playing === r.id) { setPlaying(null); return; }
    if (audio[r.id] || voicemailAudioCache.has(r.id)) {
      const cached = audio[r.id] || voicemailAudioCache.get(r.id)!;
      if (!audio[r.id]) setAudio((a) => ({ ...a, [r.id]: cached }));
      audit('voicemail.played', r.id, { from: r.from, duration: r.durationSec });
      setPlaying(r.id);
      return;
    }
    try {
      const signed = await ava.getRecordingSignedUrl(r);
      const url = signed?.url || (await ava.getRecordingAudioUrl(r));
      if (!url) { setErr('No voicemail audio available yet'); return; }
      voicemailAudioCache.set(r.id, url);
      setAudio((a) => ({ ...a, [r.id]: url }));
      audit('voicemail.played', r.id, { from: r.from, duration: r.durationSec });
      setPlaying(r.id);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load voicemail audio.');
    }
  };

  if (loading) return <SkeletonRows rows={5} label="Loading voicemail" />;
  if (err) return <div style={{ ...center, color: c.danger }}>{err}<br /><button onClick={() => load()} style={refreshBtn}>Retry</button></div>;
  if (rows.length === 0) return <div style={center}>No voicemail</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, opacity: 0.6 }}>{rows.length} message{rows.length > 1 ? 's' : ''}</span>
        <button onClick={() => load(true, true)} disabled={refreshing} style={{ ...refreshBtn, opacity: refreshing ? 0.55 : 1 }}>{refreshing ? '…' : '↻'}</button>
      </div>
      {rows.map((r) => {
        const peer = r.from || '?';
        const name = r.customer || peer;
        const expanded = playing === r.id;
        return (
          <div key={r.id} style={rowBox}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: c.gold, fontSize: 16, width: 20 }}>✉</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </div>
                <div style={{ fontSize: 10, opacity: 0.55 }}>
                  {fmtTime(r.receivedAt)}{r.durationSec ? ` · ${r.durationSec}s` : ''}
                </div>
              </div>
              <button onClick={() => togglePlay(r)} style={iconAct}>{expanded ? '⏸' : '▶'}</button>
              <button onClick={() => onCall(peer)} style={iconAct}>📞</button>
            </div>
            {expanded && audio[r.id] && (
              <audio src={audio[r.id]} controls autoPlay style={{ width: '100%', marginTop: 8, height: 32 }} />
            )}
            {r.transcript && (
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6, padding: 6, background: c.overlay04, borderRadius: 6 }}>
                {r.transcript}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const center: React.CSSProperties = { textAlign: 'center', padding: 40, opacity: 0.5, fontSize: 12 };
const rowBox: React.CSSProperties = {
  background: `linear-gradient(155deg, ${c.overlay06} 0%, ${c.overlay02} 100%)`, border: `1px solid ${c.overlay08}`,
  borderRadius: 14, padding: 10, color: c.text,
};
const iconAct: React.CSSProperties = {
  background: c.overlay08, border: 'none', color: c.onAccent,
  borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12,
};
const refreshBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: c.textDim,
  cursor: 'pointer', fontSize: 14,
};
