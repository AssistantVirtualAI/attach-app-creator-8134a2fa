import React, { useEffect, useMemo, useState } from 'react';
import { ava, type PbxActiveCall, type PbxSystemStatus } from '../../lib/avaApi';
import { theme } from '../../lib/theme';
import SkeletonRows from '../ui/SkeletonRows';

const { colors: c } = theme;

function fmtDuration(sec?: number) {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtCreated(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function shortUuid(uuid: string) {
  return uuid.length > 13 ? `${uuid.slice(0, 8)}…${uuid.slice(-4)}` : uuid;
}

export default function PBXLiveView() {
  const [calls, setCalls] = useState<PbxActiveCall[]>([]);
  const [status, setStatus] = useState<PbxSystemStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyUuid, setBusyUuid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeCount = calls.length;

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextCalls] = await Promise.all([
        ava.systemStatus(),
        ava.activeCalls(),
      ]);
      setStatus(nextStatus);
      setCalls(nextCalls);
    } catch (err: any) {
      setError(err?.message || 'Unable to load PBX live state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const statusPreview = useMemo(() => {
    const text = status?.statusText || status?.sofiaText || '';
    return text.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 4);
  }, [status]);

  const kill = async (uuid: string) => {
    if (!uuid) return;
    const confirmed = window.confirm(`Kill active PBX call ${shortUuid(uuid)}?`);
    if (!confirmed) return;
    setBusyUuid(uuid);
    try {
      await ava.killActiveCall(uuid);
      await ava.audit('pbx.call_kill_requested.desktop', 'active_call', uuid, { source: 'pbx_live_view' });
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to kill active call.');
    } finally {
      setBusyUuid(null);
    }
  };

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', padding: '26px 30px', boxSizing: 'border-box', gap: 18 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2.2, color: c.signalGold, textTransform: 'uppercase' }}>Admin · PBX Live</div>
          <h1 style={{ margin: '6px 0 4px', color: c.textIce, fontSize: 27, letterSpacing: -0.7 }}>Live calls & FreeSWITCH state</h1>
          <p style={{ margin: 0, color: c.mutedSilver, fontSize: 13, lineHeight: 1.5, maxWidth: 760 }}>
            Monitor active channels, refresh FreeSWITCH status, and terminate stuck calls through the audited FusionPBX proxy.
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{ padding: '9px 14px', borderRadius: 10, border: `1px solid ${c.borderGold}`, background: loading ? 'rgba(255,230,0,0.08)' : 'rgba(255,230,0,0.14)', color: c.signalGold, fontWeight: 900, letterSpacing: 1, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'REFRESHING…' : 'REFRESH'}
        </button>
      </header>

      {error && <div style={{ padding: 12, borderRadius: 12, border: `1px solid ${c.danger}55`, color: c.danger, background: `${c.danger}12`, fontSize: 12 }}>{error}</div>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <Metric label="Active calls" value={String(activeCount)} tone={activeCount ? c.signalGold : c.avaCyan} />
        <Metric label="PBX health" value={status?.ok ? 'OK' : 'Check'} tone={status?.ok ? c.avaCyan : c.danger} />
        <Metric label="Channels" value={String(status?.channels ?? activeCount ?? '—')} tone={c.lemtelBlue} />
        <Metric label="Latency" value={status?.latency_ms ? `${Math.round(status.latency_ms)} ms` : '—'} tone={c.avaViolet} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(280px, 0.9fr)', gap: 16, minHeight: 0, flex: 1 }}>
        <div style={{ minHeight: 0, border: `1px solid ${c.border}`, borderRadius: 18, background: `linear-gradient(180deg, rgba(255,255,255,0.035), transparent), ${c.deepPanel}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${c.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: c.textIce, fontWeight: 800, fontSize: 14 }}>Active channels</div>
            <div style={{ color: c.mutedSilver, fontSize: 11 }}>Auto-refresh: 15s</div>
          </div>
          <div style={{ overflow: 'auto', minHeight: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: c.deepPanel }}>
                <tr>
                  {['UUID', 'Caller', 'Destination', 'State', 'Age', ''].map((h) => <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: c.mutedSilver, borderBottom: `1px solid ${c.border}`, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.uuid}>
                    <td style={tdMono}>{shortUuid(call.uuid)}</td>
                    <td style={td}>{call.caller || '—'}</td>
                    <td style={td}>{call.destination || '—'}</td>
                    <td style={td}><span style={{ color: c.avaCyan }}>{call.state || call.direction || 'active'}</span></td>
                    <td style={td}>{call.durationSec ? fmtDuration(call.durationSec) : fmtCreated(call.created)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => kill(call.uuid)} disabled={busyUuid === call.uuid} style={{ padding: '5px 9px', borderRadius: 8, border: `1px solid ${c.danger}66`, color: c.danger, background: `${c.danger}12`, fontWeight: 800, fontSize: 10, cursor: busyUuid === call.uuid ? 'wait' : 'pointer' }}>
                        {busyUuid === call.uuid ? 'KILLING…' : 'KILL'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!calls.length && (
                  <tr><td colSpan={6} style={{ padding: 30, color: c.mutedSilver, textAlign: 'center' }}>{loading ? <SkeletonRows rows={4} padding={0} label="Loading live channels" /> : 'No active PBX channels right now.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside style={{ border: `1px solid ${c.border}`, borderRadius: 18, background: c.bgCard, padding: 16, minHeight: 0, overflow: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: c.textIce, marginBottom: 8 }}>System status</div>
          <div style={{ fontSize: 11, color: c.mutedSilver, lineHeight: 1.55, marginBottom: 14 }}>
            This panel displays a concise preview from the backend status command. Full raw data stays in the admin edge response.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(statusPreview.length ? statusPreview : ['No status output returned yet.']).map((line, idx) => (
              <div key={`${line}-${idx}`} style={{ padding: '9px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.035)', border: `1px solid ${c.border}`, color: c.textIce, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre-wrap' }}>{line}</div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={{ border: `1px solid ${tone}55`, borderRadius: 16, padding: '13px 14px', background: `linear-gradient(135deg, ${tone}18, ${c.overlay02})` }}>
      <div style={{ fontSize: 10, color: c.mutedSilver, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 800 }}>{label}</div>
      <div style={{ color: c.textIce, fontSize: 24, fontWeight: 900, marginTop: 4 }}>{value}</div>
    </div>
  );
}

const td: React.CSSProperties = { padding: '10px 12px', color: c.textIce, borderBottom: `1px solid ${c.border}` };
const tdMono: React.CSSProperties = { ...td, fontFamily: 'JetBrains Mono, monospace', color: c.mutedSilver };
