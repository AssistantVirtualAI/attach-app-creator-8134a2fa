import React, { useEffect, useMemo, useState } from 'react';
import { theme } from '../../lib/theme';
import { ava } from '../../lib/avaApi';
import { supabase } from '../../lib/supabaseClient';
import PageHeader from './PageHeader';
import AIInsights from '../AIInsights';
import SkeletonRows from '../ui/SkeletonRows';

const { colors: c } = theme;

type Module = 'intelligence' | 'transcripts' | 'greetings' | 'queues' | 'agents' | 'coaching';

const MODULES: { id: Module; label: string; desc: string; accent: string }[] = [
  { id: 'intelligence', label: 'Call Intelligence', desc: 'Summaries, sentiment, topics, action items, risks, opportunities.', accent: '#7A4CFF' },
  { id: 'transcripts',  label: 'Transcript Search', desc: 'Search across calls and messages by intent, topic, or keyword.', accent: '#23D6FF' },
  { id: 'greetings',    label: 'Greeting Studio', desc: 'Generate IVR / voicemail / queue greetings through AVA + ElevenLabs.', accent: '#FFE600' },
  { id: 'queues',       label: 'Queue Optimizer', desc: 'Recommendations for strategy, overflow, staffing, hold messaging.', accent: '#28E6A5' },
  { id: 'agents',       label: 'Voice Agent Manager', desc: 'Assign AVA voice agents to numbers, IVRs, queues, after-hours.', accent: '#FF4D67' },
  { id: 'coaching',     label: 'Coaching Insights', desc: 'Missed opportunities, escalations, objections, quality issues.', accent: '#FFCC33' },
];

export default function AIWorkspace() {
  const [active, setActive] = useState<Module>('intelligence');
  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto', animation: 'fadeIn .3s ease-out' }}>
      <PageHeader
        eyebrow="Powered by AVA AI"
        title="AI Workspace"
        subtitle="Intelligence, automation, and voice-agent control for your communications."
        accent={c.avaViolet}
        icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 2l1.8 4.5L18 8l-4.2 1.5L12 14l-1.8-4.5L6 8l4.2-1.5L12 2z"/><path d="M18 14l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/></svg>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 22 }}>
        {MODULES.map((m) => (
          <button key={m.id} onClick={() => setActive(m.id)} style={{
            textAlign: 'left', padding: 16, borderRadius: 14,
            background: active === m.id ? `linear-gradient(135deg, ${m.accent}1c, transparent)` : c.bgCard,
            border: `1px solid ${active === m.id ? m.accent + '60' : c.border}`,
            cursor: 'pointer', color: c.textIce, transition: 'all 160ms ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.accent, boxShadow: `0 0 10px ${m.accent}` }} />
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{m.label}</span>
            </div>
            <p style={{ fontSize: 11.5, color: c.mutedSilver, margin: 0, lineHeight: 1.5 }}>{m.desc}</p>
          </button>
        ))}
      </div>

      <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 14, padding: 22 }}>
        {active === 'intelligence' && <Intelligence />}
        {active === 'transcripts' && <Transcripts />}
        {active === 'greetings' && <Greetings />}
        {active === 'queues' && <QueueOptimizer />}
        {active === 'agents' && <VoiceAgentManager />}
        {active === 'coaching' && <CoachingInsights />}
      </div>
    </div>
  );
}

function Intelligence() {
  return <AIInsights />;
}

