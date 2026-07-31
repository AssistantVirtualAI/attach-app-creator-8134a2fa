import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import SkeletonRows from './ui/SkeletonRows';

interface AuditEntry {
  id: string; run_id: string; event: string; status: string;
  pipeline: string | null; ai_model: string | null; forced: boolean;
  duration_ms: number | null; error: string | null; created_at: string;
}

interface Intel {
  status: string;
  analysisStatus: "queued" | "processing" | "analyzed" | "pending_sync" | "missing" | "failed";
  transcript: string | null;
  summary: string | null;
  sentiment: string | null;
  satisfaction_score: number | null;
  quality_score: number | null;
  coaching_score: number | null;
  coaching_notes: string[];
  action_items: string[];
  topics: string[];
  intent: string | null;
  escalation_needed: boolean;
  skipped_reason: string | null;
  outputs_present: { transcript: boolean; insight: boolean };
  last_processed_at: string | null;
  audit: AuditEntry[];
}

const EMPTY: Intel = {
  status: "missing", analysisStatus: "missing",
  transcript: null, summary: null, sentiment: null,
  satisfaction_score: null, quality_score: null, coaching_score: null,
  coaching_notes: [], action_items: [], topics: [], intent: null, escalation_needed: false,
  skipped_reason: null, outputs_present: { transcript: false, insight: false },
  last_processed_at: null, audit: [],
};

async function fetchAudit(callId: string): Promise<AuditEntry[]> {
  const { data } = await supabase.from("call_intelligence_audit").select("*")
    .eq("call_record_id", callId).order("created_at", { ascending: false }).limit(20);
  return (data as any[]) ?? [];
}

async function loadCached(callId: string): Promise<Intel | null> {
  const [{ data: insight }, { data: tr }, audit] = await Promise.all([
    supabase.from("pbx_ai_insights").select("*").eq("call_record_id", callId).maybeSingle(),
    supabase.from("pbx_call_transcripts").select("transcript_text").eq("call_record_id", callId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    fetchAudit(callId),
  ]);
  if (!insight || !(tr as any)?.transcript_text) return null;
  const i: any = insight;
  return {
    ...EMPTY,
    status: "cached", analysisStatus: "analyzed",
    transcript: (tr as any).transcript_text,
    summary: i.summary, sentiment: i.sentiment,
    satisfaction_score: i.satisfaction_score, quality_score: i.quality_score,
    coaching_score: i.coaching_score, coaching_notes: i.coaching_notes ?? [],
    action_items: i.action_items ?? [], topics: i.topics ?? [],
    intent: i.intent, escalation_needed: i.escalation_needed ?? false,
    outputs_present: { transcript: true, insight: true },
    last_processed_at: i.created_at ?? null,
    skipped_reason: "Cached — transcript and AI insight already exist for this recording.",
    audit,
  };
}

const STATUS_STYLE: Record<Intel["analysisStatus"], { bg: string; color: string; label: string }> = {
  queued:       { bg: "rgba(148,163,184,0.15)", color: "#94a3b8", label: "Queued" },
  processing:   { bg: "rgba(59,130,246,0.15)",  color: "#3b82f6", label: "Processing" },
  analyzed:     { bg: "rgba(16,185,129,0.15)",  color: "#10b981", label: "Analyzed" },
  pending_sync: { bg: "rgba(245,158,11,0.15)",  color: "#f59e0b", label: "Pending sync" },
  failed:       { bg: "rgba(239,68,68,0.15)",   color: "#ef4444", label: "Failed" },
  missing:      { bg: "rgba(148,163,184,0.1)",  color: "#94a3b8", label: "Not analyzed" },
};

function StatusPill({ status, ts }: { status: Intel["analysisStatus"]; ts: string | null }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{
      display: "inline-flex", gap: 6, alignItems: "center", padding: "2px 8px", borderRadius: 999,
      background: s.bg, color: s.color, fontSize: 11, border: `1px solid ${s.color}40`,
    }}>
      ● {s.label}{ts && status === "analyzed" ? ` · ${new Date(ts).toLocaleString()}` : ""}
    </span>
  );
}

