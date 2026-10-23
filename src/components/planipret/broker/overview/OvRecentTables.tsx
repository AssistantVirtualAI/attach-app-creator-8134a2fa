import { memo, useEffect, useMemo, useState } from "react";
import { resolveCallerClient } from "@/lib/planipret/callerClient";
import { useCallerNames } from "@/lib/planipret/callerLookup";
import { formatPhoneDisplay } from "@/lib/planipret/ovPeer";
import { Link } from "react-router-dom";
import { MessageSquare, Phone, Sparkles, Users } from "lucide-react";
import { OvCard, OvEmpty } from "./OvCard";
import { Badge3D, MicroBar3D, OV3D, Row3D, Table3D, Threshold3D } from "./ov3d";
import { callPeer, fmtDateTime, fmtDuration } from "@/lib/planipret/brokerFormat";
import { useOv3dQuiet } from "@/hooks/useOv3dIntensity";
import type { OvContact } from "@/hooks/useBrokerOverview";

function StatusBadge({ call, lang }: { call: any; lang: "fr" | "en" }) {
  const missed = call.status === "missed" || call.direction === "missed";
  const color = missed ? OV3D.missed : call.direction === "outbound" ? OV3D.out : OV3D.good;
  return (
    <Badge3D color={color}>
      {missed
        ? (lang === "en" ? "Missed" : "Manqué")
        : call.direction === "outbound"
          ? (lang === "en" ? "Outbound" : "Sortant")
          : (lang === "en" ? "Inbound" : "Entrant")}
    </Badge3D>
  );
}

/** Resolves the broker's own Maestro client names for a list of numbers (scoped, cached). */
function useClientNames(numbers: (string | null | undefined)[]) {
  const key = Array.from(new Set(numbers.map((n) => String(n ?? "").replace(/\D/g, "").slice(-10)).filter((n) => n.length === 10))).join(",");
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let off = false;
    const list = key ? key.split(",") : [];
    Promise.all(list.map(async (n) => [n, (await resolveCallerClient(n)).name] as const)).then((r) => {
      if (!off) setNames(Object.fromEntries(r.filter(([, v]) => !!v) as [string, string][]));
    });
    return () => { off = true; };
  }, [key]);
  return (n: unknown) => names[String(n ?? "").replace(/\D/g, "").slice(-10)] ?? null;
}

function PeerCell({ contact, client, number }: { contact: string | null; client: string | null; number: string | null }) {
  const phone = formatPhoneDisplay(number);
  const primary = contact || client || phone || "—";
  const secondary = [client && client !== primary ? client : null, phone && phone !== primary ? phone : null].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      <div className="truncate" style={{ color: "var(--pp-text-primary)", fontWeight: 600 }}>{primary}</div>
      {secondary && <div className="truncate" style={{ fontSize: 11, color: "var(--pp-text-muted)", fontWeight: 400 }}>{secondary}</div>}
    </div>
  );
}

const callNumber = (c: any) => (c?.direction === "inbound" ? c?.from_number : c?.to_number) ?? null;
const callContact = (c: any) => {
  const n = c?.direction === "inbound" ? c?.from_name : c?.to_name;
  const s = String(n ?? "").trim();
  return s && /[a-zA-ZÀ-ÿ]/.test(s) ? s : null;
};
const msgNumber = (m: any) => (m?.direction === "inbound" ? m?.from_number : m?.to_number) ?? null;

export const OvRecentCalls = memo(function OvRecentCalls({ rows, lang }: { rows: any[]; lang: "fr" | "en" }) {
  const { maxDur, avgDur } = useMemo(() => {
    const durs = rows.map((r) => Number(r.duration_seconds ?? 0));
    const answered = durs.filter((d) => d > 0);
    return {
      maxDur: Math.max(1, ...durs),
      avgDur: answered.length ? answered.reduce((a, b) => a + b, 0) / answered.length : 0,
    };
  }, [rows]);

  const quiet = useOv3dQuiet([rows.length, (rows[0] as any)?.id ?? null]);
  const clientOf = useClientNames(rows.map(callNumber));
  const peerNames = useCallerNames(rows.map((r) => callNumber(r) ?? callPeer(r)));

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
          <Table3D quiet={quiet}>
            <thead>
              <tr>
                <th>{lang === "en" ? "When" : "Quand"}</th>
                <th>{lang === "en" ? "Contact" : "Correspondant"}</th>
                <th>{lang === "en" ? "Duration" : "Durée"}</th>
                <th>{lang === "en" ? "Status" : "Statut"}</th>
                <th>IA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const missed = c.status === "missed" || c.direction === "missed";
                const dur = Number(c.duration_seconds ?? 0);
                const vsAvg = avgDur > 0 && dur > 0 ? ((dur - avgDur) / avgDur) * 100 : null;
                const accent = missed ? OV3D.missed : c.direction === "outbound" ? OV3D.out : OV3D.in;
                return (
                  <Row3D key={c.id} accent={accent}>
                    <td className="whitespace-nowrap">{fmtDateTime(c.created_at, lang)}</td>
                    <td style={{ maxWidth: 220 }}>
                      <PeerCell contact={callContact(c) || peerNames[callNumber(c) ?? callPeer(c)] || null} client={clientOf(callNumber(c))} number={callNumber(c) ?? callPeer(c)} />
                    </td>
                    <td className="whitespace-nowrap" style={{ minWidth: 116 }}>
                      <div className="flex items-center gap-1.5">
                        <span className="tabular-nums">{fmtDuration(dur)}</span>
                        {!missed && (
                          <Threshold3D
                            value={dur}
                            warn={60}
                            bad={20}
                            label={lang === "en" ? "Call length vs 60s / 20s thresholds" : "Durée vs seuils 60 s / 20 s"}
                          />
                        )}
                      </div>
                      {!missed && (
                        <MicroBar3D
                          value={dur}
                          max={maxDur}
                          color={accent}
                          caption={vsAvg == null ? undefined : `${vsAvg >= 0 ? "+" : ""}${Math.round(vsAvg)}% ${lang === "en" ? "vs avg" : "vs moy."}`}
                        />
                      )}
                    </td>
                    <td><StatusBadge call={c} lang={lang} /></td>
                    <td>{c.ai_summary ? <Sparkles className="w-3.5 h-3.5" style={{ color: OV3D.accent }} /> : <span style={{ color: "var(--pp-text-muted)" }}>—</span>}</td>
                  </Row3D>
                );
              })}
            </tbody>
          </Table3D>
        </div>
      )}
    </OvCard>
  );
});

