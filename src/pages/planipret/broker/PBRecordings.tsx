import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { Mic, Download, X, Sparkles } from "lucide-react";
import { PAPage, PAPageHeader, PATableWrap } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import Pagination from "@/components/planipret/admin/Pagination";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";
import { fmtDateTime, fmtDuration, callPeer } from "@/lib/planipret/brokerFormat";
import { brokerSelect, searchFilter, periodStartISO, PERIOD_OPTIONS, type BrokerPeriod } from "@/lib/planipret/brokerAccess";

const PAGE_SIZE = 25;

export default function PBRecordings() {
  const { userId } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [params, setParams] = useSearchParams();

  const period = (params.get("period") ?? "") as BrokerPeriod;
  const direction = params.get("direction") ?? "";
  const status = params.get("status") ?? "";
  const search = params.get("q") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any | null>(null);

  const patch = (next: Record<string, string | null>, resetPage = true) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => { if (!v) p.delete(k); else p.set(k, v); });
    if (resetPage) p.set("page", "1");
    setParams(p, { replace: true });
  };

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = brokerSelect("planipret_phone_calls", userId, "*", { count: "exact" })
        .eq("has_recording", true)
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (direction) q = q.eq("direction", direction);
      if (status === "summary") q = q.not("ai_summary", "is", null);
      if (status === "transcript") q = q.not("transcript", "is", null);
      const since = periodStartISO(period);
      if (since) q = q.gte("created_at", since);
      if (search) q = q.or(searchFilter("planipret_phone_calls", search));

      const { data, count } = await q;
      if (cancelled) return;
      setRows((data as any[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, page, period, direction, status, search]);

  return (
    <PAPage>
      <PAPageHeader
        icon={<Mic className="w-4 h-4" />}
        title={lang === "en" ? "My recordings" : "Mes enregistrements"}
        subtitle={`${total} ${lang === "en" ? "recordings" : "enregistrements"}`}
      />

      <div className="pp-card flex flex-wrap gap-2" style={{ padding: 12 }}>
        <select value={period} onChange={(e) => patch({ period: e.target.value })} className="pp-input" style={{ fontSize: 12 }}>
          {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{lang === "en" ? o.en : o.fr}</option>)}
        </select>
        <select value={direction} onChange={(e) => patch({ direction: e.target.value })} className="pp-input" style={{ fontSize: 12 }}>
          <option value="">{lang === "en" ? "All directions" : "Toutes directions"}</option>
          <option value="inbound">{lang === "en" ? "Inbound" : "Entrant"}</option>
          <option value="outbound">{lang === "en" ? "Outbound" : "Sortant"}</option>
        </select>
        <select value={status} onChange={(e) => patch({ status: e.target.value })} className="pp-input" style={{ fontSize: 12 }}>
          <option value="">{lang === "en" ? "All" : "Tous"}</option>
          <option value="summary">{lang === "en" ? "With AI summary" : "Avec résumé IA"}</option>
          <option value="transcript">{lang === "en" ? "With transcript" : "Avec transcription"}</option>
        </select>
        <input value={search} onChange={(e) => patch({ q: e.target.value })}
          placeholder={lang === "en" ? "Number, contact or keyword…" : "Numéro, contact ou mot-clé…"}
          className="pp-input flex-1 min-w-[200px]" style={{ fontSize: 12 }} />
        {(period || direction || status || search) && (
          <button onClick={() => patch({ period: null, direction: null, status: null, q: null })}
            className="px-3 py-1.5 rounded-lg text-[12px]" style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
            {lang === "en" ? "Reset" : "Réinitialiser"}
          </button>
        )}
      </div>

      <div className="pp-card" style={{ padding: 0 }}>
        {loading ? (
          <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <PPSkeleton key={i} className="h-10 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <PPEmptyState icon={<Mic className="w-5 h-5" />} title={lang === "en" ? "No recordings" : "Aucun enregistrement"} />
        ) : (
          <PATableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--pp-text-muted)", fontSize: 11, textAlign: "left" }}>
                  <th className="px-4 py-2">Contact</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">{lang === "en" ? "Duration" : "Durée"}</th>
                  <th className="px-4 py-2">{lang === "en" ? "Transcript" : "Transcription"}</th>
                  <th className="px-4 py-2">{lang === "en" ? "Summary & topics" : "Résumé & thèmes"}</th>
                  <th className="px-4 py-2">Maestro</th>
                  <th className="px-4 py-2 text-right">{lang === "en" ? "Actions" : "Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--pp-bg-border)", cursor: "pointer" }} onClick={() => setDetail(c)}>
                    <td className="px-4 py-2" style={{ color: "var(--pp-text-primary)" }}>
                      {callPeer(c)}
                      {c.ai_summary && <Sparkles className="w-3.5 h-3.5 inline ml-1.5" style={{ color: "#9B7FE8" }} />}
                    </td>
                    <td className="px-4 py-2" style={{ color: "var(--pp-text-muted)" }}>{fmtDateTime(c.started_at ?? c.created_at, lang)}</td>
                    <td className="px-4 py-2" style={{ color: "var(--pp-text-muted)" }}>{fmtDuration(c.duration_seconds)}</td>
                    <td className="px-4 py-2">
                      {c.transcript || (Array.isArray(c.transcript_segments) && c.transcript_segments.length) ? (
                        <span style={{ fontSize: 10, color: "var(--pp-success, #10b981)" }}>● {lang === "en" ? "Available" : "Disponible"}</span>
                      ) : (
                        <span style={{ fontSize: 10, color: "var(--pp-text-faint)" }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-2" style={{ maxWidth: 260 }}>
                      {c.ai_summary_short || c.ai_summary ? (
                        <div className="space-y-1">
                          <div className="line-clamp-2" style={{ fontSize: 11, color: "var(--pp-text-secondary)", lineHeight: 1.35 }}>
                            {c.ai_summary_short ?? c.ai_summary}
                          </div>
                          {Array.isArray(c.ai_topics) && c.ai_topics.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {c.ai_topics.slice(0, 3).map((tp: string, i: number) => (
                                <span key={i} className="px-1.5 py-0.5 rounded-full text-[9px]" style={{ background: "rgba(155,127,232,0.14)", color: "#9B7FE8", border: "1px solid #9B7FE855" }}>{tp}</span>
                              ))}
                              {c.ai_topics.length > 3 && <span style={{ fontSize: 9, color: "var(--pp-text-faint)" }}>+{c.ai_topics.length - 3}</span>}
                            </div>
                          )}
                          {Array.isArray(c.ai_action_items) && c.ai_action_items.length > 0 && (
                            <div style={{ fontSize: 9, color: "#2E9BDC" }}>✓ {c.ai_action_items.length} action{c.ai_action_items.length > 1 ? "s" : ""}</div>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: 10, color: "var(--pp-text-faint)" }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {c.maestro_synced ? (
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "rgba(16,185,129,0.14)", color: "#10b981", border: "1px solid #10b98155", fontWeight: 700 }}>
                          ● {lang === "en" ? "Synced" : "Synchronisé"}
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, color: "var(--pp-text-faint)" }}>{lang === "en" ? "Pending" : "En attente"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setDetail(c)}
                        className="px-2.5 py-1 rounded-lg text-[12px]" style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
                        {lang === "en" ? "Open" : "Ouvrir"}
                      </button>
                      {c.recording_url && String(c.recording_url).startsWith("http") && (
                        <a href={c.recording_url} download target="_blank" rel="noreferrer"
                          className="inline-flex items-center ml-2" style={{ color: "var(--pp-brand-accent-2)" }}>
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PATableWrap>
        )}
        {total > PAGE_SIZE && (
          <div className="px-4 py-3" style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total}
              unit={lang === "en" ? "recordings" : "enregistrements"}
              onPageSizeChange={() => {}}
              onPageChange={(p: number) => patch({ page: String(p) }, false)} />
          </div>
        )}
      </div>

      {detail && (
        <RecordingDetailDrawer
          call={detail}
          onClose={() => setDetail(null)}
          showBroker={false}
        />
      )}

    </PAPage>
  );
}
