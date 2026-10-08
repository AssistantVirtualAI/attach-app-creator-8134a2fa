import React, { useEffect, useState, useCallback } from 'react';
import { ava, CallRecord } from '@/lib/avaApi';
import { ArrowUpRight, ArrowDownLeft, PhoneMissed, PhoneCall } from './RowIcons';
import { supabase } from '@/lib/supabaseClient';
import SkeletonRows from './ui/SkeletonRows';
import { theme } from '../lib/theme';
import { useTranslation } from '../lib/i18n';

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

// Phase 26B — own_extension_only: a row stays visible only if it belongs to the
// connected extension. Applies to every user, with no administrative bypass.
export function isOwnRow(r: any, ext: string): boolean {
  if (!r || !ext) return false;
  return [r.extension, r.caller_number, r.destination_number, r.source_number, r.from, r.to]
    .some((v) => v != null && String(v) === ext);
}

function RecentsListImpl({ extension, onCall }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [rangeDays, setRangeDays] = useState<7 | 30>(7);

  const load = useCallback(async (silent = false, force = false) => {
    if (!extension) { setRows([]); setLoading(false); return; }
    if (!silent) { setLoading(true); setErr(null); }
    if (force) { setRefreshing(true); setErr(null); }
    try {
      let data: CallRecord[] = [];
      if (force) {
        try {
          data = await ava.refreshPersonalCalls(200, { rangeDays });
        } catch (e: any) {
          const msg = String(e?.message || '');
          if (/NO_CDR_ENDPOINT/i.test(msg)) {
            setErr(t('recents.reconnecting'));
          } else {
            setErr(msg || t('recents.reconnecting'));
          }
          data = await ava.personalCalls(200, { rangeDays });
        }
      } else {
        data = await ava.personalCalls(200, { rangeDays });
      }
      setRows((Array.isArray(data) ? data : []).filter((r) => isOwnRow(r, extension)));
      setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e: any) {
      if (!silent || force) {
        setErr(e?.message || t('recents.unavailable'));
        setRows([]);
      }
    } finally {
      if (!silent) setLoading(false);
      if (force) setRefreshing(false);
    }
  }, [extension, rangeDays, t]);

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

  // Realtime: personal CDR channel, filtered exactly by the connected extension.
  useEffect(() => {
    if (!extension) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let lastAt = 0;
    const fire = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        const now = Date.now();
        if (now - lastAt < 1_000) return;
        lastAt = now;
        silentLoad();
      }, 300);
    };
    const channel = supabase.channel(`rt-pbx_call_records-extension-${extension}`);
    for (const ev of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      channel.on(
        // @ts-ignore — supabase-js types for postgres_changes
        'postgres_changes',
        { event: ev, schema: 'public', table: 'pbx_call_records', filter: `extension=eq.${extension}` },
        (payload: any) => {
          const row = payload?.new && Object.keys(payload.new).length ? payload.new : payload?.old;
          if (isOwnRow(row, extension)) fire();
        },
      );
    }
    channel.subscribe();
    return () => {
      if (pending) clearTimeout(pending);
      try { supabase.removeChannel(channel); } catch { /* noop */ }
    };
  }, [extension, silentLoad]);

  if (!extension) return <div style={center}>{t('recents.waitingExtension')}</div>;
  if (loading) return <SkeletonRows rows={6} label={t('recents.loading')} />;
  if (err && rows.length === 0) return <div style={{ ...center, color: c.danger }}>{err}<br /><button onClick={() => load()} style={refreshBtn}>{t('recents.retry')}</button></div>;

  const filteredRows = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [r.customer, r.from, r.to, (r as any).extension, (r as any).source_number, r.status, r.direction]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  if (rows.length === 0) return <div style={center}>{t('recents.empty')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {err && (
        <div style={{
          fontSize: 11, color: c.gold, background: `${c.gold}14`,
          border: `1px solid ${c.gold}40`, borderRadius: 8,
          padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        }}>
          <span>{err}</span>
          <button onClick={() => setErr(null)} style={{ background: 'transparent', border: 'none', color: c.gold, cursor: 'pointer', fontSize: 14, lineHeight: 1 }} aria-label={t('recents.dismiss')}>×</button>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, padding: '0 2px' }}>
        <span style={{ fontSize: 10, opacity: 0.5, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 600 }}>
          {rows.length} {t('workspace.calls').toLowerCase()}{lastUpdated ? ` · ${lastUpdated}` : ''}
          <span data-testid="recents-own-extension" style={{ marginLeft: 6 }}>· {t('recents.myExtension')} {extension}</span>
        </span>
        <button
          onClick={() => load(true, true)}
          disabled={refreshing}
          style={{ ...reloadCdrBtn, opacity: refreshing ? 0.55 : 1 }}
          title={t('recents.reload')}
          aria-label={t('recents.reload')}
        >
          {refreshing ? t('recents.reloading') : `↻ ${t('recents.reload')}`}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('recents.search')} aria-label={t('recents.search')} style={{ flex: 1, minWidth: 0, padding: '7px 9px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.bgCard, color: c.text, fontSize: 11, outline: 'none' }} />
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
                  ? `linear-gradient(135deg, #C9A84C 0%, ${c.gold} 100%)`
                  : `linear-gradient(135deg, ${c.primary} 0%, ${c.ai} 100%)`,
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
            <span style={{ color: `${c.gold}99`, display: 'inline-flex' }}>
              <PhoneCall size={16} />
            </span>
          </button>
        );
      })}
      {filteredRows.length === 0 && <div style={center}>{t('recents.noMatch')}</div>}
    </div>
  );
}

const center: React.CSSProperties = { textAlign: 'center', padding: 48, opacity: 0.5, fontSize: 12, letterSpacing: 0.5 };
const refreshBtn: React.CSSProperties = {
  background: `${c.gold}14`, border: `1px solid ${c.gold}33`,
  color: c.gold, borderRadius: 8, width: 28, height: 28,
  cursor: 'pointer', fontSize: 13,
};
const reloadCdrBtn: React.CSSProperties = {
  background: `${c.gold}14`, border: `1px solid ${c.gold}40`,
  color: c.gold, borderRadius: 8, padding: '4px 10px',
  cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: 0.4,
};

export default React.memo(RecentsListImpl);
