import { Link } from "react-router-dom";
import { MessageSquare, Phone, Sparkles, Users } from "lucide-react";
import { OvCard, OvEmpty } from "./OvCard";
import { callPeer, fmtDateTime, fmtDuration } from "@/lib/planipret/brokerFormat";
import type { OvContact } from "@/hooks/useBrokerOverview";

/* ---------- 3D table primitives ---------- */

const headStyle: React.CSSProperties = {
  color: "var(--pp-text-muted)",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  textAlign: "left",
  background: "linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,0))",
  borderBottom: "1px solid var(--pp-bg-border)",
  boxShadow: "0 1px 0 rgba(255,255,255,.05) inset",
};

function Row3D({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <tr
      className="pp-row3d"
      style={{
        background: `linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.10)), var(--pp-bg-card, var(--pp-bg-elevated))`,
        boxShadow: `0 8px 18px -16px rgba(0,0,0,.95), 0 1px 0 rgba(255,255,255,.05) inset, inset 3px 0 0 ${accent}66`,
        color: "var(--pp-text-secondary)",
      }}
    >
      {children}
    </tr>
  );
}

function Table3D({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        .pp-t3d { width:100%; font-size:12px; border-collapse:separate; border-spacing:0 6px; }
        .pp-t3d th { padding:6px 10px; }
        .pp-t3d td { padding:9px 10px; }
        .pp-t3d tr.pp-row3d td:first-child { border-top-left-radius:10px; border-bottom-left-radius:10px; }
        .pp-t3d tr.pp-row3d td:last-child { border-top-right-radius:10px; border-bottom-right-radius:10px; }
        .pp-t3d tr.pp-row3d { transition: transform .18s ease, box-shadow .18s ease; }
        .pp-t3d tr.pp-row3d:hover { transform: translateY(-2px); }
      `}</style>
      <table className="pp-t3d">{children}</table>
    </>
  );
}

function StatusBadge({ call, lang }: { call: any; lang: "fr" | "en" }) {
  const missed = call.status === "missed" || call.direction === "missed";
  const color = missed ? "#E84C4C" : "#22c55e";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color,
        border: `1px solid ${color}44`,
        background: `linear-gradient(180deg, ${color}26, ${color}0d)`,
        boxShadow: `0 4px 10px -8px ${color}, 0 1px 0 rgba(255,255,255,.08) inset`,
        borderRadius: 999,
        padding: "2px 8px",
      }}
    >
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
          <Table3D>
            <thead>
              <tr>
                <th style={headStyle}>{lang === "en" ? "When" : "Quand"}</th>
                <th style={headStyle}>{lang === "en" ? "Contact" : "Correspondant"}</th>
                <th style={headStyle}>{lang === "en" ? "Duration" : "Durée"}</th>
                <th style={headStyle}>{lang === "en" ? "Status" : "Statut"}</th>
                <th style={headStyle}>IA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const missed = c.status === "missed" || c.direction === "missed";
                return (
                  <Row3D key={c.id} accent={missed ? "#E84C4C" : c.direction === "outbound" ? "#00D4AA" : "#2E9BDC"}>
                    <td className="whitespace-nowrap">{fmtDateTime(c.created_at, lang)}</td>
                    <td className="whitespace-nowrap" style={{ color: "var(--pp-text-primary)", fontWeight: 600 }}>{callPeer(c)}</td>
                    <td className="whitespace-nowrap tabular-nums">{fmtDuration(c.duration_seconds)}</td>
                    <td><StatusBadge call={c} lang={lang} /></td>
                    <td>{c.ai_summary ? <Sparkles className="w-3.5 h-3.5" style={{ color: "#9B7FE8" }} /> : <span style={{ color: "var(--pp-text-muted)" }}>—</span>}</td>
                  </Row3D>
                );
              })}
            </tbody>
          </Table3D>
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
              <div
                className="transition-transform duration-200 hover:-translate-y-0.5"
                style={{
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: "linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.10)), var(--pp-bg-card, var(--pp-bg-elevated))",
                  boxShadow: "0 10px 20px -18px rgba(0,0,0,.95), 0 1px 0 rgba(255,255,255,.05) inset, inset 3px 0 0 #4AC9E366",
                }}
              >
                <div style={{ fontSize: 12, color: "var(--pp-text-primary)", fontWeight: 600 }}>{m.peer}</div>
                <div className="truncate" style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>
                  {m.body || "—"} · {fmtDateTime(m.created_at, lang)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </OvCard>
  );
}

export function OvTopContacts({ rows, lang }: { rows: OvContact[]; lang: "fr" | "en" }) {
  const max = Math.max(1, ...rows.map((r) => r.calls || 0));
  return (
    <OvCard title={lang === "en" ? "Top contacts" : "Meilleurs contacts"} icon={<Users className="w-4 h-4" />}>
      {!rows.length ? <OvEmpty label={lang === "en" ? "No data" : "Aucune donnée"} /> : (
        <Table3D>
          <tbody>
            {rows.map((r) => (
              <Row3D key={r.peer} accent="#9B7FE8">
                <td style={{ color: "var(--pp-text-primary)", fontWeight: 600 }}>
                  <div>{r.peer}</div>
                  <div style={{ height: 4, borderRadius: 999, marginTop: 5, background: "rgba(255,255,255,.06)" }}>
                    <div
                      style={{
                        height: 4,
                        width: `${Math.round(((r.calls || 0) / max) * 100)}%`,
                        borderRadius: 999,
                        background: "linear-gradient(90deg, #9B7FE8, #2E9BDC)",
                        boxShadow: "0 0 10px -2px #9B7FE8",
                      }}
                    />
                  </div>
                </td>
                <td className="text-right tabular-nums" style={{ color: "var(--pp-text-secondary)" }}>{r.calls}</td>
                <td className="text-right whitespace-nowrap" style={{ color: "var(--pp-text-muted)" }}>{fmtDuration(r.seconds)}</td>
              </Row3D>
            ))}
          </tbody>
        </Table3D>
      )}
    </OvCard>
  );
}
