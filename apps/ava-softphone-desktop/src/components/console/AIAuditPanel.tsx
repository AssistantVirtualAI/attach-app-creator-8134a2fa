import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { theme } from '../../lib/theme';
import { ListSkeleton, EmptyState } from './PageHeader';

const { colors: c } = theme;

type AIRow = {
  id: string;
  created_at: string;
  organization_id: string | null;
  user_id: string | null;
  call_record_id: string | null;
  request_type: 'transcribe' | 'analyze' | 'period-insight' | 'rewrite' | 'summary' | 'other';
  status: 'ok' | 'no-audio' | 'no-transcript' | 'missing-key' | 'ai-error' | 'forbidden' | 'bad-request' | 'timeout' | 'error';
  error_code: string | null;
  http_status: number | null;
  message: string | null;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  metadata: any;
};

const STATUS_FILTERS = ['all', 'ok', 'no-audio', 'missing-key', 'ai-error', 'error'] as const;

const statusColor = (s: string) => {
  if (s === 'ok') return '#3fce8c';
  if (s === 'no-audio' || s === 'no-transcript') return '#ffd000';
  if (s === 'missing-key') return '#ff9a3c';
  if (s === 'ai-error' || s === 'error' || s === 'timeout') return c.danger;
  if (s === 'forbidden') return '#b388ff';
  return '#8aa0c8';
};

