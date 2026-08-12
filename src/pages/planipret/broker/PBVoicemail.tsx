import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Voicemail, Check, X, Sparkles, Inbox } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import Pagination from "@/components/planipret/admin/Pagination";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";
import { fmtDateTime, fmtDuration } from "@/lib/planipret/brokerFormat";
import { brokerSelect, searchFilter, periodStartISO, PERIOD_OPTIONS, type BrokerPeriod } from "@/lib/planipret/brokerAccess";
import GreetingStudio from "@/components/planipret/mobile/voicemail/GreetingStudio";
import PPPageBanner from "@/components/planipret/analytics/PPPageBanner";
import PPActivityCharts from "@/components/planipret/analytics/PPActivityCharts";
import ppBanner from "@/assets/planipret/banner-voicemail.jpg";

const PAGE_SIZE = 25;

export default function PBVoicemail() {
  const { userId } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [params, setParams] = useSearchParams();

  const tab = (params.get("tab") === "greeting" ? "greeting" : "inbox") as "inbox" | "greeting";
  const period = (params.get("period") ?? "") as BrokerPeriod;
  const status = params.get("status") ?? "";
  const search = params.get("q") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);

  const loadProfile = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("planipret_profiles")
      .select("id, user_id, full_name, voicemail_greeting_text, voicemail_greeting_voice_id, voicemail_greeting_audio_url, voicemail_greeting_updated_at, voicemail_greeting_active")
      .eq("id", userId)
      .maybeSingle();
    setProfile(data ?? null);
  }, [userId]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);


  const patch = (next: Record<string, string | null>, resetPage = true) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => { if (!v) p.delete(k); else p.set(k, v); });
    if (resetPage) p.set("page", "1");
    setParams(p, { replace: true });
  };

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    let q = brokerSelect("planipret_voicemails", userId, "*", { count: "exact" })
      .order("received_at", { ascending: false, nullsFirst: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (status === "unread") q = q.eq("is_read", false);
    if (status === "read") q = q.eq("is_read", true);
    const since = periodStartISO(period);
    if (since) q = q.gte("created_at", since);
    if (search) q = q.or(searchFilter("planipret_voicemails", search));

    const { data, count } = await q;
    setRows((data as any[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [userId, page, period, status, search]);

  const markRead = async (id: string) => {
    await supabase.from("planipret_voicemails").update({ is_read: true }).eq("id", id).eq("user_id", userId);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_read: true } : r)));
  };

  return (
    <PAPage>
      <PPPageBanner
        image={ppBanner}
        accent="#F59E0B"
        title={lang === "en" ? "Voicemail" : "Boîte vocale"}
        subtitle={lang === "en" ? "Voice messages and greeting" : "Messages vocaux et annonce d'accueil"}
      />
      <PPActivityCharts kind="voicemail" lang={lang === "en" ? "en" : "fr"} userId={userId} />

      <PAPageHeader
        icon={<Voicemail className="w-4 h-4" />}
        title={lang === "en" ? "My voicemail" : "Ma messagerie vocale"}
        subtitle={`${total} ${lang === "en" ? "messages" : "messages"} · ${rows.filter((r) => !r.is_read).length} ${lang === "en" ? "new on this page" : "nouveaux sur cette page"}`}
      />

      <div className="flex gap-2">
        {([
          ["inbox", lang === "en" ? "Inbox" : "Boîte vocale", <Inbox key="i" className="w-3.5 h-3.5" />],
          ["greeting", lang === "en" ? "Greeting (AI voice)" : "Annonce (voix IA)", <Sparkles key="s" className="w-3.5 h-3.5" />],
        ] as const).map(([k, label, icon]) => (
          <button
            key={k}
            onClick={() => patch({ tab: k === "inbox" ? null : "greeting" })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid var(--pp-bg-border)",
              background: tab === k ? "var(--pp-bg-elevated)" : "transparent",
              color: tab === k ? "var(--pp-text-primary)" : "var(--pp-text-secondary)",
            }}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {tab === "greeting" ? (
        profile ? (
          <div className="pp-card" style={{ padding: 16 }}>
            <GreetingStudio profile={profile} onProfileChange={loadProfile} />
          </div>
        ) : (
          <div className="pp-card p-4 space-y-2">{[0, 1, 2].map((i) => <PPSkeleton key={i} className="h-12 w-full" />)}</div>
        )
      ) : (
      <>
      <div className="pp-card flex flex-wrap gap-2" style={{ padding: 12 }}>

        <select value={period} onChange={(e) => patch({ period: e.target.value })} className="pp-input" style={{ fontSize: 12 }}>
          {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{lang === "en" ? o.en : o.fr}</option>)}
        </select>
        <select value={status} onChange={(e) => patch({ status: e.target.value })} className="pp-input" style={{ fontSize: 12 }}>
          <option value="">{lang === "en" ? "All statuses" : "Tous les statuts"}</option>
          <option value="unread">{lang === "en" ? "Unread" : "Non lus"}</option>
          <option value="read">{lang === "en" ? "Read" : "Lus"}</option>
        </select>
        <input value={search} onChange={(e) => patch({ q: e.target.value })}
          placeholder={lang === "en" ? "Number, contact or keyword…" : "Numéro, contact ou mot-clé…"}
          className="pp-input flex-1 min-w-[200px]" style={{ fontSize: 12 }} />
        {(period || status || search) && (
          <button onClick={() => patch({ period: null, status: null, q: null })}
            className="px-3 py-1.5 rounded-lg text-[12px]" style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
            {lang === "en" ? "Reset" : "Réinitialiser"}
          </button>
        )}
      </div>

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
                <div className="flex items-center gap-2">
                  <button onClick={() => setDetail(vm)}
                    className="px-3 py-1.5 rounded-lg text-[12px]" style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
                    {lang === "en" ? "Details" : "Détails"}
                  </button>
                  {!vm.is_read && (
                    <button onClick={() => void markRead(vm.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]"
                      style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
                      <Check className="w-3.5 h-3.5" />{lang === "en" ? "Mark as read" : "Marquer lu"}
                    </button>
                  )}
                </div>
              </div>
              {vm.audio_url && <audio controls src={vm.audio_url} className="w-full mt-3" onPlay={() => { if (!vm.is_read) void markRead(vm.id); }} />}
              {vm.transcript && (
                <p style={{ fontSize: 12.5, color: "var(--pp-text-secondary)", marginTop: 10, whiteSpace: "pre-wrap" }}>{vm.transcript}</p>
              )}
            </div>
          ))}
          {total > PAGE_SIZE && (
            <div className="pp-card" style={{ padding: 12 }}>
              <Pagination page={page} pageSize={PAGE_SIZE} total={total}
                unit={lang === "en" ? "voicemails" : "messages vocaux"}
                onPageSizeChange={() => {}}
                onPageChange={(p: number) => patch({ page: String(p) }, false)} />
            </div>
          )}
        </div>
      )}
      </>
      )}



      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setDetail(null)}>
          <div className="pp-card w-full max-w-lg max-h-[85vh] overflow-y-auto" style={{ padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="pp-heading" style={{ fontSize: 16, fontWeight: 700 }}>{detail.from_name || detail.from_number || "—"}</h3>
                <p style={{ fontSize: 12, color: "var(--pp-text-muted)" }}>
                  {fmtDateTime(detail.received_at ?? detail.created_at, lang)} · {fmtDuration(detail.duration_seconds)}
                </p>
              </div>
              <button onClick={() => setDetail(null)}><X className="w-4 h-4" style={{ color: "var(--pp-text-muted)" }} /></button>
            </div>
            {detail.audio_url && <audio controls src={detail.audio_url} className="w-full mt-4" />}
            {detail.transcript && (
              <div className="mt-4">
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pp-text-muted)", textTransform: "uppercase" }}>{lang === "en" ? "Transcript" : "Transcription"}</div>
                <p style={{ fontSize: 12.5, color: "var(--pp-text-secondary)", marginTop: 4, whiteSpace: "pre-wrap" }}>{detail.transcript}</p>
              </div>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-y-2" style={{ fontSize: 12 }}>
              <dt style={{ color: "var(--pp-text-muted)" }}>{lang === "en" ? "Folder" : "Dossier"}</dt>
              <dd style={{ color: "var(--pp-text-secondary)" }}>{detail.folder || "—"}</dd>
              <dt style={{ color: "var(--pp-text-muted)" }}>{lang === "en" ? "Status" : "Statut"}</dt>
              <dd style={{ color: "var(--pp-text-secondary)" }}>{detail.is_read ? (lang === "en" ? "Read" : "Lu") : (lang === "en" ? "Unread" : "Non lu")}</dd>
            </dl>
          </div>
        </div>
      )}
    </PAPage>
  );
}
