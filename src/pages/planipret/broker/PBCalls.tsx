import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Phone, ArrowDownLeft, ArrowUpRight, X, Sparkles, Mic } from "lucide-react";
import { PAPage, PAPageHeader, PATableWrap } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import Pagination from "@/components/planipret/admin/Pagination";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";
import { fmtDateTime, fmtDuration, callPeer } from "@/lib/planipret/brokerFormat";
import PPPageBanner from "@/components/planipret/analytics/PPPageBanner";
import PPActivityCharts from "@/components/planipret/analytics/PPActivityCharts";
import ppBanner from "@/assets/planipret/banner-calls.jpg";

const PAGE_SIZE = 25;

export default function PBCalls() {
  const { userId } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const direction = params.get("direction") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const search = params.get("search") ?? "";

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
      let q = supabase.from("planipret_phone_calls")
        .select("*", { count: "exact" })
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (direction === "missed") q = q.eq("status", "missed");
      else if (direction) q = q.eq("direction", direction);
      if (from) q = q.gte("created_at", new Date(from).toISOString());
      if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); q = q.lte("created_at", d.toISOString()); }
      if (search) q = q.or(`from_number.ilike.%${search}%,to_number.ilike.%${search}%,from_name.ilike.%${search}%,to_name.ilike.%${search}%`);

      const { data, count } = await q;
      if (cancelled) return;
      setRows(data ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, page, direction, from, to, search]);

  return (
    <PAPage>
      <PPPageBanner
        image={ppBanner}
        accent="#3B82F6"
        title={lang === "en" ? "Calls" : "Appels"}
        subtitle={lang === "en" ? "Your call history and trends" : "Historique et tendances de vos appels"}
      />
      <PPActivityCharts kind="calls" lang={lang === "en" ? "en" : "fr"} userId={userId} />

      <PAPageHeader
        icon={<Phone className="w-4 h-4" />}
        title={lang === "en" ? "My calls" : "Mes appels"}
        subtitle={`${total} ${lang === "en" ? "calls" : "appels"}`}
      />

      <div className="pp-card flex flex-wrap gap-2" style={{ padding: 12 }}>
        <select value={direction} onChange={(e) => patch({ direction: e.target.value })} className="pp-input" style={{ fontSize: 12 }}>
          <option value="">{lang === "en" ? "All directions" : "Toutes directions"}</option>
          <option value="inbound">{lang === "en" ? "Inbound" : "Entrant"}</option>
          <option value="outbound">{lang === "en" ? "Outbound" : "Sortant"}</option>
          <option value="missed">{lang === "en" ? "Missed" : "Manqué"}</option>
        </select>
        <input type="date" value={from} onChange={(e) => patch({ from: e.target.value })} className="pp-input" style={{ fontSize: 12 }} />
        <input type="date" value={to} onChange={(e) => patch({ to: e.target.value })} className="pp-input" style={{ fontSize: 12 }} />
        <input value={search} onChange={(e) => patch({ search: e.target.value })}
          placeholder={lang === "en" ? "Search a number…" : "Rechercher un numéro…"}
          className="pp-input flex-1 min-w-[180px]" style={{ fontSize: 12 }} />
        {(direction || from || to || search) && (
          <button onClick={() => patch({ direction: null, from: null, to: null, search: null })}
            className="px-3 py-1.5 rounded-lg text-[12px]" style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
            {lang === "en" ? "Reset" : "Réinitialiser"}
          </button>
        )}
      </div>

      <div className="pp-card" style={{ padding: 0 }}>
        {loading ? (
          <div className="p-4 space-y-2">{[0, 1, 2, 3, 4].map((i) => <PPSkeleton key={i} className="h-9 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <PPEmptyState icon={<Phone className="w-5 h-5" />} title={lang === "en" ? "No calls found" : "Aucun appel trouvé"} />
        ) : (
          <PATableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--pp-text-muted)", fontSize: 11, textAlign: "left" }}>
                  <th className="px-4 py-2" />
                  <th className="px-4 py-2">{lang === "en" ? "Contact" : "Contact"}</th>
                  <th className="px-4 py-2">{lang === "en" ? "Status" : "Statut"}</th>
                  <th className="px-4 py-2">{lang === "en" ? "Duration" : "Durée"}</th>
                  <th className="px-4 py-2">{lang === "en" ? "Date" : "Date"}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--pp-bg-border)", cursor: "pointer" }} onClick={() => setDetail(c)}>
                    <td className="px-4 py-2">
                      {c.direction === "inbound"
                        ? <ArrowDownLeft className="w-4 h-4" style={{ color: c.status === "missed" ? "var(--pp-danger)" : "var(--pp-success)" }} />
                        : <ArrowUpRight className="w-4 h-4" style={{ color: "var(--pp-brand-accent-2)" }} />}
                    </td>
                    <td className="px-4 py-2" style={{ color: "var(--pp-text-primary)" }}>{callPeer(c)}</td>
                    <td className="px-4 py-2" style={{ color: "var(--pp-text-muted)" }}>{c.status ?? "—"}</td>
                    <td className="px-4 py-2" style={{ color: "var(--pp-text-muted)" }}>{fmtDuration(c.duration_seconds)}</td>
                    <td className="px-4 py-2" style={{ color: "var(--pp-text-muted)" }}>{fmtDateTime(c.started_at ?? c.created_at, lang)}</td>
                    <td className="px-4 py-2 text-right">
                      {c.recording_url && <Mic className="w-3.5 h-3.5 inline" style={{ color: "var(--pp-brand-accent-2)" }} />}
                      {c.ai_summary && <Sparkles className="w-3.5 h-3.5 inline ml-1" style={{ color: "#9B7FE8" }} />}
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
                  {fmtDateTime(detail.started_at ?? detail.created_at, lang)} · {fmtDuration(detail.duration_seconds)}
                </p>
              </div>
              <button onClick={() => setDetail(null)}><X className="w-4 h-4" style={{ color: "var(--pp-text-muted)" }} /></button>
            </div>
            {detail.recording_url && (
              <audio controls src={detail.recording_url} className="w-full mt-4" />
            )}
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
