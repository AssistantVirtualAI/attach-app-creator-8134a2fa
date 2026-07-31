import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { theme } from '../lib/theme';

const { colors: c } = theme;

type AuditRow = {
  id: string;
  created_at: string;
  request_type: string;
  status: string;
  error_code: string | null;
  http_status: number | null;
  message: string | null;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
};

const STATUS_META: Record<string, { label: string; tone: string; hint: string }> = {
  ok:             { label: 'AI ready',         tone: '#3fce8c', hint: 'Transcript + analysis succeeded.' },
  'no-audio':     { label: 'No audio',         tone: '#ffd000', hint: 'The recording could not be retrieved from the PBX or storage. CDR sync may still be pending.' },
  'no-transcript':{ label: 'No transcript',    tone: '#ffd000', hint: 'No transcript was available to analyze. Try transcription first.' },
  'missing-key':  { label: 'Missing AI key',   tone: '#ff9a3c', hint: 'The Lovable AI key is not configured for this workspace. Ask an administrator.' },
  'ai-error':     { label: 'AI provider error', tone: c.danger, hint: 'The AI provider returned an error. See the error code below.' },
  forbidden:      { label: 'Forbidden',        tone: '#b388ff', hint: 'You do not have access to run AI for this organization.' },
  'bad-request':  { label: 'Bad request',      tone: c.danger, hint: 'Required fields were missing from the request.' },
  error:          { label: 'Error',            tone: c.danger, hint: 'Unexpected error — see the error code below.' },
  timeout:        { label: 'Timeout',          tone: '#ff9a3c', hint: 'The AI provider did not respond in time.' },
};

export default function TranscriptionStatusPanel({ callRecordId, compact }: { callRecordId?: string | null; compact?: boolean }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      let q = supabase.from('ai_request_audit_log' as any)
        .select('*')
        .in('request_type', ['transcribe', 'analyze'] as any)
        .order('created_at', { ascending: false })
        .limit(callRecordId ? 8 : 12);
      if (callRecordId) q = q.eq('call_record_id', callRecordId);
      const { data } = await q;
      setRows((data || []) as any);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [callRecordId]);

  const transcribe = rows.find(r => r.request_type === 'transcribe');
  const analyze = rows.find(r => r.request_type === 'analyze');

  return (
    <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, padding: compact ? 10 : 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: c.textSub, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
          Transcription status {callRecordId && <span style={{ color: c.mutedSilver }}>· #{String(callRecordId).slice(0, 10)}</span>}
        </div>
        <button onClick={load} disabled={loading} style={{ background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce, fontSize: 10, padding: '4px 9px', borderRadius: 7, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>↻ {loading ? '…' : 'Refresh'}</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <StatusCell title="Transcription" row={transcribe} />
        <StatusCell title="AI analysis"   row={analyze} />
      </div>
      {rows.length > 0 && !compact && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11, color: c.mutedSilver }}>Recent attempts ({rows.length})</summary>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
            {rows.map(r => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '130px 80px 90px 1fr', gap: 6, fontSize: 10.5, color: c.textSub, padding: '4px 0', borderBottom: `1px dashed ${c.border}` }}>
                <span style={{ color: c.mutedSilver }}>{new Date(r.created_at).toLocaleTimeString()}</span>
                <span style={{ color: c.aiLight || c.textIce, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{r.request_type}</span>
                <span style={{ color: (STATUS_META[r.status]?.tone) || c.mutedSilver, fontWeight: 700, textTransform: 'uppercase' }}>{r.status}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.error_code || r.message || '—'}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function StatusCell({ title, row }: { title: string; row?: AuditRow }) {
  const meta = row ? STATUS_META[row.status] || { label: row.status, tone: '#8aa0c8', hint: '' } : null;
  return (
    <div style={{ padding: 10, borderRadius: 10, border: `1px solid ${c.border}`, background: c.overlay02 }}>
      <div style={{ fontSize: 10, color: c.mutedSilver, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 }}>{title}</div>
      {!row ? (
        <div style={{ fontSize: 11, color: c.mutedSilver }}>No attempts yet.</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: meta!.tone, boxShadow: `0 0 8px ${meta!.tone}` }} />
            <span style={{ fontSize: 12, color: c.textIce, fontWeight: 700 }}>{meta!.label}</span>
            {row.http_status && <span style={{ fontSize: 9, color: c.mutedSilver, fontFamily: 'Fira Code, monospace' }}>HTTP {row.http_status}</span>}
          </div>
          {row.error_code && <div style={{ fontSize: 10.5, color: c.danger, fontFamily: 'Fira Code, monospace', marginBottom: 4 }}>code: {row.error_code}</div>}
          {meta!.hint && <div style={{ fontSize: 10.5, color: c.textSub, lineHeight: 1.4 }}>{meta!.hint}</div>}
          {row.message && <div style={{ fontSize: 10, color: c.mutedSilver, marginTop: 4 }}>{row.message.slice(0, 160)}</div>}
          <div style={{ fontSize: 9.5, color: c.mutedSilver, marginTop: 4 }}>{new Date(row.created_at).toLocaleString()}{row.latency_ms ? ` · ${row.latency_ms}ms` : ''}{row.model ? ` · ${row.model}` : ''}</div>
        </>
      )}
    </div>
  );
}