export default function AIAuditPanel() {
  const [rows, setRows] = useState<AIRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<typeof STATUS_FILTERS[number]>('all');
  const [callIdSearch, setCallIdSearch] = useState('');
  const [selected, setSelected] = useState<AIRow | null>(null);

  const [retrying, setRetrying] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const rowsRef = useRef<AIRow[]>([]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const load = useCallback(async () => {
    setLoading(prev => prev && rowsRef.current.length === 0);
    try {
      let q = supabase.from('ai_request_audit_log' as any).select('*').order('created_at', { ascending: false }).limit(300);
      if (filter !== 'all') q = q.eq('status', filter);
      const { data } = await q;
      setRows((data || []) as any);
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // Live polling: 3s when an in-flight request is visible, else 10s.
  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stop) return;
      await load();
      const anyActive = rowsRef.current.some(r => ['pending', 'running', 'queued'].includes(r.status as any));
      t = setTimeout(tick, anyActive ? 3000 : 10000);
    };
    t = setTimeout(tick, 5000);
    return () => { stop = true; if (t) clearTimeout(t); };
  }, [load]);

  const retry = useCallback(async (r: AIRow) => {
    if (!r.call_record_id || !r.organization_id) {
      setToast('Cannot retry — missing call id or workspace.');
      return;
    }
    setRetrying(r.id); setToast(null);
    const fn = r.request_type === 'analyze' ? 'ai-analyze-call' : 'ai-transcribe-call';
    try {
      const { error } = await supabase.functions.invoke(fn, {
        body: { call_record_id: r.call_record_id, organization_id: r.organization_id, retry_of: r.id },
      });
      setToast(error ? `Retry failed: ${error.message}` : `Retry queued for ${r.request_type} · #${r.call_record_id.slice(0, 8)}`);
      setTimeout(load, 700);
    } catch (e: any) {
      setToast(`Retry failed: ${e?.message || 'network error'}`);
    } finally { setRetrying(null); }
  }, [load]);

  const filtered = useMemo(() => rows.filter(r => {
    if (!callIdSearch.trim()) return true;
    const s = callIdSearch.trim().toLowerCase();
    return (r.call_record_id || '').toLowerCase().includes(s)
      || (r.error_code || '').toLowerCase().includes(s)
      || (r.message || '').toLowerCase().includes(s);
  }), [rows, callIdSearch]);

  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    rows.forEach(r => { acc[r.status] = (acc[r.status] || 0) + 1; });
    return acc;
  }, [rows]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '6px 12px', borderRadius: 8,
            border: `1px solid ${filter === f ? statusColor(f === 'all' ? 'ok' : f) : c.border}`,
            background: filter === f ? `${statusColor(f === 'all' ? 'ok' : f)}1a` : 'transparent',
            color: filter === f ? c.textIce : c.mutedSilver,
            fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', cursor: 'pointer',
          }}>{f}{counts[f] ? ` · ${counts[f]}` : ''}</button>
        ))}
        <input
          value={callIdSearch} onChange={e => setCallIdSearch(e.target.value)}
          placeholder="Search call id, error code…"
          style={{
            marginLeft: 'auto', minWidth: 260,
            padding: '7px 11px', borderRadius: 8,
            border: `1px solid ${c.border}`, background: c.overlay04,
            color: c.textIce, fontSize: 12,
          }}
        />
        <button onClick={load} style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${c.border}`, background: 'transparent', color: c.textIce, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>↻</button>
      </div>

      {toast && (
        <div style={{
          fontSize: 11.5, color: c.textIce, background: 'rgba(80,140,255,0.12)',
          border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px',
        }}>{toast}</div>
      )}

      {loading ? <ListSkeleton rows={8} /> : filtered.length === 0 ? (
        <EmptyState icon="✨" title="No AI requests logged" hint="Every transcription and analysis request will appear here with its status and error code." />
      ) : (
        <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '150px 90px 1fr 100px 110px 70px 80px 80px', padding: '10px 14px', fontSize: 10, color: c.mutedSilver, textTransform: 'uppercase', letterSpacing: 0.7, background: c.overlay02, borderBottom: `1px solid ${c.border}` }}>
            <span>When</span><span>Type</span><span>Call / message</span><span>Error code</span><span>Provider</span><span>Latency</span><span>Status</span><span>Action</span>
          </div>
          {filtered.map((r, i) => (
            <div
              key={r.id}
              style={{
                width: '100%', display: 'grid',
                gridTemplateColumns: '150px 90px 1fr 100px 110px 70px 80px 80px',
                alignItems: 'center', gap: 8,
                padding: '10px 14px',
                color: c.textIce, fontSize: 11.5,
                borderBottom: i === filtered.length - 1 ? 'none' : `1px solid ${c.border}`,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(140,180,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span onClick={() => setSelected(r)} style={{ color: c.mutedSilver, fontSize: 10.5, cursor: 'pointer' }}>{new Date(r.created_at).toLocaleString()}</span>
              <span onClick={() => setSelected(r)} style={{ color: (c as any).aiLight || c.textIce, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, cursor: 'pointer' }}>{r.request_type}</span>
              <span onClick={() => setSelected(r)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                <span style={{ color: c.mutedSilver, fontSize: 10.5 }}>{r.call_record_id ? `#${r.call_record_id.slice(0, 10)}` : '—'}</span>
                {r.message && <span style={{ color: c.textSub, marginLeft: 8 }}>{r.message}</span>}
              </span>
              <span style={{ color: r.error_code ? c.danger : c.mutedSilver, fontSize: 10, fontFamily: 'Fira Code, monospace' }}>{r.error_code || '—'}</span>
              <span style={{ color: c.mutedSilver, fontSize: 10 }}>{r.provider || '—'}{r.http_status ? ` · ${r.http_status}` : ''}</span>
              <span style={{ color: c.mutedSilver, fontSize: 10 }}>{r.latency_ms ? `${r.latency_ms}ms` : '—'}</span>
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
                color: statusColor(r.status), padding: '2px 6px', borderRadius: 6,
                background: `${statusColor(r.status)}1f`, border: `1px solid ${statusColor(r.status)}55`,
                textAlign: 'center',
              }}>{r.status}</span>
              <button
                onClick={(e) => { e.stopPropagation(); retry(r); }}
                disabled={retrying === r.id || !r.call_record_id || !r.organization_id}
                title={!r.call_record_id ? 'No call id' : 'Re-queue this request'}
                style={{
                  padding: '5px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                  border: `1px solid ${c.border}`, background: retrying === r.id ? 'rgba(80,140,255,0.25)' : 'rgba(80,140,255,0.12)',
                  color: c.textIce, cursor: 'pointer',
                  opacity: !r.call_record_id || !r.organization_id ? 0.4 : 1,
                }}>{retrying === r.id ? '…' : '↻ Retry'}</button>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(2,6,20,0.78)', backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 680, maxHeight: '85vh', overflowY: 'auto', background: c.bgCard, borderRadius: 14, border: `1px solid ${c.border}`, padding: 22, color: c.textIce }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>AI request · {selected.request_type}</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'transparent', border: 'none', color: c.mutedSilver, fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <pre style={{ background: 'rgba(0,0,0,0.35)', padding: 12, borderRadius: 8, fontSize: 11, overflow: 'auto', maxHeight: '55vh' }}>{JSON.stringify(selected, null, 2)}</pre>
            <button
              onClick={() => retry(selected)}
              disabled={retrying === selected.id || !selected.call_record_id || !selected.organization_id}
              style={{
                marginTop: 14, width: '100%', padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${c.border}`, background: 'rgba(80,140,255,0.18)',
                color: c.textIce, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                opacity: retrying === selected.id ? 0.5 : 1,
              }}
            >{retrying === selected.id ? 'Retrying…' : '↻ Retry this request'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
