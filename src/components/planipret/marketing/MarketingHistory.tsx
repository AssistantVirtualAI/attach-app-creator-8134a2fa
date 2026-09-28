import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, ChevronRight, Info, Mail, MessageSquare, RefreshCw } from "lucide-react";

type Campaign = {
  id: string; broker_user_id: string; broker_name: string | null; channels: string[]; subject: string | null;
  sms_text: string | null; status: string; total_email: number; total_sms: number; sent_email: number; sent_sms: number;
  failed_count: number; opened_count: number; clicked_count: number; created_at: string;
};
type Recipient = {
  id: string; client_name: string | null; phone: string | null; email: string | null; channel: string;
  status: string; error: string | null; sent_at: string | null; opened_at: string | null; clicked_at: string | null;
};

const ERR: Record<string, [string, string]> = {
  numero_invalide: ["Numéro invalide", "Invalid number"],
  adresse_invalide: ["Adresse invalide", "Invalid address"],
  adresse_refusee: ["Adresse refusée", "Address rejected"],
  desabonne: ["Désabonné", "Unsubscribed"],
};

const card: CSSProperties = {
  background: "var(--pp-bg-card)", border: "1px solid var(--pp-bg-border)",
  borderRadius: 14, color: "var(--pp-text-primary)",
};
const input: CSSProperties = {
  background: "var(--pp-bg-deep)", color: "var(--pp-text-primary)",
  border: "1px solid var(--pp-bg-border)", borderRadius: 10, padding: "8px 12px", fontSize: 14,
};
const btnGhost: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 10, padding: "8px 14px",
  fontSize: 14, fontWeight: 600, cursor: "pointer", background: "transparent",
  border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)",
};
const muted: CSSProperties = { color: "var(--pp-text-muted)" };

