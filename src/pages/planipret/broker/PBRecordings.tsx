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
                    <td className="px-4 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setDetail(c)}
                        className="px-2.5 py-1 rounded-lg text-[12px]" style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
                        {lang === "en" ? "Open" : "Ouvrir"}
                      </button>
                      {c.recording_url && (
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setDetail(null)}>
          <div className="pp-card w-full max-w-lg max-h-[85vh] overflow-y-auto" style={{ padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="pp-heading" style={{ fontSize: 16, fontWeight: 700 }}>{callPeer(detail)}</h3>
                <p style={{ fontSize: 12, color: "var(--pp-text-muted)" }}>
                  {fmtDateTime(detail.started_at ?? detail.created_at, lang)} · {fmtDuration(detail.duration_seconds)} · {detail.direction}
                </p>
              </div>
              <button onClick={() => setDetail(null)}><X className="w-4 h-4" style={{ color: "var(--pp-text-muted)" }} /></button>
            </div>
            {detail.recording_url && <audio controls autoPlay src={detail.recording_url} className="w-full mt-4" />}
            {detail.ai_summary && (
              <div className="mt-4">
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pp-text-muted)", textTransform: "uppercase" }}>{lang === "en" ? "AI summary" : "Résumé IA"}</div>
                <p style={{ fontSize: 13, color: "var(--pp-text-secondary)", marginTop: 4, whiteSpace: "pre-wrap" }}>{detail.ai_summary}</p>
              </div>
            )}
            {detail.transcript && (
              <div className="mt-4">
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pp-text-muted)", textTransform: "uppercase" }}>{lang === "en" ? "Transcript" : "Transcription"}</div>
                <p style={{ fontSize: 12.5, color: "var(--pp-text-secondary)", marginTop: 4, whiteSpace: "pre-wrap" }}>{detail.transcript}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </PAPage>
  );
}
