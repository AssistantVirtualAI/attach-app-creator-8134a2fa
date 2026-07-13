import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Phone, MessageSquare, Voicemail, User, Mail, Sparkles, Loader2, BookUser } from "lucide-react";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { PlanipretMobileContext } from "../PlanipretMobile";

type Result = { calls: any[]; messages: any[]; voicemails: any[]; insights: any[]; contacts: any[]; directory: any[]; emails: any[] };

function highlight(text: string, q: string) {
  if (!text || !q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (<>{text.slice(0, i)}<mark style={{ background: "#FEF3C7", color: "inherit" }}>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>) as any;
}

function directoryName(c: any) {
  const first = c.directory_first_name ?? c.first_name ?? "";
  const last = c.directory_last_name ?? c.last_name ?? "";
  return [first, last].filter(Boolean).join(" ").trim() || c.name || c.display_name || (c.extension ? `Ext. ${c.extension}` : "Contact");
}

export default function MSearch() {
  const { t, lang } = useMplanipretLang();
  const { openDialer } = useOutletContext<PlanipretMobileContext>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q") ?? "";
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent] = useState<string[]>(() => JSON.parse(localStorage.getItem("pp_recent_searches") ?? "[]"));

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sess = (await supabase.auth.getSession()).data.session;
        if (!sess?.access_token) throw new Error("Session expirée");
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pp-search?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${sess.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "" },
        });
        if (!r.ok) throw new Error(`Recherche impossible (${r.status})`);
        const j = await r.json();
        if (!cancelled) setData({ calls: [], messages: [], voicemails: [], insights: [], contacts: [], directory: [], emails: [], ...j });
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Recherche impossible");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [q]);

  return (
    <div className="p-3">
      <header className="flex items-center gap-2 mb-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-full hover:bg-slate-100"><ArrowLeft className="w-5 h-5" /></button>
        <div className="font-semibold text-slate-800">{t("searchPage.results")}: « {q} »</div>
      </header>

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

      {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
      {error && !loading && <div className="p-3 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626" }}>{error}</div>}

      {data && !loading && (
        <div className="space-y-4">
          <Group icon={<BookUser className="w-4 h-4" />} title={t("contacts.directory") || "Directory"} count={data.directory?.length ?? 0}>
            {data.directory?.map((c: any, i: number) => {
              const name = directoryName(c);
              const ext = c.extension;
              return (
                <button key={`${ext ?? "dir"}-${i}`} onClick={() => ext && openDialer(ext)} className="w-full text-left p-3 bg-white rounded-lg text-sm flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{highlight(name, q)}</div>
                    <div className="text-xs text-slate-400 truncate">{ext ? `${t("contacts.extension") || "Ext."} ${ext}` : c.email || ""}{c.position ? ` · ${c.position}` : ""}</div>
                  </div>
                  {ext && <Phone className="w-4 h-4 text-slate-400" />}
                </button>
              );
            })}
          </Group>
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
          <Group icon={<MessageSquare className="w-4 h-4" />} title={t("searchPage.messages")} count={data.messages?.length ?? 0}>
            {data.messages?.map((m) => (
              <button key={m.id} onClick={() => navigate("/mplanipret/messages")} className="w-full text-left p-3 bg-white rounded-lg text-sm">
                <div className="text-xs text-slate-400">{m.direction === "outbound" ? m.to_number : m.from_number}</div>
                <div className="truncate">{highlight(m.body ?? "", q)}</div>
              </button>
            ))}
          </Group>
          <Group icon={<Voicemail className="w-4 h-4" />} title={t("searchPage.voicemails")} count={data.voicemails?.length ?? 0}>
            {data.voicemails?.map((v) => (
              <button key={v.id} onClick={() => navigate("/mplanipret/voicemail")} className="w-full text-left p-3 bg-white rounded-lg text-sm">
                <div className="text-xs text-slate-400">{v.from_number} · {v.duration_seconds}s</div>
                <div className="truncate text-slate-600">{highlight((v.transcript ?? "").slice(0, 120), q)}</div>
              </button>
            ))}
          </Group>
          <Group icon={<Sparkles className="w-4 h-4" />} title={t("searchPage.aiInsights")} count={data.insights?.length ?? 0}>
            {data.insights?.map((i) => (
              <div key={i.id} className="p-3 bg-white rounded-lg text-sm text-slate-600 truncate">{highlight((i.summary ?? "").slice(0, 160), q)}</div>
            ))}
          </Group>
          <Group icon={<User className="w-4 h-4" />} title={t("searchPage.maestroContacts")} count={data.contacts?.length ?? 0}>
            {data.contacts?.map((c: any, i: number) => (
              <div key={i} className="p-3 bg-white rounded-lg text-sm">
                <div className="font-medium">{c.name ?? c.full_name ?? "Contact"}</div>
                <div className="text-xs text-slate-400">{c.phone ?? c.email}</div>
              </div>
            ))}
          </Group>
          <Group icon={<Mail className="w-4 h-4" />} title={t("searchPage.emails")} count={data.emails?.length ?? 0}>
            {data.emails?.map((e: any, i: number) => (
              <div key={i} className="p-3 bg-white rounded-lg text-sm">
                <div className="font-medium truncate">{e.subject ?? t("searchPage.noSubject")}</div>
                <div className="text-xs text-slate-400 truncate">{e.from ?? ""}</div>
              </div>
            ))}
          </Group>
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
