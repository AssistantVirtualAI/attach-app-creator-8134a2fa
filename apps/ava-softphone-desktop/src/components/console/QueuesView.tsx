import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { theme } from '../../lib/theme';
import { useTenant } from '../../hooks/useTenant';

const { colors: c } = theme;

interface Props {
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  isSupervisor?: boolean;
}

interface Queue {
  id: string;
  pbx_uuid?: string | null;
  name: string;
  extension?: string | null;
  strategy?: string | null;
}

interface AgentRow {
  id: string;
  extension: string;
  display_name: string | null;
  cc_role: string | null;
  cc_status: string | null;
  cc_pause_reason: string | null;
  cc_queues: string[] | null;
}

interface WaitingCall {
  id: string;
  caller_number: string | null;
  start_at: string;
  destination_number: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  available: '#22c55e',
  paused: '#f59e0b',
  on_call: '#3b82f6',
  offline: '#64748b',
};

export default function QueuesView({ isAdmin, isSuperAdmin, isSupervisor }: Props) {
  const { orgId, domainUuid } = useTenant();
  const [queues, setQueues] = useState<Queue[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [waiting, setWaiting] = useState<Record<string, WaitingCall[]>>({});
  const [stats, setStats] = useState<Record<string, any>>({});
  const [meRow, setMeRow] = useState<AgentRow | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSupervise = !!(isSupervisor || isAdmin || isSuperAdmin);
  const canAdmin = !!(isAdmin || isSuperAdmin);

  const load = async () => {
    if (!orgId) return;
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Source of truth for agents = pbx_extensions (every SIP extension on the PBX),
      // enriched with call-center state from pbx_softphone_users matched by extension.
      const [{ data: q }, { data: ext }, { data: spu }, { data: s }] = await Promise.all([
        supabase.from('pbx_call_queues').select('id,pbx_uuid,name,extension,strategy').eq('organization_id', orgId).order('name'),
        supabase.from('pbx_extensions')
          .select('extension,effective_caller_id_name,effective_cid_number,enabled')
          .eq('organization_id', orgId)
          .eq('enabled', true)
          .order('extension'),
        supabase.from('pbx_softphone_users')
          .select('id,extension,display_name,cc_role,cc_status,cc_pause_reason,cc_queues,portal_user_id')
          .eq('organization_id', orgId),
        supabase.from('cc_queue_stats').select('*').eq('organization_id', orgId),
      ]);
      const cc = new Map<string, any>();
      (spu || []).forEach((u: any) => { if (u.extension) cc.set(String(u.extension), u); });
      const merged: AgentRow[] = (ext || []).map((e: any) => {
        const u = cc.get(String(e.extension)) || {};
        return {
          id: u.id || `ext:${e.extension}`,
          extension: String(e.extension),
          display_name: u.display_name || e.effective_caller_id_name || null,
          cc_role: u.cc_role ?? null,
          cc_status: u.cc_status ?? 'offline',
          cc_pause_reason: u.cc_pause_reason ?? null,
          cc_queues: u.cc_queues ?? null,
        };
      });
      setQueues((q || []) as any);
      setAgents(merged);
      const statsMap: Record<string, any> = {};
      (s || []).forEach((row: any) => { statsMap[row.queue_id || row.queue_name] = row; });
      setStats(statsMap);

      // Live waiting calls: ringing/queued records per queue extension
      const { data: live } = await supabase
        .from('pbx_call_records')
        .select('id,caller_number,start_at,destination_number,call_status')
        .eq('organization_id', orgId)
        .in('call_status', ['ringing', 'queued'])
        .order('start_at', { ascending: true });
      const w: Record<string, WaitingCall[]> = {};
      (q || []).forEach((qu: any) => {
        w[qu.id] = (live || []).filter((r: any) =>
          r.destination_number && qu.extension && r.destination_number === qu.extension
        );
      });
      setWaiting(w);

      // resolve "me" from softphone_users by portal_user_id, then map to merged row by extension
      if (user) {
        const mine = (spu || []).find((row: any) => row.portal_user_id === user.id) as any;
        if (mine) {
          const m = merged.find(r => r.extension === String(mine.extension));
          setMeRow(m || (mine as any));
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load queues');
    }
  };

  useEffect(() => { load(); }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    const ch = supabase.channel('qv-' + orgId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pbx_softphone_users', filter: `organization_id=eq.${orgId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cc_queue_stats', filter: `organization_id=eq.${orgId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pbx_call_records', filter: `organization_id=eq.${orgId}` }, load)
      .subscribe();
    const t = setInterval(load, 15000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [orgId]);

  const myQueues = useMemo(() => {
    if (!meRow?.cc_queues?.length) return [];
    return queues.filter(q => meRow.cc_queues!.includes(q.extension || '') || meRow.cc_queues!.includes(q.name) || meRow.cc_queues!.includes(q.id));
  }, [queues, meRow]);

  const call = async (action: string, extra: any = {}) => {
    if (!orgId) return;
    setBusy(true); setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('call-center-sync', {
        body: { action, organization_id: orgId, ...extra },
      });
      if (err) throw err;
      if ((data as any)?.error) throw new Error((data as any).error);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Action failed');
    } finally { setBusy(false); }
  };

  const proxy = async (action: string, params: any = {}) => {
    if (!orgId) return;
    setBusy(true); setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('fusionpbx-proxy', {
        body: { action, organization_id: orgId, domain_uuid: domainUuid, params },
      });
      if (err) throw err;
      if ((data as any)?.error) throw new Error((data as any).error);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Action failed');
    } finally { setBusy(false); }
  };

  const setMyStatus = async (next: 'login' | 'pause' | 'unpause' | 'logout', reason?: string) => {
    if (!meRow) return;
    const actionMap = { login: 'agent-login', pause: 'agent-pause', unpause: 'agent-unpause', logout: 'agent-logout' } as const;
    await call(actionMap[next], {
      extension: meRow.extension,
      queue: meRow.cc_queues?.[0],
      reason,
    });
  };

  const moveAgent = async (agentExt: string, fromQueueExt: string, toQueueExt: string) => {
    await proxy('remove-queue-tier', { queue_extension: fromQueueExt, agent: agentExt });
    await proxy('add-queue-tier', { queue_extension: toQueueExt, agent: agentExt, level: 1, position: 1 });
  };

  if (!orgId) {
    return <div style={{ padding: 40, color: c.mutedSilver }}>Loading workspace…</div>;
  }

  return (
    <div style={{ padding: 24, overflow: 'auto', height: '100%', color: c.textIce }}>
      <header style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Call Queues</h2>
        <span style={{ fontSize: 11, color: c.mutedSilver }}>
          {canAdmin ? 'Admin' : canSupervise ? 'Supervisor' : meRow?.cc_role ? 'Agent' : 'View only'}
        </span>
        {error && <span style={{ fontSize: 11, color: c.danger, marginLeft: 'auto' }}>{error}</span>}
      </header>

      {/* My status */}
      {meRow && meRow.cc_role && meRow.cc_role !== 'none' && (
        <section style={{ marginBottom: 18, padding: 14, borderRadius: 12, border: `1px solid ${c.border}`, background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[meRow.cc_status || 'offline'] || '#64748b' }} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>My status: <span style={{ textTransform: 'capitalize' }}>{(meRow.cc_status || 'offline').replace('_', ' ')}</span></div>
              <div style={{ fontSize: 11, color: c.mutedSilver }}>Ext {meRow.extension} · {meRow.cc_queues?.length || 0} queue(s){meRow.cc_pause_reason ? ` · ${meRow.cc_pause_reason}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {meRow.cc_status === 'offline' && <BtnPrimary disabled={busy} onClick={() => setMyStatus('login')}>Sign in</BtnPrimary>}
              {meRow.cc_status === 'paused' && <BtnPrimary disabled={busy} onClick={() => setMyStatus('unpause')}>Resume</BtnPrimary>}
              {meRow.cc_status === 'available' && <>
                <BtnGhost disabled={busy} onClick={() => setMyStatus('pause', 'Break')}>Break</BtnGhost>
                <BtnGhost disabled={busy} onClick={() => setMyStatus('pause', 'Lunch')}>Lunch</BtnGhost>
              </>}
              {meRow.cc_status !== 'offline' && <BtnGhost disabled={busy} onClick={() => setMyStatus('logout')}>Sign out</BtnGhost>}
            </div>
          </div>
        </section>
      )}

      {/* My queues live cards */}
      {myQueues.length > 0 && (
        <section style={{ marginBottom: 22 }}>
          <h3 style={{ fontSize: 12, letterSpacing: 1.6, color: c.signalGold, textTransform: 'uppercase', margin: '0 0 8px' }}>My queues</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {myQueues.map(q => <QueueCard key={q.id} q={q} waiting={waiting[q.id] || []} stats={stats[q.pbx_uuid || q.id]} />)}
          </div>
        </section>
      )}

      {/* All queues (supervisors+) */}
      {canSupervise && (
        <section style={{ marginBottom: 22 }}>
          <h3 style={{ fontSize: 12, letterSpacing: 1.6, color: c.signalGold, textTransform: 'uppercase', margin: '0 0 8px' }}>All queues — live</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            {queues.map(q => (
              <div key={q.id} onClick={() => setSelected(selected === q.id ? null : q.id)} style={{ cursor: 'pointer' }}>
                <QueueCard q={q} waiting={waiting[q.id] || []} stats={stats[q.pbx_uuid || q.id]} highlight={selected === q.id} />
              </div>
            ))}
          </div>

          {selected && (
            <QueueDetail
              queue={queues.find(q => q.id === selected)!}
              agents={agents}
              waiting={waiting[selected] || []}
              queues={queues}
              busy={busy}
              canAdmin={canAdmin}
              onAgentAction={(action, extra) => call(action, extra)}
              onMonitor={(targetExt, mode) => call('monitor-start', { agent_extension: targetExt, monitor_type: mode, supervisor_extension: meRow?.extension })}
              onMove={moveAgent}
            />
          )}
        </section>
      )}

      {!canSupervise && myQueues.length === 0 && (
        <div style={{ padding: 28, color: c.mutedSilver, textAlign: 'center', border: `1px dashed ${c.border}`, borderRadius: 12 }}>
          You are not assigned to any call queue yet. Ask your admin to add you.
        </div>
      )}
    </div>
  );
}

function QueueCard({ q, waiting, stats, highlight }: { q: Queue; waiting: WaitingCall[]; stats: any; highlight?: boolean }) {
  return (
    <div style={{
      padding: 12, borderRadius: 12,
      border: `1px solid ${highlight ? c.signalGold : c.border}`,
      background: highlight ? 'rgba(255,230,0,0.05)' : 'rgba(255,255,255,0.02)',
      transition: 'all .15s ease',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <strong style={{ fontSize: 13 }}>{q.name}</strong>
        <span style={{ fontSize: 10, color: c.mutedSilver, fontFamily: 'monospace' }}>{q.extension}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 8 }}>
        <Stat label="Waiting" value={waiting.length} accent={waiting.length > 0 ? '#f59e0b' : undefined} />
        <Stat label="Agents" value={stats?.agents_available ?? '—'} />
        <Stat label="Answered" value={stats?.answered_today ?? '—'} />
        <Stat label="Abandoned" value={stats?.abandoned_today ?? '—'} />
      </div>
      {waiting.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {waiting.slice(0, 3).map(w => <WaitingRow key={w.id} w={w} />)}
          {waiting.length > 3 && <span style={{ fontSize: 10, color: c.mutedSilver }}>+{waiting.length - 3} more</span>}
        </div>
      )}
    </div>
  );
}

