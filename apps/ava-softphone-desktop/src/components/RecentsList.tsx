import React, { useEffect, useState, useCallback } from 'react';
import { ava, CallRecord } from '@/lib/avaApi';
import { ArrowUpRight, ArrowDownLeft, PhoneMissed, PhoneCall } from './RowIcons';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';
import { useOrgId } from '@/lib/useOrgId';
import SkeletonRows from './ui/SkeletonRows';
import { theme } from '../lib/theme';

const { colors: c } = theme;


interface Props {
  extension: string;
  onCall: (n: string) => void;
}

function fmtTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit', minute: '2-digit',
  };
  return d.toLocaleString([], opts);
}

function fmtDur(s: number) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function RecentsListImpl({ extension, onCall }: Props) {
  const [rows, setRows] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [rangeDays, setRangeDays] = useState<7 | 30>(7);

  const load = useCallback(async (silent = false, force = false) => {
    if (!silent) { setLoading(true); setErr(null); }
    if (force) { setRefreshing(true); setErr(null); }
    try {
      let data: CallRecord[] = [];
      if (force) {
        try {
          data = await ava.refreshCalls(200, { extension, rangeDays });
        } catch (e: any) {
          const msg = String(e?.message || '');
          if (/NO_CDR_ENDPOINT/i.test(msg)) {
            setErr('Reconnecting to PBX… realtime updates continue in the background.');
          } else {
            setErr(msg || 'Reconnecting to PBX… realtime updates continue in the background.');
          }
          data = await ava.calls(200, { extension, rangeDays });
        }
      } else {
        data = await ava.calls(200, { extension, rangeDays });
      }
      setRows(Array.isArray(data) ? data : []);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e: any) {
      if (!silent || force) {
        setErr(e?.message || 'Unable to load live call records.');
        setRows([]);
      }
    } finally {
      if (!silent) setLoading(false);
      if (force) setRefreshing(false);
    }
  }, [extension, rangeDays]);

  const silentLoad = useCallback(() => { void load(true); }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onWake = () => { void load(true); };
    const timer = window.setInterval(onWake, 30_000);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [load]);
  useEffect(() => {
    const onSync = () => { void load(true); };
    const onRecovered = () => { setErr(null); void load(true); };
    window.addEventListener('lemtel:phone-sync-complete', onSync);
    window.addEventListener('lemtel:cdr-endpoint-recovered', onRecovered);
    return () => {
      window.removeEventListener('lemtel:phone-sync-complete', onSync);
      window.removeEventListener('lemtel:cdr-endpoint-recovered', onRecovered);
    };
  }, [load]);

  // Realtime: refresh on new CDR rows
  const orgId = useOrgId();
  useRealtimeRefresh({
    table: 'pbx_call_records', organizationId: orgId, events: ['INSERT', 'UPDATE', 'DELETE'], debounceMs: 300, throttleMs: 1_000,
    shouldRefresh: (payload: any) => {
      const row = payload?.new || payload?.old || {};
      return !extension || row.extension === extension || row.caller_number === extension || row.destination_number === extension || row.source_number === extension;
    },
  }, silentLoad);

  if (loading) return <SkeletonRows rows={6} label="Loading recents" />;
  if (err && rows.length === 0) return <div style={{ ...center, color: c.danger }}>{err}<br /><button onClick={() => load()} style={refreshBtn}>Retry</button></div>;

  const filteredRows = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [r.customer, r.from, r.to, (r as any).extension, (r as any).source_number, r.status, r.direction]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  if (rows.length === 0) return <div style={center}>No recent calls</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {err && (
        <div style={{
          fontSize: 11, color: c.gold, background: `${c.gold}14`,
          border: `1px solid ${c.gold}40`, borderRadius: 8,
          padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        }}>
          <span>{err}</span>
          <button onClick={() => setErr(null)} style={{ background: 'transparent', border: 'none', color: c.gold, cursor: 'pointer', fontSize: 14, lineHeight: 1 }} aria-label="Dismiss">×</button>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, padding: '0 2px' }}>
        <span style={{ fontSize: 10, opacity: 0.5, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 600 }}>
          {rows.length} call{rows.length > 1 ? 's' : ''}{lastUpdated ? ` · ${lastUpdated}` : ''}
        </span>
        <button
          onClick={() => load(true, true)}
          disabled={refreshing}
          style={{ ...reloadCdrBtn, opacity: refreshing ? 0.55 : 1 }}
          title="Force-refresh call records from the PBX"
          aria-label="Reload CDR"
        >
          {refreshing ? 'Reloading…' : '↻ Reload CDR'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, number, extension…" style={{ flex: 1, minWidth: 0, padding: '7px 9px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.bgCard, color: c.text, fontSize: 11, outline: 'none' }} />
        {([7, 30] as const).map((d) => <button key={d} onClick={() => setRangeDays(d)} style={{ ...reloadCdrBtn, padding: '6px 8px', opacity: rangeDays === d ? 1 : 0.55 }}>{d}d</button>)}
      </div>
      {filteredRows.map((r) => {
        const outbound = r.direction === 'out';
        const peer = outbound ? (r.to || '?') : (r.from || '?');
        const name = r.customer || (outbound ? null : r.from);
        const missed = r.status === 'missed';
        const iconColor = missed ? c.danger : outbound ? c.gold : c.success;
        const initial = (name || peer || '?').toString().charAt(0).toUpperCase();
        return (
          <button key={r.id} onClick={() => onCall(peer)} className="lemtel-row">
            <div className="lemtel-avatar" style={{
              background: missed
                ? 'linear-gradient(135deg, #7F1D1D 0%, #DC2626 100%)'
                : outbound
                  ? 'linear-gradient(135deg, #C9A84C 0%, #FFD700 100%)'
                  : 'linear-gradient(135deg, #003DA6 0%, #7C3AED 100%)',
            }}>
              {initial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 600, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: missed ? c.danger : c.text,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ color: iconColor, display: 'inline-flex' }}>
                  {missed ? <PhoneMissed size={13} /> : outbound ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}
                </span>
                {name || peer}
              </div>
              <div style={{ fontSize: 10.5, opacity: 0.62, marginTop: 2, letterSpacing: 0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {fmtTime(r.startedAt)}{r.durationSec ? ` · ${fmtDur(r.durationSec)}` : ''}
              </div>
            </div>
            <span style={{ color: 'rgba(255,215,0,0.6)', display: 'inline-flex' }}>
              <PhoneCall size={16} />
            </span>
          </button>
        );
      })}
      {filteredRows.length === 0 && <div style={center}>No calls match this filter</div>}
    </div>
  );
}

const center: React.CSSProperties = { textAlign: 'center', padding: 48, opacity: 0.5, fontSize: 12, letterSpacing: 0.5 };
const refreshBtn: React.CSSProperties = {
  background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.2)',
  color: c.gold, borderRadius: 8, width: 28, height: 28,
  cursor: 'pointer', fontSize: 13,
};
const reloadCdrBtn: React.CSSProperties = {
  background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.25)',
  color: c.gold, borderRadius: 8, padding: '4px 10px',
  cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: 0.4,
};

export default React.memo(RecentsListImpl);

