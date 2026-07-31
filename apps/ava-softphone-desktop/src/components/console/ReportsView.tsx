import React, { useEffect, useMemo, useState } from 'react';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabaseClient';
import { ava } from '../../lib/avaApi';
import PageHeader, { EmptyState, ListSkeleton } from './PageHeader';
import { useTranslation } from '../../lib/i18n';

const { colors: c } = theme;

type Range = '24h' | '7d' | '30d';
type Row = {
  id: string;
  direction: string | null;
  extension: string | null;
  caller_number: string | null;
  destination_number: string | null;
  duration_seconds: number | null;
  billsec: number | null;
  call_status: string | null;
  missed_call: boolean | null;
  start_at: string | null;
};

function rangeStart(r: Range): string {
  const d = new Date();
  if (r === '24h') d.setHours(d.getHours() - 24);
  else if (r === '7d') d.setDate(d.getDate() - 7);
  else d.setDate(d.getDate() - 30);
  return d.toISOString();
}

export default function ReportsView() {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('7d');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const start = rangeStart(range);
      const data = await ava.scopedCallRecords(500);
      const scopedRows = (data ?? [])
        .filter((r: any) => !r.start_at || r.start_at >= start)
        .map((r: any) => ({
          id: r.id,
          direction: r.direction ?? null,
          extension: r.extension ?? null,
          caller_number: r.caller_number ?? null,
          destination_number: r.destination_number ?? r.destination ?? null,
          duration_seconds: r.duration_seconds ?? null,
          billsec: r.billsec ?? null,
          call_status: r.call_status ?? null,
          missed_call: r.missed_call ?? null,
          start_at: r.start_at ?? null,
        }));
      if (!cancelled) {
        setRows(scopedRows as Row[]);
        setLoading(false);
      }
    })().catch(() => { if (!cancelled) { setRows([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [range]);

  const metrics = useMemo(() => {
    const total = rows.length;
    const answered = rows.filter((r) => !r.missed_call && (r.billsec ?? 0) > 0).length;
    const missed = rows.filter((r) => r.missed_call).length;
    const inbound = rows.filter((r) => r.direction === 'inbound').length;
    const outbound = rows.filter((r) => r.direction === 'outbound').length;
    const totalSec = rows.reduce((s, r) => s + (r.billsec ?? r.duration_seconds ?? 0), 0);
    const avg = answered ? Math.round(totalSec / answered) : 0;
    const byExt: Record<string, number> = {};
    rows.forEach((r) => { const k = r.extension ?? '—'; byExt[k] = (byExt[k] ?? 0) + 1; });
    const top = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { total, answered, missed, inbound, outbound, totalSec, avg, top };
  }, [rows]);

  const fmtDur = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const runAi = async () => {
    setAiLoading(true);
    setAiSummary('');
    try {
      const { data, error } = await supabase.functions.invoke('telecom-admin-ai-agent', {
        body: {
          mode: 'propose',
          prompt: `Analyze these telecom KPIs for the last ${range} and give an executive summary in 3 bullets:
total=${metrics.total}, answered=${metrics.answered}, missed=${metrics.missed},
inbound=${metrics.inbound}, outbound=${metrics.outbound},
avg_call_sec=${metrics.avg}, total_talk_sec=${metrics.totalSec},
top_extensions=${metrics.top.map(([e, n]) => `${e}:${n}`).join(', ')}.
Focus on missed-call rate, busiest extensions, and one concrete improvement.`,
        },
      });
      if (error) throw error;
      const a = (data as any)?.action;
      setAiSummary(a?.execution_result_json?.info || a?.proposed_changes_json?.human_summary || 'No summary returned.');
    } catch (e) {
      setAiSummary(`AI unavailable: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div style={{ padding: '24px 28px', overflowY: 'auto', height: '100%' }}>
      <PageHeader
        eyebrow={t('reports.eyebrow')}
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        accent={c.avaCyan}
      />

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['24h', '7d', '30d'] as Range[]).map((r) => (
          <button key={r} onClick={() => setRange(r)} style={{
            padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
            background: range === r ? 'rgba(35,214,255,0.12)' : 'transparent',
            border: `1px solid ${range === r ? c.borderAI : c.border}`,
            color: range === r ? c.avaCyan : c.mutedSilver,
            fontSize: 11, fontWeight: 700, letterSpacing: 1,
          }}>{r.toUpperCase()}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={runAi} disabled={aiLoading || loading || rows.length === 0} style={{
          padding: '8px 14px', borderRadius: 10,
          background: `linear-gradient(135deg, ${c.avaViolet}, ${c.avaCyan})`,
          border: 'none', color: c.onAccent, fontSize: 12, fontWeight: 700,
          cursor: aiLoading ? 'wait' : 'pointer', opacity: aiLoading ? 0.6 : 1,
        }}>{aiLoading ? t('reports.generating') : `✨ ${t('reports.avaSummary')}`}</button>
      </div>

      {loading && <ListSkeleton rows={4} />}
      {!loading && rows.length === 0 && (
        <EmptyState icon="📊" title={t('reports.noCalls')} hint={t('reports.noCallsHint')} accent={c.avaCyan} />
      )}

      {!loading && rows.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
            <Stat label={t('reports.totalCalls')} value={metrics.total} />
            <Stat label={t('reports.answered')} value={metrics.answered} accent={c.success} />
            <Stat label={t('reports.missed')} value={metrics.missed} accent={c.danger} />
            <Stat label={t('reports.inbound')} value={metrics.inbound} />
            <Stat label={t('reports.outbound')} value={metrics.outbound} />
            <Stat label={t('reports.avgDuration')} value={fmtDur(metrics.avg)} />
            <Stat label={t('reports.totalTalk')} value={fmtDur(metrics.totalSec)} accent={c.signalGold} />
          </div>

          {aiSummary && (
            <div style={{
              padding: 14, borderRadius: 12, marginBottom: 18,
              background: 'linear-gradient(135deg, rgba(122,76,255,0.10), rgba(35,214,255,0.04))',
              border: `1px solid ${c.borderAI}`,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: c.avaCyan, textTransform: 'uppercase', marginBottom: 6 }}>{t('reports.avaSummary')}</div>
              <p style={{ fontSize: 12.5, lineHeight: 1.55, color: c.textIce, margin: 0, whiteSpace: 'pre-wrap' }}>{aiSummary}</p>
            </div>
          )}

          <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${c.border}`, background: c.deepPanel, fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: c.mutedSilver, textTransform: 'uppercase' }}>
              {t('reports.topExtensions')}
            </div>
            {metrics.top.map(([ext, count]) => (
              <div key={ext} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${c.border}`, fontSize: 12.5, color: c.textIce }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{ext}</span>
                <span style={{ color: c.mutedSilver }}>{count} {t('reports.calls')}</span>
              </div>
            ))}
          </div>

          <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${c.border}`, background: c.deepPanel, fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: c.mutedSilver, textTransform: 'uppercase' }}>
              {t('reports.recentCalls')}
            </div>
            {rows.slice(0, 25).map((r) => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 90px 90px 70px', padding: '9px 14px', borderBottom: `1px solid ${c.border}`, fontSize: 12, color: c.textIce, alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9.5, padding: '2px 6px', borderRadius: 4, background: c.overlay04, color: r.direction === 'inbound' ? c.avaCyan : c.signalGold, textAlign: 'center', fontWeight: 700, letterSpacing: 0.5 }}>{r.direction ?? '—'}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.caller_number ?? '—'} → {r.destination_number ?? '—'}</span>
                <span style={{ color: c.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>{fmtDur(r.billsec ?? r.duration_seconds ?? 0)}</span>
                <span style={{ color: r.missed_call ? c.danger : c.success, fontSize: 11 }}>{r.missed_call ? 'missed' : (r.call_status ?? 'ok')}</span>
                <span style={{ color: c.mutedSilver, fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>{r.start_at ? new Date(r.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div style={{ padding: 14, borderRadius: 12, background: c.bgCard, border: `1px solid ${c.border}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: c.mutedSilver, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? c.textIce, marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
    </div>
  );
}