function WaitingRow({ w }: { w: WaitingCall }) {
  const [age, setAge] = useState(Date.now() - new Date(w.start_at).getTime());
  useEffect(() => {
    const t = setInterval(() => setAge(Date.now() - new Date(w.start_at).getTime()), 1000);
    return () => clearInterval(t);
  }, [w.start_at]);
  const sec = Math.floor(age / 1000);
  const mm = Math.floor(sec / 60), ss = sec % 60;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 8px', background: 'rgba(245,158,11,0.08)', borderRadius: 6 }}>
      <span style={{ fontFamily: 'monospace' }}>{w.caller_number || 'Unknown'}</span>
      <span style={{ color: c.warning, fontFamily: 'monospace' }}>{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}</span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '6px 0', background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: accent || c.textIce, fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 9, color: c.mutedSilver, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

function QueueDetail({ queue, agents, waiting, queues, busy, canAdmin, onAgentAction, onMonitor, onMove }: {
  queue: Queue; agents: AgentRow[]; waiting: WaitingCall[]; queues: Queue[]; busy: boolean; canAdmin: boolean;
  onAgentAction: (action: string, extra: any) => void;
  onMonitor: (targetExt: string, mode: 'listen' | 'whisper' | 'barge') => void;
  onMove: (agentExt: string, fromQueueExt: string, toQueueExt: string) => void;
}) {
  const queueAgents = agents.filter(a => (a.cc_queues || []).some(qx => qx === queue.extension || qx === queue.name || qx === queue.id));
  return (
    <div style={{ marginTop: 14, padding: 16, borderRadius: 12, border: `1px solid ${c.borderGold}`, background: 'rgba(255,230,0,0.03)' }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>{queue.name} · live</h4>

      {waiting.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h5 style={{ margin: '0 0 6px', fontSize: 11, color: c.signalGold, letterSpacing: 1.2, textTransform: 'uppercase' }}>Waiting calls ({waiting.length})</h5>
          {waiting.map(w => <WaitingRow key={w.id} w={w} />)}
        </div>
      )}

      <h5 style={{ margin: '0 0 6px', fontSize: 11, color: c.signalGold, letterSpacing: 1.2, textTransform: 'uppercase' }}>Agents ({queueAgents.length})</h5>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {queueAgents.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', flexWrap: 'wrap' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[a.cc_status || 'offline'] || '#64748b' }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{a.display_name || a.extension}</span>
            <span style={{ fontSize: 10, color: c.mutedSilver, fontFamily: 'monospace' }}>{a.extension}</span>
            <span style={{ fontSize: 10, color: c.mutedSilver, textTransform: 'capitalize' }}>{(a.cc_status || 'offline').replace('_', ' ')}{a.cc_pause_reason ? ` · ${a.cc_pause_reason}` : ''}</span>
            <span style={{ flex: 1 }} />
            {a.cc_status === 'on_call' && <>
              <Mini disabled={busy} onClick={() => onMonitor(a.extension, 'listen')}>Listen</Mini>
              <Mini disabled={busy} onClick={() => onMonitor(a.extension, 'whisper')}>Whisper</Mini>
              <Mini disabled={busy} onClick={() => onMonitor(a.extension, 'barge')}>Barge</Mini>
            </>}
            {a.cc_status === 'available' && <Mini disabled={busy} onClick={() => onAgentAction('agent-pause', { extension: a.extension, queue: queue.extension, reason: 'Forced' })}>Force pause</Mini>}
            {a.cc_status === 'paused' && <Mini disabled={busy} onClick={() => onAgentAction('agent-unpause', { extension: a.extension, queue: queue.extension })}>Resume</Mini>}
            {a.cc_status !== 'offline' && <Mini disabled={busy} onClick={() => onAgentAction('agent-logout', { extension: a.extension, queue: queue.extension })}>Sign out</Mini>}
            {canAdmin && (
              <select disabled={busy} defaultValue=""
                onChange={(e) => { if (e.target.value) { onMove(a.extension, queue.extension || '', e.target.value); e.target.value = ''; } }}
                style={{ fontSize: 10, padding: '3px 6px', borderRadius: 5, background: 'rgba(0,0,0,0.3)', color: c.textIce, border: `1px solid ${c.border}` }}>
                <option value="">Move to…</option>
                {queues.filter(q => q.id !== queue.id).map(q => <option key={q.id} value={q.extension || ''}>{q.name}</option>)}
              </select>
            )}
          </div>
        ))}
        {queueAgents.length === 0 && <div style={{ fontSize: 11, color: c.mutedSilver, padding: 8 }}>No agents assigned</div>}
      </div>
    </div>
  );
}

const baseBtn: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
};
function BtnPrimary(p: any) { return <button {...p} style={{ ...baseBtn, background: c.signalGold, color: '#0b1530', border: 'none' }} />; }
function BtnGhost(p: any) { return <button {...p} style={{ ...baseBtn, background: 'transparent', color: c.textIce, border: `1px solid ${c.border}` }} />; }
function Mini(p: any) { return <button {...p} style={{ ...baseBtn, fontSize: 10, padding: '3px 8px', background: 'rgba(0,35,230,0.25)', color: c.textIce, border: `1px solid ${c.border}` }} />; }