export function CallIntelligencePanel({ callId, canRegenerate = false }: { callId: string; canRegenerate?: boolean }) {
  const [data, setData] = useState<Intel>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  const run = async (force = false) => {
    setBusy(true);
    try {
      if (!force) {
        const cached = await loadCached(callId);
        if (cached) { setData(cached); return; }
      }
      const { data: res, error } = await supabase.functions.invoke("process-call-recording", { body: { callId, force } });
      const audit = await fetchAudit(callId);
      if (!error && res) {
        const payload: any = res;
        const s = payload.status;
        const analysisStatus: Intel["analysisStatus"] =
          s === "pending_sync" ? "pending_sync"
          : s === "processing" ? "processing"
          : s === "cached" || s === "created" || s === "regenerated" ? "analyzed"
          : "missing";
        setData({ ...EMPTY, ...payload, analysisStatus, outputs_present: payload.outputs_present ?? { transcript: !!payload.transcript, insight: !!payload.summary }, audit });
      }
    } finally { setBusy(false); setLoading(false); }
  };

  useEffect(() => { setLoading(true); run(false); /* eslint-disable-next-line */ }, [callId]);

  if (loading) return <SkeletonRows rows={3} padding={12} label="Loading AI analysis" />;

  const sColor = data.sentiment === "positive" ? "text-emerald-500" : data.sentiment === "negative" ? "text-red-500" : "opacity-70";

  return (
    <div className="rounded-md border p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-semibold flex items-center gap-2 flex-wrap">🧠 AI Call Intelligence
          <StatusPill status={data.analysisStatus} ts={data.last_processed_at} />
        </div>
        {canRegenerate && (
          <button className="text-xs underline" onClick={() => run(true)} disabled={busy}>
            {busy ? "…" : "Re-analyze"}
          </button>
        )}
      </div>

      {data.status === "processing" && (
        <div className="text-xs" style={{ color: "#3b82f6" }}>⏳ Another app is already running this analysis. Result will appear shortly.</div>
      )}
      {data.status === "pending_sync" && (
        <div className="text-xs" style={{ color: "#f59e0b" }}>⏳ Recording syncing from PBX — analysis will run automatically.</div>
      )}

      {data.status === "cached" && data.skipped_reason && (
        <div className="rounded-md p-2 text-xs space-y-1" style={{ border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.05)" }}>
          <div style={{ color: "#10b981", fontWeight: 600 }}>✓ Re-analysis skipped</div>
          <div className="opacity-70">{data.skipped_reason}</div>
          <div className="flex gap-2 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 border rounded">Transcript: {data.outputs_present.transcript ? "✓" : "—"}</span>
            <span className="text-[10px] px-1.5 py-0.5 border rounded">Insight: {data.outputs_present.insight ? "✓" : "—"}</span>
          </div>
        </div>
      )}

      {data.summary && <p>{data.summary}</p>}

      <div className="flex flex-wrap gap-2 text-xs">
        {data.sentiment && <span className={`px-2 py-0.5 border rounded ${sColor}`}>Sentiment: {data.sentiment}</span>}
        {data.satisfaction_score != null && <span className="px-2 py-0.5 border rounded">Satisfaction: {data.satisfaction_score}/5</span>}
        {data.quality_score != null && <span className="px-2 py-0.5 border rounded">Quality: {data.quality_score}/5</span>}
        {data.coaching_score != null && <span className="px-2 py-0.5 border rounded">Coaching: {data.coaching_score}/5</span>}
        {data.escalation_needed && <span className="px-2 py-0.5 border rounded text-red-500">Escalation needed</span>}
      </div>
      {data.action_items.length > 0 && (
        <div><div className="text-xs uppercase opacity-60 mb-1">Action items</div>
          <ul className="list-disc pl-5">{data.action_items.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
      )}
      {data.coaching_notes.length > 0 && (
        <div><div className="text-xs uppercase opacity-60 mb-1">✨ Coaching</div>
          <ul className="list-disc pl-5">{data.coaching_notes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
      )}
      {data.topics.length > 0 && (
        <div className="flex flex-wrap gap-1">{data.topics.map((t, i) => <span key={i} className="text-xs px-1.5 py-0.5 border rounded">{t}</span>)}</div>
      )}
      {data.transcript && (
        <div>
          <button className="text-xs underline" onClick={() => setShowTranscript(s => !s)}>
            {showTranscript ? "Hide" : "Show"} transcript
          </button>
          {showTranscript && <pre className="mt-2 whitespace-pre-wrap text-xs bg-black/20 p-2 rounded max-h-72 overflow-auto">{data.transcript}</pre>}
        </div>
      )}

      <div className="border-t pt-2">
        <button className="text-xs underline" onClick={() => setShowAudit(s => !s)}>
          {showAudit ? "Hide" : "Show"} audit trail ({data.audit.length})
        </button>
        {showAudit && (
          <div className="mt-2 space-y-1 max-h-60 overflow-auto">
            {data.audit.length === 0 && <div className="text-xs opacity-60">No processing runs recorded yet.</div>}
            {data.audit.map(a => (
              <div key={a.id} className="text-xs flex flex-wrap items-center gap-2 border rounded p-1.5">
                <span className="px-1 border rounded">{a.event}</span>
                <span className="opacity-60 font-mono">run {a.run_id.slice(0, 8)}</span>
                {a.pipeline && <span className="opacity-70">{a.pipeline}</span>}
                {a.ai_model && <span className="opacity-70">{a.ai_model}</span>}
                {a.forced && <span className="px-1 border rounded">forced</span>}
                {a.duration_ms != null && <span className="opacity-60">{a.duration_ms}ms</span>}
                <span className="ml-auto opacity-60">{new Date(a.created_at).toLocaleString()}</span>
                {a.error && <div className="basis-full text-red-500">{a.error}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
