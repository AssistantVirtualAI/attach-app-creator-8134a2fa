import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { Search, Phone, MessageSquare, Voicemail, Mic } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";
import { fmtDateTime, fmtDuration, callPeer, msgPeer } from "@/lib/planipret/brokerFormat";
import { brokerSelect, searchFilter, periodStartISO, PERIOD_OPTIONS, type BrokerPeriod } from "@/lib/planipret/brokerAccess";

const LIMIT = 25;

export default function PBSearch() {
  const { userId } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const period = (params.get("period") ?? "") as BrokerPeriod;

  const [input, setInput] = useState(q);
  const [loading, setLoading] = useState(false);
  const [calls, setCalls] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [voicemails, setVoicemails] = useState<any[]>([]);

  useEffect(() => { setInput(q); }, [q]);

  useEffect(() => {
    if (!userId || !q.trim()) { setCalls([]); setMessages([]); setVoicemails([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const since = periodStartISO(period);
      const build = (table: any) => {
        let b = brokerSelect(table, userId, "*").order("created_at", { ascending: false }).limit(LIMIT);
        if (since) b = b.gte("created_at", since);
        return b.or(searchFilter(table, q));
      };
      const [c, m, v] = await Promise.all([
        build("planipret_phone_calls"),
        build("planipret_phone_messages"),
        build("planipret_voicemails"),
      ]);
      if (cancelled) return;
      setCalls((c.data as any[]) ?? []);
      setMessages((m.data as any[]) ?? []);
      setVoicemails((v.data as any[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, q, period]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams(params);
    if (input.trim()) p.set("q", input.trim()); else p.delete("q");
    setParams(p, { replace: true });
  };

  const totalResults = calls.length + messages.length + voicemails.length;
  const recordings = calls.filter((c) => c.recording_url || c.has_recording);

  return (
    <PAPage>
      <PAPageHeader
        icon={<Search className="w-4 h-4" />}
        title={lang === "en" ? "Global search" : "Recherche globale"}
        subtitle={q ? `${totalResults} ${lang === "en" ? "results" : "résultats"}` : (lang === "en" ? "Number, contact or keyword" : "Numéro, contact ou mot-clé")}
      />

      <form onSubmit={submit} className="pp-card flex flex-wrap gap-2" style={{ padding: 12 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} autoFocus
          placeholder={lang === "en" ? "Search calls, texts and voicemail…" : "Chercher dans appels, textos et messagerie…"}
          className="pp-input flex-1 min-w-[220px]" style={{ fontSize: 13 }} />
        <select value={period} onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set("period", e.target.value); else p.delete("period"); setParams(p, { replace: true }); }}
          className="pp-input" style={{ fontSize: 12 }}>
          {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{lang === "en" ? o.en : o.fr}</option>)}
        </select>
        <button type="submit" className="pp-btn-primary">{lang === "en" ? "Search" : "Rechercher"}</button>
      </form>

      {loading ? (
        <div className="pp-card p-4 space-y-2">{[0, 1, 2, 3].map((i) => <PPSkeleton key={i} className="h-10 w-full" />)}</div>
      ) : !q.trim() ? null : totalResults === 0 ? (
        <div className="pp-card"><PPEmptyState icon={<Search className="w-5 h-5" />} title={lang === "en" ? "No results" : "Aucun résultat"} /></div>
      ) : (
        <div className="space-y-4">
          <Section icon={<Phone className="w-3.5 h-3.5" />} title={lang === "en" ? "Calls" : "Appels"} count={calls.length}
            href={`/planipret/broker/calls?search=${encodeURIComponent(q)}`} lang={lang}>
            {calls.map((c) => (
              <Row key={c.id} primary={callPeer(c)} secondary={`${c.direction ?? ""} · ${c.status ?? ""} · ${fmtDuration(c.duration_seconds)}`}
                date={fmtDateTime(c.started_at ?? c.created_at, lang)} extra={c.ai_summary} />
            ))}
          </Section>

          <Section icon={<MessageSquare className="w-3.5 h-3.5" />} title={lang === "en" ? "Texts" : "Textos"} count={messages.length}
            href={`/planipret/broker/messages?q=${encodeURIComponent(q)}`} lang={lang}>
            {messages.map((m) => (
              <Row key={m.id} primary={msgPeer(m)} secondary={m.body} date={fmtDateTime(m.sent_at ?? m.created_at, lang)} />
            ))}
          </Section>

          <Section icon={<Voicemail className="w-3.5 h-3.5" />} title={lang === "en" ? "Voicemail" : "Messagerie vocale"} count={voicemails.length}
            href={`/planipret/broker/voicemail?q=${encodeURIComponent(q)}`} lang={lang}>
            {voicemails.map((v) => (
              <Row key={v.id} primary={v.from_name || v.from_number || "—"} secondary={v.transcript} date={fmtDateTime(v.received_at ?? v.created_at, lang)} />
            ))}
          </Section>

          {recordings.length > 0 && (
            <Section icon={<Mic className="w-3.5 h-3.5" />} title={lang === "en" ? "Recordings" : "Enregistrements"} count={recordings.length}
              href={`/planipret/broker/recordings?q=${encodeURIComponent(q)}`} lang={lang}>
              {recordings.map((c) => (
                <Row key={`rec-${c.id}`} primary={callPeer(c)} secondary={fmtDuration(c.duration_seconds)} date={fmtDateTime(c.started_at ?? c.created_at, lang)} />
              ))}
            </Section>
          )}
        </div>
      )}
    </PAPage>
  );
}

function Section({ icon, title, count, href, lang, children }: any) {
  if (!count) return null;
  return (
    <div className="pp-card" style={{ padding: 0 }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
        <div className="flex items-center gap-2" style={{ fontSize: 12, fontWeight: 700, color: "var(--pp-text-secondary)" }}>
          {icon}{title} <span style={{ color: "var(--pp-text-muted)", fontWeight: 500 }}>({count})</span>
        </div>
        <Link to={href} style={{ fontSize: 11.5, color: "var(--pp-brand-accent-2)" }}>
          {lang === "en" ? "Open section" : "Ouvrir la section"}
        </Link>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ primary, secondary, date, extra }: { primary: string; secondary?: string | null; date: string; extra?: string | null }) {
  return (
    <div className="px-4 py-2.5" style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
      <div className="flex items-center justify-between gap-3">
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--pp-text-primary)" }}>{primary}</span>
        <span style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{date}</span>
      </div>
      {secondary && <div className="truncate" style={{ fontSize: 12, color: "var(--pp-text-muted)" }}>{secondary}</div>}
      {extra && <div className="truncate" style={{ fontSize: 11.5, color: "#9B7FE8" }}>{extra}</div>}
    </div>
  );
}
