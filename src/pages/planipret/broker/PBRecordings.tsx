import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Mic, Download } from "lucide-react";
import { PAPage, PAPageHeader, PATableWrap } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";
import { fmtDateTime, fmtDuration, callPeer } from "@/lib/planipret/brokerFormat";

export default function PBRecordings() {
  const { userId } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("planipret_phone_calls")
        .select("id, direction, from_name, from_number, to_name, to_number, duration_seconds, started_at, created_at, recording_url, ai_summary")
        .eq("user_id", userId)
        .eq("has_recording", true)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setRows(data ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <PAPage>
      <PAPageHeader
        icon={<Mic className="w-4 h-4" />}
        title={lang === "en" ? "My recordings" : "Mes enregistrements"}
        subtitle={`${rows.length} ${lang === "en" ? "recordings" : "enregistrements"}`}
      />

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
                  <th className="px-4 py-2">{lang === "en" ? "Contact" : "Contact"}</th>
                  <th className="px-4 py-2">{lang === "en" ? "Date" : "Date"}</th>
                  <th className="px-4 py-2">{lang === "en" ? "Duration" : "Durée"}</th>
                  <th className="px-4 py-2 text-right">{lang === "en" ? "Listen" : "Écouter"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <>
                    <tr key={c.id} style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                      <td className="px-4 py-2" style={{ color: "var(--pp-text-primary)" }}>{callPeer(c)}</td>
                      <td className="px-4 py-2" style={{ color: "var(--pp-text-muted)" }}>{fmtDateTime(c.started_at ?? c.created_at, lang)}</td>
                      <td className="px-4 py-2" style={{ color: "var(--pp-text-muted)" }}>{fmtDuration(c.duration_seconds)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setPlaying(playing === c.id ? null : c.id)}
                          className="px-2.5 py-1 rounded-lg text-[12px]" style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
                          {playing === c.id ? (lang === "en" ? "Hide" : "Masquer") : (lang === "en" ? "Play" : "Écouter")}
                        </button>
                        <a href={c.recording_url} download target="_blank" rel="noreferrer"
                          className="inline-flex items-center ml-2" style={{ color: "var(--pp-brand-accent-2)" }}>
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </td>
                    </tr>
                    {playing === c.id && (
                      <tr key={`${c.id}-player`}>
                        <td colSpan={4} className="px-4 pb-3">
                          <audio controls autoPlay src={c.recording_url} className="w-full" />
                          {c.ai_summary && <p style={{ fontSize: 12.5, color: "var(--pp-text-secondary)", marginTop: 8, whiteSpace: "pre-wrap" }}>{c.ai_summary}</p>}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </PATableWrap>
        )}
      </div>
    </PAPage>
  );
}
