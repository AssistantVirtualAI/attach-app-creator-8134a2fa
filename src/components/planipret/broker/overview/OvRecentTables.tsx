import { Link } from "react-router-dom";
import { MessageSquare, Phone, Sparkles, Users } from "lucide-react";
import { OvCard, OvEmpty } from "./OvCard";
import { callPeer, fmtDateTime, fmtDuration } from "@/lib/planipret/brokerFormat";
import type { OvContact } from "@/hooks/useBrokerOverview";

function StatusBadge({ call, lang }: { call: any; lang: "fr" | "en" }) {
  const missed = call.status === "missed" || call.direction === "missed";
  const color = missed ? "#E84C4C" : "#22c55e";
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color, border: `1px solid ${color}33`, borderRadius: 6, padding: "1px 6px" }}>
      {missed ? (lang === "en" ? "Missed" : "Manqué") : call.direction === "outbound" ? (lang === "en" ? "Outbound" : "Sortant") : (lang === "en" ? "Inbound" : "Entrant")}
    </span>
  );
}

export function OvRecentCalls({ rows, lang }: { rows: any[]; lang: "fr" | "en" }) {
  return (
    <OvCard
      title={lang === "en" ? "Recent calls" : "Derniers appels"}
      icon={<Phone className="w-4 h-4" />}
      to="/planipret/broker/calls"
      toLabel={lang === "en" ? "View all" : "Voir tout"}
      className="xl:col-span-2"
    >
      {!rows.length ? <OvEmpty label={lang === "en" ? "No calls" : "Aucun appel"} /> : (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--pp-text-muted)", fontSize: 11, textAlign: "left" }}>
                <th className="py-1.5">{lang === "en" ? "When" : "Quand"}</th>
                <th>{lang === "en" ? "Contact" : "Correspondant"}</th>
                <th>{lang === "en" ? "Duration" : "Durée"}</th>
                <th>{lang === "en" ? "Status" : "Statut"}</th>
                <th>IA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
                  <td className="py-1.5 whitespace-nowrap">{fmtDateTime(c.created_at, lang)}</td>
                  <td className="whitespace-nowrap" style={{ color: "var(--pp-text-primary)" }}>{callPeer(c)}</td>
                  <td className="whitespace-nowrap">{fmtDuration(c.duration_seconds)}</td>
                  <td><StatusBadge call={c} lang={lang} /></td>
                  <td>{c.ai_summary ? <Sparkles className="w-3.5 h-3.5" style={{ color: "#9B7FE8" }} /> : <span style={{ color: "var(--pp-text-muted)" }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OvCard>
  );
}

export function OvRecentMessages({ rows, lang }: { rows: any[]; lang: "fr" | "en" }) {
  return (
    <OvCard
      title={lang === "en" ? "Recent texts" : "Derniers textos"}
      icon={<MessageSquare className="w-4 h-4" />}
      to="/planipret/broker/messages"
      toLabel={lang === "en" ? "View all" : "Voir tout"}
    >
      {!rows.length ? <OvEmpty label={lang === "en" ? "No texts" : "Aucun texto"} /> : (
        <div className="space-y-2">
          {rows.map((m) => (
            <Link key={m.id} to="/planipret/broker/messages" className="block">
              <div style={{ fontSize: 12, color: "var(--pp-text-primary)" }}>{m.peer}</div>
              <div className="truncate" style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>
                {m.body || "—"} · {fmtDateTime(m.created_at, lang)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </OvCard>
  );
}

export function OvTopContacts({ rows, lang }: { rows: OvContact[]; lang: "fr" | "en" }) {
  return (
    <OvCard title={lang === "en" ? "Top contacts" : "Meilleurs contacts"} icon={<Users className="w-4 h-4" />}>
      {!rows.length ? <OvEmpty label={lang === "en" ? "No data" : "Aucune donnée"} /> : (
        <table className="w-full" style={{ fontSize: 12 }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.peer} style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                <td className="py-1.5" style={{ color: "var(--pp-text-primary)" }}>{r.peer}</td>
                <td className="text-right" style={{ color: "var(--pp-text-secondary)" }}>{r.calls}</td>
                <td className="text-right whitespace-nowrap" style={{ color: "var(--pp-text-muted)" }}>{fmtDuration(r.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </OvCard>
  );
}