function Transcripts() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      const query = q.trim();
      if (!query) { setRows([]); return; }
      setLoading(true);
      const all = await ava.scopedCallRecords(100);
      const needle = query.toLowerCase();
      const data = (all as any[]).filter((r) => {
        const haystack = [
          r.transcript_text,
          r.raw_data?.transcript_text,
          r.raw_data?.transcript,
          r.caller_number,
          r.destination_number,
          r.destination,
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(needle);
      }).slice(0, 30);
      setRows(data || []);
      setLoading(false);
    }, 280);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transcripts by intent, topic, customer…" style={{
        width: '100%', boxSizing: 'border-box', padding: '11px 14px', borderRadius: 10,
        background: c.midnight, border: `1px solid ${c.borderAI}`, color: c.textIce, fontSize: 13, outline: 'none', marginBottom: 14,
      }} />
      {!q.trim() && <div style={{ fontSize: 12, color: c.mutedSilver }}>Type a query to search across all call transcripts.</div>}
      {loading && <div style={{ fontSize: 12, color: c.mutedSilver }}>Searching…</div>}
      {!loading && q.trim() && rows.length === 0 && <div style={{ fontSize: 12, color: c.mutedSilver }}>No matches.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => {
          const txt = String(r.transcript_text || r.raw_data?.transcript_text || '').trim();
          const idx = txt.toLowerCase().indexOf(q.toLowerCase());
          const snippet = idx >= 0 ? '…' + txt.slice(Math.max(0, idx - 40), idx + 120) + '…' : txt.slice(0, 160);
          return (
            <div key={r.id} style={{ padding: 10, borderRadius: 10, background: c.midnight, border: `1px solid ${c.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: c.mutedSilver }}>
                <span>{r.caller_number} → {r.destination_number}</span>
                <span>{r.start_at ? new Date(r.start_at).toLocaleString() : ''}</span>
              </div>
              <div style={{ fontSize: 12, color: c.textIce, marginTop: 4, lineHeight: 1.5 }}>{snippet || '(no transcript)'}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Greetings() {
  const [prompt, setPrompt] = useState('Friendly after-hours greeting for our sales line');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    setBusy(true);
    const r = await ava.generateGreeting(prompt);
    setOut(r.text);
    setBusy(false);
  };
  return (
    <>
      <label style={{ fontSize: 11, color: c.mutedSilver, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Describe the greeting</label>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} style={{
        width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 10, marginTop: 6,
        background: c.midnight, border: `1px solid ${c.border}`, color: c.textIce, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', outline: 'none',
      }} />
      <button onClick={gen} disabled={busy} style={{
        marginTop: 10, padding: '10px 18px', borderRadius: 10,
        background: `linear-gradient(135deg, ${c.avaViolet}, ${c.avaCyan})`,
        border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
      }}>{busy ? 'Generating…' : '✨ Generate with AVA'}</button>
      {out && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: c.midnight, border: `1px solid ${c.borderAI}` }}>
          <div style={{ fontSize: 10, color: c.avaCyan, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Generated Script</div>
          <p style={{ fontSize: 13, color: c.textIce, lineHeight: 1.6, margin: 0 }}>{out}</p>
        </div>
      )}
    </>
  );
}

function fmtDur(sec: number) {
  if (!sec || sec < 60) return `${Math.round(sec || 0)}s`;
  const m = Math.floor(sec / 60); const s = Math.round(sec % 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function QueueOptimizer() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: queues }, { data: stats }] = await Promise.all([
        supabase.from('pbx_call_queues' as any).select('id, queue_name, strategy, extension').limit(50),
        supabase.from('cc_queue_stats' as any).select('*').gte('stat_date', since).limit(500),
      ]);
      const byQueue: Record<string, any> = {};
      for (const s of (stats as any[]) || []) {
        const k = s.queue_id || s.queue_name || 'unknown';
        if (!byQueue[k]) byQueue[k] = { wait: 0, n: 0, sla: 0, abandon: 0, calls: 0 };
        byQueue[k].wait += Number(s.avg_wait_seconds || s.average_wait_time || 0);
        byQueue[k].sla += Number(s.sla_percentage || s.service_level || 0);
        byQueue[k].abandon += Number(s.abandoned_calls || 0);
        byQueue[k].calls += Number(s.total_calls || s.calls_offered || 0);
        byQueue[k].n += 1;
      }
      const out = ((queues as any[]) || []).map((q) => {
        const k = q.id || q.queue_name;
        const a = byQueue[k] || { wait: 0, n: 1, sla: 0, abandon: 0, calls: 0 };
        const avgWait = a.wait / Math.max(a.n, 1);
        const sla = Math.round(a.sla / Math.max(a.n, 1));
        let rec = 'Performance within target.';
        if (avgWait > 60) rec = `Wait > ${fmtDur(avgWait)} — add an agent or enable overflow.`;
        else if (sla > 0 && sla < 80) rec = `SLA ${sla}% under target — review routing strategy (${q.strategy || 'n/a'}).`;
        else if (a.abandon > a.calls * 0.15 && a.calls > 0) rec = `Abandonment ${Math.round((a.abandon / a.calls) * 100)}% — enable callback option.`;
        return { name: q.queue_name || q.extension, wait: fmtDur(avgWait), sla, rec };
      });
      setRows(out);
      setLoading(false);
    })();
  }, []);
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.success, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>Last 30 days</div>
      {loading && <SkeletonRows rows={3} padding={8} label="Loading queue stats" />}
      {!loading && rows.length === 0 && <div style={{ fontSize: 12, color: c.mutedSilver }}>No queues found.</div>}
      {rows.map((r, i) => (
        <div key={i} style={{ padding: '12px 0', borderBottom: `1px solid ${c.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: c.textIce }}>{r.name}</div>
            <div style={{ fontSize: 11, color: c.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>avg wait {r.wait} · SLA {r.sla}%</div>
          </div>
          <div style={{ fontSize: 12, color: c.success, marginTop: 4 }}>↳ {r.rec}</div>
        </div>
      ))}
    </>
  );
}

function VoiceAgentManager() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('voice_agent_bindings' as any)
        .select('id, agent_name, voice_name, bound_to_type, bound_to_value, is_active')
        .order('created_at', { ascending: false })
        .limit(30);
      if (data && data.length) { setAgents(data as any[]); setLoading(false); return; }
      const { data: la } = await supabase
        .from('lemtel_voice_agents' as any)
        .select('id, name, voice_id, phone_numbers, is_active')
        .limit(30);
      setAgents(((la as any[]) || []).map((a) => ({
        id: a.id, agent_name: a.name, voice_name: a.voice_id,
        bound_to_value: Array.isArray(a.phone_numbers) ? a.phone_numbers.join(', ') : '',
        is_active: a.is_active,
      })));
      setLoading(false);
    })();
  }, []);
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: c.danger, letterSpacing: 1.5, textTransform: 'uppercase' }}>Active voice agents</div>
      </div>
      {loading && <SkeletonRows rows={3} padding={8} label="Loading voice agents" />}
      {!loading && agents.length === 0 && <div style={{ fontSize: 12, color: c.mutedSilver }}>No voice agents configured yet.</div>}
      {agents.map((a) => (
        <div key={a.id} style={{ padding: 12, marginBottom: 8, borderRadius: 10, background: c.midnight, border: `1px solid ${c.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: c.textIce }}>{a.agent_name}</div>
            <div style={{ fontSize: 10.5, color: c.mutedSilver }}>{a.voice_name || '—'}</div>
          </div>
          <div style={{ fontSize: 11, color: c.avaCyan, marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>
            {a.bound_to_type ? `${a.bound_to_type} → ${a.bound_to_value}` : (a.bound_to_value || '—')}
            {!a.is_active && <span style={{ color: c.mutedSilver, marginLeft: 8 }}>(inactive)</span>}
          </div>
        </div>
      ))}
    </>
  );
}

function CoachingInsights() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('pbx_ai_insights' as any)
        .select('id, insight_type, title, description, severity, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20);
      setItems((data as any[]) || []);
      setLoading(false);
    })();
  }, []);
  const tone = (sev?: string) => sev === 'high' ? '#FF4D67' : sev === 'medium' ? '#FFCC33' : '#23D6FF';
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.signalGold, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>This week</div>
      {loading && <SkeletonRows rows={3} padding={8} label="Loading insights" />}
      {!loading && items.length === 0 && <div style={{ fontSize: 12, color: c.mutedSilver }}>No AI insights generated this week. Analyze more calls to surface coaching opportunities.</div>}
      {items.map((r) => (
        <div key={r.id} style={{ padding: '12px 0', borderBottom: `1px solid ${c.border}`, display: 'flex', gap: 14 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: tone(r.severity), letterSpacing: 1.5, minWidth: 90, paddingTop: 2 }}>{(r.insight_type || 'INSIGHT').toUpperCase()}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, color: c.textIce }}>{r.title}</div>
            <div style={{ fontSize: 12, color: c.mutedSilver, marginTop: 2 }}>{r.description}</div>
          </div>
        </div>
      ))}
    </>
  );
}


function PlaceholderModule({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ padding: '20px 4px', textAlign: 'center' }}>
      <h3 style={{ fontSize: 16, color: c.textIce, margin: '0 0 6px' }}>{title}</h3>
      <p style={{ fontSize: 12, color: c.mutedSilver, margin: 0 }}>{hint}</p>
    </div>
  );
}
