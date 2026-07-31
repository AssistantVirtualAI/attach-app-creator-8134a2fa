import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { theme } from '../../lib/theme';
import PageHeader, { ListSkeleton, EmptyState } from './PageHeader';
import AIAuditPanel from './AIAuditPanel';

const { colors: c } = theme;

type Row = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  source: string | null;
  result: string | null;
  error: string | null;
  rollback_of: string | null;
  before_json: any;
  after_json: any;
  diff_json: any;
  metadata: any;
};

const ACTION_FILTERS = ['all', 'create', 'update', 'delete', 'sync', 'rollback'] as const;

export default function AuditView() {
  const [tab, setTab] = useState<'admin' | 'ai'>('admin');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<typeof ACTION_FILTERS[number]>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('pbx_admin_actions' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      if (filter !== 'all') q = q.eq('action', filter);
      const { data } = await q;
      const list = (data || []) as any as Row[];
      setRows(list);
      const ids = [...new Set(list.map(r => r.actor_user_id).filter(Boolean))];
      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', ids as string[]);
        const map: Record<string, string> = {};
        (profs || []).forEach((p: any) => { map[p.id] = p.full_name || p.email || p.id.slice(0, 8); });
        setProfiles(map);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const filtered = rows.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return r.entity_type.toLowerCase().includes(s)
      || (r.entity_id || '').toLowerCase().includes(s)
      || r.action.toLowerCase().includes(s)
      || (profiles[r.actor_user_id || ''] || '').toLowerCase().includes(s);
  });

  return (
    <div style={{ padding: '14px 18px 24px', overflowY: 'auto', height: '100%' }}>
      <PageHeader
        eyebrow="Phase 5 · Audit"
        title={tab === 'admin' ? 'Admin Actions' : 'AI Requests'}
        subtitle={tab === 'admin'
          ? 'Every write to the PBX is recorded here with before/after payloads. Filter, inspect, and roll back when needed.'
          : 'Internal log of every AI transcription and analysis request — timestamps, status, error codes, and latency.'}
        icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
        right={tab === 'admin' ? <button onClick={load} style={btnPrimary}>Refresh</button> : null}
      />

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['admin', 'ai'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 14px', borderRadius: 10, fontSize: 11, fontWeight: 800,
            letterSpacing: 0.5, textTransform: 'uppercase', cursor: 'pointer',
            border: `1px solid ${tab === t ? c.borderGold : c.border}`,
            background: tab === t ? 'rgba(255,215,0,0.10)' : 'transparent',
            color: tab === t ? c.signalGold : c.mutedSilver,
          }}>{t === 'admin' ? 'Admin Actions' : '✨ AI Requests'}</button>
        ))}
      </div>

      {tab === 'ai' ? <AIAuditPanel /> : (
      <>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>


        {ACTION_FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '6px 12px', borderRadius: 8,
            border: `1px solid ${filter === f ? c.borderGold : c.border}`,
            background: filter === f ? 'rgba(255,215,0,0.12)' : 'transparent',
            color: filter === f ? c.signalGold : c.mutedSilver,
            fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', cursor: 'pointer',
          }}>{f}</button>
        ))}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search entity, actor…"
          style={{
            marginLeft: 'auto', minWidth: 240,
            padding: '7px 11px', borderRadius: 8,
            border: `1px solid ${c.border}`, background: c.overlay04,
            color: c.textIce, fontSize: 12,
          }}
        />
      </div>

      {loading ? <ListSkeleton rows={8} /> : filtered.length === 0 ? (
        <EmptyState
          icon="🛡"
          title="No admin actions yet"
          hint="Audited writes (push to PBX, deletes, rollbacks) will appear here."
        />
      ) : (
        <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {filtered.map((r, i) => (
            <button
              key={r.id}
              onClick={() => setSelected(r)}
              style={{
                width: '100%', display: 'grid',
                gridTemplateColumns: '120px 1fr 140px 90px 80px',
                alignItems: 'center', gap: 12,
                padding: '12px 14px', textAlign: 'left',
                background: 'transparent', border: 'none',
                color: c.textIce, fontSize: 12, cursor: 'pointer',
                borderBottom: i === filtered.length - 1 ? 'none' : `1px solid ${c.border}`,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(140,180,255,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ color: c.mutedSilver, fontSize: 10.5 }}>{new Date(r.created_at).toLocaleString()}</span>
              <span>
                <strong style={{ color: c.signalGold, letterSpacing: 0.3 }}>{r.entity_type}</strong>
                {r.entity_id && <span style={{ color: c.mutedSilver, marginLeft: 6 }}>#{String(r.entity_id).slice(0, 12)}</span>}
                {r.rollback_of && <span style={{ marginLeft: 8, fontSize: 9, color: c.avaCyan }}>↶ ROLLBACK</span>}
              </span>
              <span style={{ color: c.mutedSilver, fontSize: 11 }}>{profiles[r.actor_user_id || ''] || (r.actor_user_id ? 'unknown' : 'system')}</span>
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase',
                color: actionColor(r.action), padding: '2px 8px', borderRadius: 6,
                background: `${actionColor(r.action)}1f`, border: `1px solid ${actionColor(r.action)}55`,
                textAlign: 'center',
              }}>{r.action}</span>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
                color: r.result === 'success' ? '#3fce8c' : r.error ? c.danger : c.mutedSilver,
              }}>{r.result || (r.error ? 'error' : '—')}</span>
            </button>
          ))}
        </div>
      )}

      {selected && <DetailDrawer row={selected} onClose={() => setSelected(null)} onRollback={async () => { await rollback(selected); setSelected(null); load(); }} />}
      </>
      )}
    </div>
  );
}


