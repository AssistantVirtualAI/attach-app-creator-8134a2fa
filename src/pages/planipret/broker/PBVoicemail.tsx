import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Voicemail, Check } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";
import { fmtDateTime, fmtDuration } from "@/lib/planipret/brokerFormat";

export default function PBVoicemail() {
  const { userId } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await supabase
      .from("planipret_voicemails")
      .select("*")
      .eq("user_id", userId)
      .order("received_at", { ascending: false, nullsFirst: false })
      .limit(200);
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [userId]);

  const markRead = async (id: string) => {
    await supabase.from("planipret_voicemails").update({ is_read: true }).eq("id", id);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_read: true } : r)));
  };

  return (
    <PAPage>
      <PAPageHeader
        icon={<Voicemail className="w-4 h-4" />}
        title={lang === "en" ? "My voicemail" : "Ma messagerie vocale"}
        subtitle={`${rows.filter((r) => !r.is_read).length} ${lang === "en" ? "new" : "nouveaux"}`}
      />

      {loading ? (
        <div className="pp-card p-4 space-y-2">{[0, 1, 2].map((i) => <PPSkeleton key={i} className="h-12 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <div className="pp-card"><PPEmptyState icon={<Voicemail className="w-5 h-5" />} title={lang === "en" ? "No voicemail" : "Aucun message vocal"} /></div>
      ) : (
        <div className="space-y-3">
          {rows.map((vm) => (
            <div key={vm.id} className="pp-card" style={{ padding: 14 }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--pp-text-primary)" }}>
                    {vm.from_name || vm.from_number || "—"}
                    {!vm.is_read && <span className="ml-2" style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "var(--pp-danger)", borderRadius: 999, padding: "1px 6px" }}>{lang === "en" ? "NEW" : "NOUVEAU"}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
                    {fmtDateTime(vm.received_at ?? vm.created_at, lang)} · {fmtDuration(vm.duration_seconds)}
                  </div>
                </div>
                {!vm.is_read && (
                  <button onClick={() => void markRead(vm.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]"
                    style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
                    <Check className="w-3.5 h-3.5" />{lang === "en" ? "Mark as read" : "Marquer lu"}
                  </button>
                )}
              </div>
              {vm.audio_url && <audio controls src={vm.audio_url} className="w-full mt-3" onPlay={() => { if (!vm.is_read) void markRead(vm.id); }} />}
              {vm.transcript && (
                <p style={{ fontSize: 12.5, color: "var(--pp-text-secondary)", marginTop: 10, whiteSpace: "pre-wrap" }}>{vm.transcript}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </PAPage>
  );
}
