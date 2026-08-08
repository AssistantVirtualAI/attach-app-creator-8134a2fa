import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Phone, MessageSquare, Voicemail, Mic, Users, Mail, UserRound, TrendingUp, X, Loader2 } from "lucide-react";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { useBrokerGlobalSearch, type SearchHit } from "@/hooks/planipret/useBrokerGlobalSearch";

function toText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    const e = v.emailAddress ?? v;
    return String(e?.name ?? e?.address ?? e?.email ?? e?.displayName ?? "");
  }
  return String(v);
}

const ORDER: SearchHit["kind"][] = ["call", "message", "voicemail", "recording", "maestro", "person", "email", "commission"];

const LABELS: Record<SearchHit["kind"], { fr: string; en: string; Icon: any; section: string }> = {
  call:       { fr: "Appels", en: "Calls", Icon: Phone, section: "/planipret/broker/calls" },
  message:    { fr: "Textos", en: "Texts", Icon: MessageSquare, section: "/planipret/broker/messages" },
  voicemail:  { fr: "Messagerie vocale", en: "Voicemail", Icon: Voicemail, section: "/planipret/broker/voicemail" },
  recording:  { fr: "Enregistrements", en: "Recordings", Icon: Mic, section: "/planipret/broker/recordings" },
  maestro:    { fr: "Clients Maestro", en: "Maestro clients", Icon: Users, section: "/planipret/broker/maestro-clients" },
  person:     { fr: "Personnes", en: "People", Icon: UserRound, section: "/planipret/broker/microsoft" },
  email:      { fr: "Courriels", en: "Emails", Icon: Mail, section: "/planipret/broker/microsoft" },
  commission: { fr: "Commissions", en: "Commissions", Icon: TrendingUp, section: "/planipret/broker/commissions" },
};

export default function BrokerOmniSearch({ userId, className }: { userId: string; className?: string }) {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { groups, total, loading, remoteLoading } = useBrokerGlobalSearch(userId, q);

  const flat = useMemo(() => ORDER.flatMap((k) => groups[k] ?? []), [groups]);

  useEffect(() => { setCursor(0); }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); inputRef.current?.focus(); setOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, []);

  const go = (hit: SearchHit) => { setOpen(false); navigate(hit.href); };

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className={`relative ${className ?? ""}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
        style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)" }}>
        <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--pp-text-muted)" }} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setCursor((i) => Math.min(i + 1, flat.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && flat[cursor]) { e.preventDefault(); go(flat[cursor]); }
          }}
          placeholder={en ? "Search everything (calls, texts, clients, emails…)" : "Chercher partout (appels, textos, clients, courriels…)"}
          className="bg-transparent outline-none text-[12.5px] flex-1 min-w-0 w-full"
          style={{ color: "var(--pp-text-primary)" }}
        />
        {(loading || remoteLoading) && q.trim().length >= 2 && (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: "var(--pp-text-muted)" }} />
        )}
        {q && (
          <button onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="clear" className="shrink-0">
            <X className="w-3.5 h-3.5" style={{ color: "var(--pp-text-muted)" }} />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 mt-2 rounded-xl overflow-hidden z-50"
          style={{
            background: "var(--pp-bg-surface)",
            border: "1px solid var(--pp-bg-border)",
            boxShadow: "0 18px 40px -18px rgba(0,0,0,0.45)",
            maxHeight: "70vh", overflowY: "auto",
            minWidth: 320,
          }}>
          {loading && total === 0 ? (
            <div className="px-4 py-4 text-[12px]" style={{ color: "var(--pp-text-muted)" }}>
              {en ? "Searching…" : "Recherche en cours…"}
            </div>
          ) : total === 0 ? (
            <div className="px-4 py-4 text-[12px]" style={{ color: "var(--pp-text-muted)" }}>
              {en ? "No results" : "Aucun résultat"}
            </div>
          ) : (
            ORDER.map((kind) => {
              const items = groups[kind] ?? [];
              if (!items.length) return null;
              const L = LABELS[kind];
              return (
                <div key={kind}>
                  <div className="flex items-center justify-between px-3 py-1.5"
                    style={{ borderBottom: "1px solid var(--pp-bg-border)", background: "var(--pp-bg-elevated)" }}>
                    <span className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, color: "var(--pp-text-secondary)" }}>
                      <L.Icon className="w-3 h-3" />{en ? L.en : L.fr}
                      <span style={{ color: "var(--pp-text-muted)", fontWeight: 500 }}>({items.length})</span>
                    </span>
                    <button
                      onClick={() => { setOpen(false); navigate(`${L.section}?q=${encodeURIComponent(q.trim())}&search=${encodeURIComponent(q.trim())}`); }}
                      style={{ fontSize: 10.5, color: "var(--pp-brand-accent-2)" }}>
                      {en ? "Open section" : "Ouvrir la section"}
                    </button>
                  </div>
                  {items.map((hit) => {
                    const idx = flat.indexOf(hit);
                    const active = idx === cursor;
                    return (
                      <button key={hit.id} onClick={() => go(hit)} onMouseEnter={() => setCursor(idx)}
                        className="w-full text-left px-3 py-2"
                        style={{ background: active ? "var(--pp-bg-elevated)" : "transparent", borderTop: "1px solid var(--pp-bg-border)" }}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--pp-text-primary)" }}>{toText(hit.primary)}</span>
                          {hit.meta && <span className="shrink-0" style={{ fontSize: 10.5, color: "var(--pp-text-muted)" }}>{toText(hit.meta)}</span>}
                        </div>
                        {hit.secondary && (
                          <div className="truncate" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>{toText(hit.secondary)}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
          {remoteLoading && total > 0 && (
            <div className="px-3 py-2 text-[11px]" style={{ color: "var(--pp-text-muted)", borderTop: "1px solid var(--pp-bg-border)" }}>
              {en ? "Loading Maestro & Microsoft results…" : "Chargement des résultats Maestro et Microsoft…"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
