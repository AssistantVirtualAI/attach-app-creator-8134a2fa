import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { ava } from '../lib/avaApi';
import { theme } from '../lib/theme';
import TranscriptionStatusPanel from './TranscriptionStatusPanel';

const { colors: c, glow } = theme;
const LEMTEL_ORG = '71755d33-ed64-4ad5-a828-61c9d2029eb7';

interface CallRec {
  id: string;
  organization_id?: string | null;
  caller_number?: string | null;
  caller_name?: string | null;
  destination_number?: string | null;
  start_at?: string | null;
  duration_seconds?: number | null;
  billsec?: number | null;
  transcribed?: boolean | null;
  has_recording?: boolean | null;
  analyzed?: boolean | null;
  voicemail_message?: string | null;
  transcript_text?: string | null;
  raw_data?: any;
}

function getAi(r: CallRec) {
  return r.raw_data?.ai || r.raw_data || {};
}

function displayError(e: any) {
  const raw = e?.context?.error || e?.message || e?.details || e?.error || 'AI analysis is unavailable right now.';
  const text = String(raw);
  if (/MISSING_SECRET/i.test(text)) return 'AI analysis is not configured yet. Test the AI connection or contact an administrator.';
  if (/Unauthorized|Forbidden/i.test(text)) return 'You do not have permission to run AI analysis for these calls.';
  if (/required fields missing/i.test(text)) return 'AI analysis needs a call record, organization, and transcript before it can run.';
  if (/service error/i.test(text)) return 'The AI analysis service did not respond successfully. Try again later.';
  return text;
}

function transcriptOf(r: CallRec) {
  return String(r.transcript_text || r.raw_data?.transcript_text || r.raw_data?.transcript || r.voicemail_message || '').trim();
}

async function deriveOrgId(r?: CallRec) {
  if (r?.organization_id) return r.organization_id;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return LEMTEL_ORG;
  const { data: member } = await supabase.from('organization_members' as any).select('organization_id').eq('user_id', user.id).limit(1).maybeSingle();
  if ((member as any)?.organization_id) return (member as any).organization_id;
  const { data: orgMember } = await supabase.from('org_members' as any).select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
  return (orgMember as any)?.org_id || LEMTEL_ORG;
}