export const OvRecentMessages = memo(function OvRecentMessages({ rows, lang }: { rows: any[]; lang: "fr" | "en" }) {
  const quiet = useOv3dQuiet([rows.length, (rows[0] as any)?.id ?? null]);
  const clientOf = useClientNames(rows.map(msgNumber));
  const peerNames = useCallerNames(rows.map((m) => msgNumber(m) ?? m.peer));

  return (
    <OvCard
      title={lang === "en" ? "Recent texts" : "Derniers textos"}
      icon={<MessageSquare className="w-4 h-4" />}
      to="/planipret/broker/messages"
      toLabel={lang === "en" ? "View all" : "Voir tout"}
    >
      {!rows.length ? <OvEmpty label={lang === "en" ? "No texts" : "Aucun texto"} /> : (
        <div className="space-y-2">
          {rows.map((m) => {
            const outbound = m.direction === "outbound" || m.direction === "out";
            const accent = outbound ? OV3D.out : OV3D.cyan;
            return (
              <Link key={m.id} to="/planipret/broker/messages" className="block">
                <div className="ov3d-tile" style={{ ["--ov3d-accent" as any]: accent }}>
                  <div className="flex items-center justify-between gap-2">
                    <div style={{ fontSize: 12 }} className="min-w-0"><PeerCell contact={m.contact_name || peerNames[msgNumber(m) ?? m.peer] || null} client={clientOf(msgNumber(m))} number={msgNumber(m) ?? m.peer} /></div>
                    <Badge3D color={accent}>
                      {outbound ? (lang === "en" ? "Sent" : "Envoyé") : (lang === "en" ? "Received" : "Reçu")}
                    </Badge3D>
                  </div>
                  <div className="truncate" style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>
                    {m.body || "—"} · {fmtDateTime(m.created_at, lang)}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </OvCard>
  );
});

export const OvTopContacts = memo(function OvTopContacts({ rows, lang }: { rows: OvContact[]; lang: "fr" | "en" }) {
  const { max, total } = useMemo(() => ({
    max: Math.max(1, ...rows.map((r) => r.calls || 0)),
    total: rows.reduce((a, b) => a + (b.calls || 0), 0),
  }), [rows]);

  const quiet = useOv3dQuiet([rows.length, rows[0]?.peer ?? null]);

  return (
    <OvCard title={lang === "en" ? "Top contacts" : "Meilleurs contacts"} icon={<Users className="w-4 h-4" />}>
      {!rows.length ? <OvEmpty label={lang === "en" ? "No data" : "Aucune donnée"} /> : (
        <Table3D quiet={quiet}>
          <tbody>
            {rows.map((r) => {
              const share = total ? Math.round(((r.calls || 0) / total) * 100) : 0;
              const avg = r.calls ? Math.round((r.seconds || 0) / r.calls) : 0;
              return (
                <Row3D key={r.peer} accent={OV3D.accent}>
                  <td style={{ color: "var(--pp-text-primary)", fontWeight: 600 }}>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{r.peer}</span>
                      <Badge3D color={OV3D.accent}>{share}%</Badge3D>
                    </div>
                    <MicroBar3D
                      value={r.calls || 0}
                      max={max}
                      color={OV3D.accent}
                      caption={`${lang === "en" ? "Avg" : "Moy."} ${fmtDuration(avg)}`}
                    />
                  </td>
                  <td className="text-right tabular-nums" style={{ color: "var(--pp-text-secondary)" }}>{r.calls}</td>
                  <td className="text-right whitespace-nowrap" style={{ color: "var(--pp-text-muted)" }}>{fmtDuration(r.seconds)}</td>
                </Row3D>
              );
            })}
          </tbody>
        </Table3D>
      )}
    </OvCard>
  );
});
