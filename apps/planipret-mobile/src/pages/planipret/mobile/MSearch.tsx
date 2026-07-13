import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams, useNavigate, useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Phone, MessageSquare, Voicemail, User, Mail, Sparkles, Loader2, BookUser, AlertCircle, RefreshCw } from "lucide-react";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { PlanipretMobileContext } from "../PlanipretMobile";

type DirEntry = { extension?: string; name?: string; first_name?: string; last_name?: string; email?: string; department?: string; position?: string; presence?: string };
type Result = {
  calls: any[]; messages: any[]; voicemails: any[]; insights: any[]; contacts: any[]; emails: any[]; directory: DirEntry[];
};
type Scope = "all" | "directory" | "calls" | "messages" | "voicemails" | "insights" | "contacts" | "emails";

function highlight(text: string, q: string) {
  if (!text || !q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (<>{text.slice(0, i)}<mark style={{ background: "#FEF3C7", color: "inherit" }}>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>) as any;
}

export default function MSearch() {
  const { t, lang } = useMplanipretLang();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const outlet = useOutletContext<PlanipretMobileContext | undefined>();
  const q = params.get("q") ?? "";
  const scope = (params.get("scope") as Scope) || "all";
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("pp_recent_searches") ?? "[]"); } catch { return []; } });

  const setScope = useCallback((s: Scope) => {
    const next = new URLSearchParams(params);
    if (s === "all") next.delete("scope"); else next.set("scope", s);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const run = useCallback(async () => {
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const sess = (await supabase.auth.getSession()).data.session;
      // Run backend search + directory in parallel (same source as Contacts > Annuaire)
      const [searchRes, dirRes] = await Promise.all([
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pp-search?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${sess?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "" },
        }).then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
          return j;
        }),
        supabase.functions.invoke("pp-ns-contacts", { body: { action: "directory", limit: 500 } })
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            if ((data as any)?.error) throw new Error((data as any).error);
            return (data as any)?.directory ?? [];
          })
          .catch((e) => { console.warn("[search] directory fallback:", e?.message); return []; }),
      ]);
      const ql = q.toLowerCase();
      const directory: DirEntry[] = (dirRes as DirEntry[]).filter((d) => {
        const hay = `${d.first_name ?? ""} ${d.last_name ?? ""} ${d.name ?? ""} ${d.extension ?? ""} ${d.email ?? ""} ${d.department ?? ""} ${d.position ?? ""}`.toLowerCase();
        return hay.includes(ql);
      });
      setData({
        calls: searchRes.calls ?? [],
        messages: searchRes.messages ?? [],
        voicemails: searchRes.voicemails ?? [],
        insights: searchRes.insights ?? [],
        contacts: searchRes.contacts ?? [],
        emails: searchRes.emails ?? [],
        directory,
      });
    } catch (e: any) {
      console.error("[pp-search]", e);
      setError(e?.message || "Erreur inconnue");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => { void run(); }, [run]);

  const total = useMemo(() => {
    if (!data) return 0;
    return (data.directory?.length ?? 0) + (data.calls?.length ?? 0) + (data.messages?.length ?? 0) + (data.voicemails?.length ?? 0) + (data.insights?.length ?? 0) + (data.contacts?.length ?? 0) + (data.emails?.length ?? 0);
  }, [data]);

  const show = (s: Scope) => scope === "all" || scope === s;
  const openDialer = outlet?.openDialer;

  const scopeChips: { id: Scope; label: string; count?: number }[] = data ? [
    { id: "all", label: t("common.all") || "Tout", count: total },
    { id: "directory", label: t("contacts.directory") || "Annuaire", count: data.directory.length },
    { id: "calls", label: t("searchPage.calls"), count: data.calls.length },
    { id: "messages", label: t("searchPage.messages"), count: data.messages.length },
    { id: "voicemails", label: t("searchPage.voicemails"), count: data.voicemails.length },
    { id: "insights", label: t("searchPage.aiInsights"), count: data.insights.length },
    { id: "contacts", label: t("searchPage.maestroContacts"), count: data.contacts.length },
    { id: "emails", label: t("searchPage.emails"), count: data.emails.length },
  ] : [];

  return (
    <div className="p-3">
      <header className="flex items-center gap-2 mb-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-full hover:bg-slate-100"><ArrowLeft className="w-5 h-5" /></button>
        <div className="font-semibold text-slate-800 truncate">{t("searchPage.results")}: « {q} »</div>
      </header>

      {q && data && !loading && !error && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1 no-scrollbar">
          {scopeChips.map((c) => {
            const active = scope === c.id;
            return (
              <button key={c.id} onClick={() => setScope(c.id)}
                className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition"
                style={{
                  background: active ? "var(--pp-brand-accent-2, #2563eb)" : "var(--pp-bg-elevated, #f1f5f9)",
                  color: active ? "#fff" : "var(--pp-text-secondary, #475569)",
                  border: `1px solid ${active ? "var(--pp-brand-accent, #3b82f6)" : "var(--pp-bg-border-2, #e5e7eb)"}`,
                }}>
                {c.label}{typeof c.count === "number" ? ` (${c.count})` : ""}
              </button>
            );
          })}
        </div>
      )}

      {!q && (
        <div>
          <div className="text-xs text-slate-400 mb-2 px-1">{t("searchPage.recentSearches")}</div>
          {recent.length === 0 ? <div className="text-sm text-slate-400 px-1">{t("common.none")}</div> : (
            <div className="space-y-1">
              {recent.map((r) => (
                <button key={r} onClick={() => navigate(`/mplanipret/search?q=${encodeURIComponent(r)}`)}
                  className="block w-full text-left px-3 py-2 bg-white rounded-lg text-sm">{r}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          <div className="text-xs text-slate-500">{t("common.loading") || "Chargement…"}</div>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl p-4 text-sm flex flex-col items-start gap-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626" }}>
          <div className="flex items-center gap-2 font-semibold"><AlertCircle className="w-4 h-4" /> Recherche impossible</div>
          <div className="text-xs opacity-80 break-all">{error}</div>
          <button onClick={() => void run()} className="mt-1 flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-semibold"
            style={{ background: "rgba(239,68,68,0.15)", color: "#dc2626" }}>
            <RefreshCw className="w-3 h-3" /> Réessayer
          </button>
        </div>
      )}

      {q && data && !loading && !error && total === 0 && (
        <div className="text-center py-12">
          <div className="text-sm text-slate-500">{t("searchPage.noResults") || "Aucun résultat"}</div>
        </div>
      )}

      {data && !loading && !error && (
        <div className="space-y-4">
          {show("directory") && (
            <Group icon={<BookUser className="w-4 h-4" />} title={t("contacts.directory") || "Annuaire"} count={data.directory?.length ?? 0}>
              {data.directory?.map((d, i) => {
                const name = [d.first_name, d.last_name].filter(Boolean).join(" ").trim() || d.name || (d.extension ? `Ext. ${d.extension}` : "—");
                return (
                  <button key={`${d.extension ?? i}`} onClick={() => d.extension && openDialer?.(d.extension)}
                    className="w-full text-left p-3 bg-white rounded-lg text-sm flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{highlight(name, q)}</div>
                      <div className="text-xs text-slate-400 truncate">
                        {d.extension ? `Ext. ${d.extension}` : ""}{d.position ? ` · ${d.position}` : ""}{d.email ? ` · ${d.email}` : ""}
                      </div>
                    </div>
                    {d.extension && <Phone className="w-4 h-4 text-slate-400" />}
                  </button>
                );
              })}
            </Group>
          )}
          {show("calls") && (
            <Group icon={<Phone className="w-4 h-4" />} title={t("searchPage.calls")} count={data.calls?.length ?? 0}>
              {data.calls?.map((c) => (
                <button key={c.id} onClick={() => navigate("/mplanipret/calls")} className="w-full text-left p-3 bg-white rounded-lg text-sm flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{highlight(c.from_name ?? c.to_name ?? c.caller_number ?? c.callee_number ?? t("common.unknown"), q)}</div>
                    <div className="text-xs text-slate-400">{c.direction} · {new Date(c.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}</div>
                  </div>
                </button>
              ))}
            </Group>
          )}
          {show("messages") && (
            <Group icon={<MessageSquare className="w-4 h-4" />} title={t("searchPage.messages")} count={data.messages?.length ?? 0}>
              {data.messages?.map((m) => (
                <button key={m.id} onClick={() => navigate("/mplanipret/messages")} className="w-full text-left p-3 bg-white rounded-lg text-sm">
                  <div className="text-xs text-slate-400">{m.direction === "outbound" ? m.to_number : m.from_number}</div>
                  <div className="truncate">{highlight(m.body ?? "", q)}</div>
                </button>
              ))}
            </Group>
          )}
          {show("voicemails") && (
            <Group icon={<Voicemail className="w-4 h-4" />} title={t("searchPage.voicemails")} count={data.voicemails?.length ?? 0}>
              {data.voicemails?.map((v) => (
                <button key={v.id} onClick={() => navigate("/mplanipret/voicemail")} className="w-full text-left p-3 bg-white rounded-lg text-sm">
                  <div className="text-xs text-slate-400">{v.from_number} · {v.duration_seconds}s</div>
                  <div className="truncate text-slate-600">{highlight((v.transcript ?? "").slice(0, 120), q)}</div>
                </button>
              ))}
            </Group>
          )}
          {show("insights") && (
            <Group icon={<Sparkles className="w-4 h-4" />} title={t("searchPage.aiInsights")} count={data.insights?.length ?? 0}>
              {data.insights?.map((i) => (
                <div key={i.id} className="p-3 bg-white rounded-lg text-sm text-slate-600 truncate">{highlight((i.summary ?? "").slice(0, 160), q)}</div>
              ))}
            </Group>
          )}
          {show("contacts") && (
            <Group icon={<User className="w-4 h-4" />} title={t("searchPage.maestroContacts")} count={data.contacts?.length ?? 0}>
              {data.contacts?.map((c: any, i: number) => (
                <div key={i} className="p-3 bg-white rounded-lg text-sm">
                  <div className="font-medium">{c.name ?? c.full_name ?? "Contact"}</div>
                  <div className="text-xs text-slate-400">{c.phone ?? c.email}</div>
                </div>
              ))}
            </Group>
          )}
          {show("emails") && (
            <Group icon={<Mail className="w-4 h-4" />} title={t("searchPage.emails")} count={data.emails?.length ?? 0}>
              {data.emails?.map((e: any, i: number) => (
                <div key={i} className="p-3 bg-white rounded-lg text-sm">
                  <div className="font-medium truncate">{e.subject ?? t("searchPage.noSubject")}</div>
                  <div className="text-xs text-slate-400 truncate">{e.from ?? ""}</div>
                </div>
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ icon, title, count, children }: { icon: any; title: string; count: number; children: any }) {
  if (!count) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5 px-1 text-xs font-semibold text-slate-500">{icon} {title} ({count})</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