export default function AIInsights() {
  const [items, setItems] = useState<CallRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionNote, setConnectionNote] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState<number>(7);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<any | null>(null);
  const [narrativeBusy, setNarrativeBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await ava.scopedCallRecords(100);
      setItems((data || []) as any[]);
    } catch (e: any) {
      setError(e?.message || 'Unable to load AI insights for your extension.');
      setItems([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const generateNarrative = useCallback(async () => {
    setNarrativeBusy(true); setError(null); setNarrative(null); setAggregate(null);
    try {
      const organizationId = await deriveOrgId(items[0]);
      const { data, error } = await supabase.functions.invoke('ai-period-insights', {
        body: { organizationId, days: periodDays },
      });
      if (error) throw error;
      setNarrative(String((data as any)?.narrative || '').trim());
      setAggregate((data as any)?.aggregate || null);
    } catch (e: any) {
      setError(displayError(e));
    } finally {
      setNarrativeBusy(false);
    }
  }, [items, periodDays]);


  const analyzeAll = async () => {
    const pending = items.filter(r => (r.has_recording || (r as any).recording_url || (r as any).recording_path) && !r.analyzed);
    if (pending.length === 0) { setError('No transcript available for AI analysis yet'); return; }
    setWorking(true); setError(null);
    try {
      for (const r of pending.slice(0, 10)) {
        const organization_id = await deriveOrgId(r);
        let transcript_text = transcriptOf(r);
        if (!transcript_text) {
          const t = await supabase.functions.invoke('ai-transcribe-call', {
            body: { call_record_id: r.id, organization_id },
          });
          if (t.error) throw t.error;
          transcript_text = String((t.data as any)?.transcript_text || '').trim();
        }
        if (!transcript_text) {
          setError('No transcript available for AI analysis yet');
          continue;
        }
        const a = await supabase.functions.invoke('ai-analyze-call', {
          body: { call_record_id: r.id, transcript_text, organization_id },
        });
        if (a.error) throw a.error;
      }
      await load();
    } catch (e: any) {
      setError(displayError(e));
    } finally {
      setWorking(false);
    }
  };

  const testConnection = async () => {
    setConnectionNote('Testing AI connection…'); setError(null);
    try {
      const res = await supabase.functions.invoke('ai-analyze-call', { body: { action: 'test' } });
      const data: any = res.data || {};
      if (res.error) throw res.error;
      setConnectionNote(data.status === 'ok' ? `AI connected · ${data.latency_ms ?? 0}ms` : displayError(data));
    } catch (e: any) {
      setConnectionNote(displayError(e));
    }
  };

  const analyzed = items.filter(r => r.analyzed || r.transcribed);

  // Aggregate
  const sentiments = { positive: 0, neutral: 0, negative: 0 };
  const topicCounts: Record<string, number> = {};
  const allActions: { id: string; action: string; when?: string }[] = [];
  for (const r of analyzed) {
    const ai = getAi(r);
    const s = (ai?.sentiment || '').toLowerCase();
    if (s.includes('positive')) sentiments.positive++;
    else if (s.includes('negative')) sentiments.negative++;
    else sentiments.neutral++;
    (Array.isArray(ai?.topics) ? ai.topics : []).forEach((t: string) => {
      topicCounts[t] = (topicCounts[t] || 0) + 1;
    });
    (Array.isArray(ai?.action_items) ? ai.action_items : []).forEach((a: string) => {
      allActions.push({ id: r.id, action: a, when: r.start_at || undefined });
    });
  }
  const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const total = analyzed.length || 1;

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: c.textSub }}>Loading insights…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ ...theme.glass.cardAI, padding: 14, boxShadow: glow.ai }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: c.aiLight, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700 }}>
              ✨ AI Insights
            </div>
            <div style={{ fontSize: 10, color: c.textSub, marginTop: 2 }}>
              {analyzed.length} analyzed / {items.length} total calls
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={testConnection} style={{ padding: '6px 12px', borderRadius: 8, background: 'transparent', border: `1px solid ${c.borderAI}`, color: c.aiLight, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Test AI connection</button>
            <button
              onClick={analyzeAll}
              disabled={working}
              style={{
                padding: '6px 12px', borderRadius: 8,
                background: working ? 'rgba(124,58,237,0.3)' : c.ai,
                border: 'none', color: c.onAccent, fontSize: 11, fontWeight: 600,
                cursor: working ? 'wait' : 'pointer', boxShadow: glow.ai,
              }}
            >
              {working ? 'Analyzing…' : '✨ Analyze pending'}
            </button>
          </div>
        </div>
      </div>

      {connectionNote && <div style={{ padding: 10, background: 'rgba(124,58,237,0.10)', color: c.aiLight, fontSize: 11, borderRadius: 8 }}>{connectionNote}</div>}

      {error && (
        <div style={{ padding: 10, background: 'rgba(239,68,68,0.10)', color: c.red, fontSize: 11, borderRadius: 8 }}>
          {error}
        </div>
      )}

      <TranscriptionStatusPanel />


      {/* AI-generated period narrative */}
      <div style={{ ...theme.glass.cardAI, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: c.aiLight, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700 }}>
              ✨ Executive narrative
            </div>
            <div style={{ fontSize: 10, color: c.textSub, marginTop: 2 }}>
              AI-written summary of the last {periodDays} days · real call data
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} style={{
              padding: '6px 8px', borderRadius: 8, background: c.bgCard, border: `1px solid ${c.borderAI}`,
              color: c.textIce, fontSize: 11, outline: 'none',
            }}>
              <option value={1}>24 h</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
            <button onClick={generateNarrative} disabled={narrativeBusy} style={{
              padding: '6px 12px', borderRadius: 8,
              background: narrativeBusy ? 'rgba(124,58,237,0.3)' : c.ai,
              border: 'none', color: c.onAccent, fontSize: 11, fontWeight: 700,
              cursor: narrativeBusy ? 'wait' : 'pointer', boxShadow: glow.ai,
            }}>{narrativeBusy ? 'Generating…' : 'Generate'}</button>
          </div>
        </div>
        {aggregate && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10.5, color: c.textSub, marginBottom: 8 }}>
            <span>📞 {aggregate.totalCalls} calls</span>
            <span>↘️ {aggregate.inbound} in</span>
            <span>↗️ {aggregate.outbound} out</span>
            <span style={{ color: c.red }}>✕ {aggregate.missed} missed</span>
            <span>⏱ avg {Math.round((aggregate.avgDurSec || 0))}s</span>
          </div>
        )}
        {narrative ? (
          <div style={{ fontSize: 12.5, color: c.textIce, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{narrative}</div>
        ) : (
          <div style={{ fontSize: 11.5, color: c.textSub, fontStyle: 'italic' }}>
            Click <strong style={{ color: c.aiLight }}>Generate</strong> to produce an AI narrative from your real call data.
          </div>
        )}
      </div>


      {analyzed.length === 0 ? (
        <div style={{ ...theme.glass.card, padding: 30, textAlign: 'center', color: c.textSub, fontSize: 12 }}>
          No analyzed calls yet. Click <strong style={{ color: c.aiLight }}>Analyze pending</strong> above
          or analyze individual recordings in the Recordings tab.
        </div>
      ) : (
        <>
          {/* Sentiment */}
          <div style={{ ...theme.glass.card, padding: 12 }}>
            <div style={{ fontSize: 10, color: c.textSub, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Sentiment breakdown
            </div>
            <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: c.overlay04 }}>
              <div style={{ width: `${(sentiments.positive / total) * 100}%`, background: c.green }} />
              <div style={{ width: `${(sentiments.neutral / total) * 100}%`, background: c.yellow }} />
              <div style={{ width: `${(sentiments.negative / total) * 100}%`, background: c.red }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: c.textSub }}>
              <span style={{ color: c.green }}>● {sentiments.positive} positive</span>
              <span style={{ color: c.yellow }}>● {sentiments.neutral} neutral</span>
              <span style={{ color: c.red }}>● {sentiments.negative} negative</span>
            </div>
          </div>

          {/* Topics */}
          {topTopics.length > 0 && (
            <div style={{ ...theme.glass.card, padding: 12 }}>
              <div style={{ fontSize: 10, color: c.textSub, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Top topics
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {topTopics.map(([t, n]) => (
                  <span key={t} style={{
                    padding: '4px 8px', borderRadius: 999,
                    background: 'rgba(124,58,237,0.12)', border: `1px solid ${c.borderAI}`,
                    color: c.aiLight, fontSize: 10, fontWeight: 600,
                  }}>
                    {t} <span style={{ opacity: 0.6 }}>×{n}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action items */}
          {allActions.length > 0 && (
            <div style={{ ...theme.glass.card, padding: 12 }}>
              <div style={{ fontSize: 10, color: c.textSub, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Action items ({allActions.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                {allActions.slice(0, 30).map((a, i) => (
                  <div key={i} style={{
                    padding: '6px 8px', borderRadius: 8,
                    background: 'rgba(255,215,0,0.06)', border: `1px solid ${c.borderGold}`,
                    fontSize: 11, color: c.text,
                  }}>
                    <span style={{ color: c.gold, marginRight: 6 }}>◆</span>
                    {a.action}
                    {a.when && <div style={{ fontSize: 9, color: c.textDim, marginTop: 2 }}>{new Date(a.when).toLocaleDateString()}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