function actionColor(a: string) {
  if (a === 'create') return '#3fce8c';
  if (a === 'update') return '#23d6ff';
  if (a === 'delete') return c.danger;
  if (a === 'rollback') return '#b388ff';
  return '#ffd000';
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8,
  background: `linear-gradient(135deg, ${c.signalGold}, ${c.lemtelBlue})`,
  border: 'none', color: c.onAccent, fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
  textTransform: 'uppercase', cursor: 'pointer',
};

async function rollback(row: Row) {
  if (!row.before_json) { alert('No before snapshot — cannot roll back.'); return; }
  if (!confirm(`Roll back ${row.action} on ${row.entity_type}#${row.entity_id}?`)) return;
  try {
    const { error } = await (supabase as any).from('pbx_admin_actions').insert({
      organization_id: (row as any).organization_id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      action: 'rollback',
      source: 'desktop',
      before_json: row.after_json,
      after_json: row.before_json,
      rollback_of: row.id,
      result: 'pending',
      metadata: { note: 'Manual rollback from desktop audit view' },
    });
    if (error) throw error;
    alert('Rollback recorded. A platform engineer must apply it to the PBX.');
  } catch (e: any) {
    alert(`Rollback failed: ${e?.message || e}`);
  }
}

function DetailDrawer({ row, onClose, onRollback }: { row: Row; onClose: () => void; onRollback: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(2,6,20,0.78)',
      backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center', padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 720, maxHeight: '85vh', overflowY: 'auto',
        background: c.bgCard, borderRadius: 14, border: `1px solid ${c.border}`, padding: 22, color: c.textIce,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: c.signalGold, letterSpacing: 1.4, textTransform: 'uppercase' }}>{row.action} · {row.entity_type}</div>
            <h2 style={{ margin: '4px 0 2px', fontSize: 18, fontWeight: 700 }}>{row.entity_id || '(no entity id)'}</h2>
            <div style={{ fontSize: 11, color: c.mutedSilver }}>{new Date(row.created_at).toLocaleString()} · source: {row.source || 'unknown'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {row.before_json && row.action !== 'rollback' && (
              <button onClick={onRollback} style={{ ...btnPrimary, background: `linear-gradient(135deg,#b388ff,${c.ai})` }}>Roll back</button>
            )}
            <button onClick={onClose} style={{ padding: '8px 12px', borderRadius: 8, background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce, cursor: 'pointer', fontSize: 11 }}>Close</button>
          </div>
        </div>
        {row.error && <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: `${c.danger}1f`, border: `1px solid ${c.danger}55`, color: c.danger, fontSize: 12 }}>{row.error}</div>}
        <Section title="Before" payload={row.before_json} />
        <Section title="After" payload={row.after_json} />
        <Section title="Diff" payload={row.diff_json} />
        <Section title="Metadata" payload={row.metadata} />
      </div>
    </div>
  );
}

function Section({ title, payload }: { title: string; payload: any }) {
  if (!payload || (typeof payload === 'object' && Object.keys(payload).length === 0)) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: c.signalGold, textTransform: 'uppercase', marginBottom: 6 }}>{title}</div>
      <pre style={{ margin: 0, padding: 12, borderRadius: 8, background: 'rgba(0,0,0,0.4)', border: `1px solid ${c.border}`, fontSize: 11, color: c.textIce, overflowX: 'auto', maxHeight: 220 }}>
{JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}