export default function MarketingHistory({ lang, adminView = false, reloadKey = 0 }: { lang: "fr" | "en"; adminView?: boolean; reloadKey?: number }) {
  const L = (fr: string, en: string) => (lang === "en" ? en : fr);
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [recips, setRecips] = useState<Record<string, Recipient[]>>({});
  const [broker, setBroker] = useState("all");
  const [period, setPeriod] = useState("30");

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("planipret_marketing_campaigns").select("*").order("created_at", { ascending: false }).limit(300);
    if (period !== "all") q = q.gte("created_at", new Date(Date.now() - Number(period) * 86400000).toISOString());
    const { data } = await q;
    setRows((data ?? []) as Campaign[]);
    setLoading(false);
  }, [period]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const toggle = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!recips[id]) {
      const { data } = await supabase.from("planipret_marketing_recipients")
        .select("id, client_name, phone, email, channel, status, error, sent_at, opened_at, clicked_at")
        .eq("campaign_id", id).order("created_at");
      setRecips((m) => ({ ...m, [id]: (data ?? []) as Recipient[] }));
    }
  };

  const brokers = useMemo(() => Array.from(new Map(rows.map((r) => [r.broker_user_id, r.broker_name || r.broker_user_id.slice(0, 8)])).entries()), [rows]);
  const shown = rows.filter((r) => broker === "all" || r.broker_user_id === broker);
  const tot = shown.reduce((a, r) => ({
    c: a.c + 1, se: a.se + r.sent_email, ss: a.ss + r.sent_sms, f: a.f + r.failed_count, o: a.o + r.opened_count, k: a.k + r.clicked_count,
  }), { c: 0, se: 0, ss: 0, f: 0, o: 0, k: 0 });

  const statusLabel = (r: Recipient): [string, string] => {
    if (r.status === "failed") return [ERR[r.error ?? ""]?.[lang === "en" ? 1 : 0] ?? L("Échec", "Failed"), "var(--pp-danger, #FF6B6B)"];
    if (r.status === "clicked") return [L("Cliqué", "Clicked"), "var(--pp-brand-accent-2, #2E9BDC)"];
    if (r.status === "opened") return [L("Ouvert (estimé)", "Opened (estimated)"), "var(--pp-brand-accent-2, #2E9BDC)"];
    if (r.status === "delivered") return [L("Livré", "Delivered"), "var(--pp-text-primary)"];
    if (r.status === "sent") return [r.channel === "sms" ? L("Envoyé — lecture non mesurable", "Sent — read not measurable") : L("Envoyé — non ouvert", "Sent — not opened"), "var(--pp-text-muted)"];
    return [L("En file", "Queued"), "var(--pp-text-muted)"];
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {adminView && (
          <select value={broker} onChange={(e) => setBroker(e.target.value)} style={input}>
            <option value="all">{L("Tous les courtiers", "All brokers")}</option>
            {brokers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        )}
        <select value={period} onChange={(e) => setPeriod(e.target.value)} style={input}>
          <option value="7">{L("7 derniers jours", "Last 7 days")}</option>
          <option value="30">{L("30 derniers jours", "Last 30 days")}</option>
          <option value="90">{L("90 derniers jours", "Last 90 days")}</option>
          <option value="all">{L("Tout", "All time")}</option>
        </select>
        <button onClick={() => void load()} style={{ ...btnGhost, marginLeft: "auto" }}><RefreshCw className="w-4 h-4" />{L("Actualiser", "Refresh")}</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {[[L("Campagnes", "Campaigns"), tot.c], [L("Courriels envoyés", "Emails sent"), tot.se], [L("Textos envoyés", "Texts sent"), tot.ss],
          [L("Ouvertures (estimées)", "Opens (estimated)"), tot.o], [L("Clics", "Clicks"), tot.k], [L("Échecs", "Failures"), tot.f]].map(([k, v]) => (
          <div key={String(k)} style={{ ...card, padding: 12 }}>
            <div style={{ ...muted, fontSize: 12 }}>{k}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div>
          </div>
        ))}
      </div>

      <p className="flex gap-2" style={{ ...muted, fontSize: 12 }}><Info className="w-4 h-4 shrink-0" />
        {L("Ouvertures courriel estimées par pixel (sous-estimées si le client bloque les images). Les textos n'ont aucun accusé de lecture : seul l'envoi est mesurable.",
          "Email opens are estimated by pixel (under-counted when images are blocked). Texts have no read receipts: only sending is measurable.")}
      </p>

      {loading ? <div className="h-24 rounded-xl animate-pulse" style={{ background: "var(--pp-bg-card)" }} /> : shown.length === 0 ? (
        <div style={{ ...card, padding: 24, textAlign: "center", fontSize: 14, color: "var(--pp-text-muted)" }}>{L("Aucun envoi pour cette période.", "No sends for this period.")}</div>
      ) : (
        <div className="space-y-2">
          {shown.map((c) => (
            <div key={c.id} style={card}>
              <button onClick={() => void toggle(c.id)} className="w-full flex items-center gap-3 p-3 text-left" style={{ color: "var(--pp-text-primary)", cursor: "pointer" }}>
                {open === c.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{c.subject || c.sms_text?.slice(0, 60) || L("Campagne", "Campaign")}</div>
                  <div style={{ ...muted, fontSize: 12 }}>
                    {new Date(c.created_at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA")}{adminView && c.broker_name ? ` · ${c.broker_name}` : ""}
                  </div>
                </div>
                <div className="flex gap-3" style={{ fontSize: 12 }}>
                  {c.channels.includes("email") && <span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{c.sent_email}/{c.total_email} · {c.opened_count} {L("ouv.", "opens")}</span>}
                  {c.channels.includes("sms") && <span className="inline-flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{c.sent_sms}/{c.total_sms}</span>}
                  {c.failed_count > 0 && <span style={{ color: "var(--pp-danger, #FF6B6B)" }}>{c.failed_count} {L("échecs", "failed")}</span>}
                </div>
              </button>
              {open === c.id && (
                <div className="p-3 overflow-x-auto" style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                  <table className="w-full" style={{ fontSize: 14 }}>
                    <thead><tr style={{ ...muted, fontSize: 12, textAlign: "left" }}><th className="py-1">{L("Client", "Client")}</th><th>{L("Canal", "Channel")}</th><th>{L("Destination", "Destination")}</th><th>{L("Statut", "Status")}</th></tr></thead>
                    <tbody>
                      {(recips[c.id] ?? []).map((r) => {
                        const [lbl, color] = statusLabel(r);
                        return (
                          <tr key={r.id} style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                            <td className="py-1.5">{r.client_name || "—"}</td>
                            <td>{r.channel === "sms" ? L("Texto", "Text") : L("Courriel", "Email")}</td>
                            <td style={muted}>{r.channel === "sms" ? r.phone : r.email}</td>
                            <td style={{ color }}>{lbl}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
