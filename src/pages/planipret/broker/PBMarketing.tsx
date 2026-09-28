import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Megaphone, Sparkles, RefreshCw, Mail, MessageSquare, Users, Send, CheckCircle2,
  AlertTriangle, ChevronLeft, Search, History,
} from "lucide-react";
import { PAPage, PAPageHeader, PATableWrap } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

type Client = Record<string, any>;
type Target = { client_id?: string; name?: string; phone?: string; email?: string };

type Campaign = {
  id: string; created_at: string; channels: string[]; subject: string | null;
  sms_text: string | null; status: string; broker_name: string | null;
  total_email: number; total_sms: number; sent_email: number; sent_sms: number;
  failed_count: number; opened_count: number; clicked_count: number;
};

type Recipient = {
  id: string; client_name: string | null; email: string | null; phone: string | null;
  channel: string; status: string; error: string | null; sent_at: string | null;
  opened_at: string | null; clicked_at: string | null;
};

const btn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px",
  borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
  border: "1px solid var(--pp-border, #e2e8f0)", background: "var(--pp-bg-surface, #fff)",
  color: "var(--pp-text-primary)",
};
const btnPrimary: React.CSSProperties = { ...btn, background: "#0b3fa8", borderColor: "#0b3fa8", color: "#fff" };
const card: React.CSSProperties = {
  border: "1px solid var(--pp-border, #e2e8f0)", borderRadius: 14,
  background: "var(--pp-bg-surface, #fff)", padding: 16,
};

function clientPhone(c: Client): string {
  return String(c.cell_phone || c.mobile_phone || c.phone || c.telephone || "").trim();
}
function clientEmail(c: Client): string {
  return String(c.email || (Array.isArray(c.emails) ? c.emails[0] : "") || "").trim();
}
function clientName(c: Client): string {
  return String(c.name || c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "—").trim();
}
function clientId(c: Client): string {
  return String(c.id ?? c.client_id ?? c.maestro_id ?? "");
}

export default function PBMarketing({ adminAll = false }: { adminAll?: boolean } = {}) {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  const T = (fr: string, e: string) => (en ? e : fr);

  const [tab, setTab] = useState<"compose" | "history">("compose");
  const [step, setStep] = useState(1);

  // Étape 1
  const [prompt, setPrompt] = useState("");
  const [useEmail, setUseEmail] = useState(true);
  const [useSms, setUseSms] = useState(false);

  // Étape 2
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [subject, setSubject] = useState("");
  const [emailBodyHtml, setEmailBodyHtml] = useState("");
  const [smsText, setSmsText] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [variant, setVariant] = useState(0);

  // Étape 3
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  // Étape 4
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<any>(null);
  const [sendError, setSendError] = useState("");

  // Historique
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);

  const channels = useMemo(
    () => [...(useEmail ? ["email"] : []), ...(useSms ? ["sms"] : [])],
    [useEmail, useSms],
  );

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    const { data } = await supabase
      .from("planipret_marketing_campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setCampaigns((data ?? []) as Campaign[]);
    setHistLoading(false);
  }, []);

  useEffect(() => { if (tab === "history") loadHistory(); }, [tab, loadHistory]);
  useEffect(() => { if (adminAll) setTab("history"); }, [adminAll]);

  useEffect(() => {
    if (!openCampaign) { setRecipients([]); return; }
    (async () => {
      const { data } = await supabase
        .from("planipret_marketing_recipients")
        .select("id, client_name, email, phone, channel, status, error, sent_at, opened_at, clicked_at")
        .eq("campaign_id", openCampaign)
        .order("created_at", { ascending: true });
      setRecipients((data ?? []) as Recipient[]);
    })();
  }, [openCampaign]);

  const generate = async (again = false) => {
    setGenerating(true); setGenError("");
    const nextVariant = again ? variant + 1 : 0;
    setVariant(nextVariant);
    const { data, error } = await supabase.functions.invoke("pp-marketing-compose", {
      body: { prompt, channels, variant: nextVariant },
    });
    setGenerating(false);
    if (error || !data?.ok) {
      setGenError(data?.message || T("Génération impossible pour le moment.", "Could not generate right now."));
      return;
    }
    setSubject(data.subject ?? "");
    setEmailBodyHtml(data.email_body_html ?? "");
    setSmsText(data.sms_text ?? "");
    setPreviewHtml(data.email_preview_html ?? "");
    setStep(2);
  };

  const loadClients = async () => {
    setClientsLoading(true); setClientsError("");
    const { data, error } = await supabase.functions.invoke("maestro-actions", {
      body: { action: "list_clients", payload: { limit: 500, offset: 0 } },
    });
    setClientsLoading(false);
    if (error) { setClientsError(T("Liste des clients indisponible.", "Client list unavailable.")); return; }
    if (data?.success === false) { setClientsError(data?.error || T("Liste des clients indisponible.", "Client list unavailable.")); return; }
    setClients(Array.isArray(data?.clients) ? data.clients : []);
  };

  const goSelect = async () => { setStep(3); if (clients.length === 0) await loadClients(); };

  const visibleClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      `${clientName(c)} ${clientEmail(c)} ${clientPhone(c)}`.toLowerCase().includes(q));
  }, [clients, search]);

  const targets: Target[] = useMemo(
    () => clients.filter((c) => selected[clientId(c)]).map((c) => ({
      client_id: clientId(c) || undefined,
      name: clientName(c),
      phone: clientPhone(c) || undefined,
      email: clientEmail(c) || undefined,
    })),
    [clients, selected],
  );

  const countEmail = targets.filter((t) => t.email).length;
  const countSms = targets.filter((t) => t.phone).length;

  const send = async () => {
    setSending(true); setSendError("");
    const { data, error } = await supabase.functions.invoke("pp-marketing-send", {
      body: {
        confirmed: true, channels, subject, email_body_html: emailBodyHtml,
        sms_text: smsText, prompt, recipients: targets,
      },
    });
    setSending(false);
    if (error || !data?.ok) {
      setSendError(data?.message || T("Envoi impossible.", "Sending failed."));
      return;
    }
    setSendResult(data);
    setStep(5);
  };

  const reset = () => {
    setStep(1); setPrompt(""); setSubject(""); setEmailBodyHtml(""); setSmsText("");
    setPreviewHtml(""); setSelected({}); setSendResult(null); setSendError(""); setVariant(0);
  };

  const statusLabel = (s: string) => ({
    queued: T("En file", "Queued"), sent: T("Envoyé", "Sent"), delivered: T("Livré", "Delivered"),
    opened: T("Ouvert", "Opened"), clicked: T("Cliqué", "Clicked"), failed: T("Échec", "Failed"),
  } as Record<string, string>)[s] ?? s;

  const errorLabel = (e: string | null) => {
    if (!e) return "";
    if (e === "adresse_invalide") return T("Adresse courriel invalide", "Invalid email address");
    if (e === "numero_invalide") return T("Numéro invalide", "Invalid number");
    if (e === "desabonne") return T("Désabonné", "Unsubscribed");
    if (e.startsWith("courriel_refuse")) return T("Courriel refusé", "Email rejected");
    return e;
  };

  const steps = [
    T("Message", "Message"), T("Aperçu", "Preview"),
    T("Clients", "Clients"), T("Confirmation", "Confirm"),
  ];

  return (
    <PAPage>
      {!adminAll && (
        <PAPageHeader
          icon={<Megaphone size={18} />}
          title={T("Marketing", "Marketing")}
          subtitle={T(
            "Rédigez un message, laissez l'IA le mettre en forme, choisissez vos clients et envoyez par texto ou courriel.",
            "Write a message, let AI polish it, pick your clients and send by text or email.",
          )}
        />
      )}

      <div className="flex gap-2 mb-4">
        {!adminAll && (
          <button style={tab === "compose" ? btnPrimary : btn} onClick={() => setTab("compose")}>
            <Sparkles size={15} /> {T("Nouvelle campagne", "New campaign")}
          </button>
        )}
        <button style={tab === "history" ? btnPrimary : btn} onClick={() => setTab("history")}>
          <History size={15} /> {T("Historique", "History")}
        </button>
      </div>

      {tab === "compose" && !adminAll && (
        <>
          <div className="flex flex-wrap gap-2 mb-4 text-xs">
            {steps.map((s, i) => (
              <span key={s} style={{
                padding: "5px 10px", borderRadius: 999,
                background: step > i ? "#0b3fa815" : "transparent",
                border: "1px solid var(--pp-border, #e2e8f0)",
                color: step > i ? "#0b3fa8" : "var(--pp-text-muted)",
                fontWeight: step === i + 1 ? 700 : 500,
              }}>{i + 1}. {s}</span>
            ))}
          </div>

          {step === 1 && (
            <div style={card}>
              <div className="text-sm font-semibold mb-2">{T("Que voulez-vous dire à vos clients ?", "What do you want to tell your clients?")}</div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder={T(
                  "Ex. : Informer mes clients que les taux ont baissé et les inviter à me contacter pour une révision gratuite de leur prêt.",
                  "E.g.: Tell my clients rates went down and invite them to contact me for a free mortgage review.",
                )}
                style={{
                  width: "100%", padding: 12, borderRadius: 10, fontSize: 14,
                  border: "1px solid var(--pp-border, #e2e8f0)", background: "var(--pp-bg-elevated, #fff)",
                  color: "var(--pp-text-primary)",
                }}
              />
              <div className="flex flex-wrap items-center gap-4 mt-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={useEmail} onChange={(e) => setUseEmail(e.target.checked)} />
                  <Mail size={15} /> {T("Courriel", "Email")}
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={useSms} onChange={(e) => setUseSms(e.target.checked)} />
                  <MessageSquare size={15} /> {T("Texto", "Text")}
                </label>
              </div>
              {genError && <div className="mt-3 text-sm" style={{ color: "#b42318" }}>{genError}</div>}
              <div className="mt-4">
                <button
                  style={{ ...btnPrimary, opacity: !prompt.trim() || channels.length === 0 || generating ? 0.6 : 1 }}
                  disabled={!prompt.trim() || channels.length === 0 || generating}
                  onClick={() => generate(false)}
                >
                  {generating ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {T("Générer le message", "Generate message")}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4" style={{ gridTemplateColumns: "1fr" }}>
              {useEmail && (
                <div style={card}>
                  <div className="text-sm font-semibold mb-2 flex items-center gap-2"><Mail size={15} /> {T("Courriel", "Email")}</div>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={T("Objet", "Subject")}
                    style={{ width: "100%", padding: 10, borderRadius: 10, fontSize: 14, marginBottom: 10, border: "1px solid var(--pp-border, #e2e8f0)", background: "var(--pp-bg-elevated,#fff)", color: "var(--pp-text-primary)" }}
                  />
                  <div style={{ border: "1px solid var(--pp-border, #e2e8f0)", borderRadius: 10, overflow: "hidden", background: "#f4f6fb" }}>
                    <iframe title="preview" srcDoc={previewHtml} style={{ width: "100%", height: 460, border: 0, background: "#f4f6fb" }} />
                  </div>
                  <details className="mt-3">
                    <summary className="text-xs cursor-pointer" style={{ color: "var(--pp-text-muted)" }}>
                      {T("Modifier le texte à la main", "Edit the text manually")}
                    </summary>
                    <textarea
                      value={emailBodyHtml}
                      onChange={(e) => setEmailBodyHtml(e.target.value)}
                      rows={10}
                      style={{ width: "100%", marginTop: 8, padding: 10, borderRadius: 10, fontSize: 12, fontFamily: "Fira Code, monospace", border: "1px solid var(--pp-border, #e2e8f0)", background: "var(--pp-bg-elevated,#fff)", color: "var(--pp-text-primary)" }}
                    />
                  </details>
                </div>
              )}

              {useSms && (
                <div style={card}>
                  <div className="text-sm font-semibold mb-2 flex items-center gap-2"><MessageSquare size={15} /> {T("Texto", "Text")}</div>
                  <textarea
                    value={smsText}
                    onChange={(e) => setSmsText(e.target.value)}
                    rows={4}
                    style={{ width: "100%", padding: 10, borderRadius: 10, fontSize: 14, border: "1px solid var(--pp-border, #e2e8f0)", background: "var(--pp-bg-elevated,#fff)", color: "var(--pp-text-primary)" }}
                  />
                  <div className="text-xs mt-1" style={{ color: "var(--pp-text-muted)" }}>{smsText.length} {T("caractères", "characters")}</div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button style={btn} onClick={() => setStep(1)}><ChevronLeft size={15} /> {T("Retour", "Back")}</button>
                <button style={btn} disabled={generating} onClick={() => generate(true)}>
                  {generating ? <RefreshCw size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  {T("Régénérer", "Regenerate")}
                </button>
                <button style={btnPrimary} onClick={goSelect}><Users size={15} /> {T("Choisir les clients", "Choose clients")}</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={card}>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "var(--pp-text-muted)" }} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={T("Rechercher un client…", "Search a client…")}
                    style={{ width: "100%", padding: "9px 10px 9px 32px", borderRadius: 10, fontSize: 13, border: "1px solid var(--pp-border, #e2e8f0)", background: "var(--pp-bg-elevated,#fff)", color: "var(--pp-text-primary)" }}
                  />
                </div>
                <button style={btn} onClick={() => {
                  const next: Record<string, boolean> = { ...selected };
                  visibleClients.forEach((c) => { next[clientId(c)] = true; });
                  setSelected(next);
                }}>{T("Tout sélectionner", "Select all")}</button>
                <button style={btn} onClick={() => setSelected({})}>{T("Tout désélectionner", "Clear")}</button>
                <button style={btn} onClick={loadClients}><RefreshCw size={15} /></button>
              </div>

              {clientsError && <div className="text-sm mb-3" style={{ color: "#b42318" }}>{clientsError}</div>}

              {clientsLoading ? (
                <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <PPSkeleton key={i} style={{ height: 38 }} />)}</div>
              ) : visibleClients.length === 0 ? (
                <PPEmptyState icon={<Users size={20} />} title={T("Aucun client", "No client")} />
              ) : (
                <PATableWrap>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--pp-text-muted)" }}>
                        <th style={{ padding: "8px 10px", width: 36 }}></th>
                        <th style={{ padding: "8px 10px" }}>{T("Client", "Client")}</th>
                        <th style={{ padding: "8px 10px" }}>{T("Cellulaire", "Mobile")}</th>
                        <th style={{ padding: "8px 10px" }}>{T("Courriel", "Email")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleClients.map((c) => {
                        const id = clientId(c);
                        return (
                          <tr key={id || clientName(c)} style={{ borderTop: "1px solid var(--pp-border, #e2e8f0)" }}>
                            <td style={{ padding: "8px 10px" }}>
                              <input
                                type="checkbox"
                                checked={!!selected[id]}
                                onChange={(e) => setSelected((s) => ({ ...s, [id]: e.target.checked }))}
                              />
                            </td>
                            <td style={{ padding: "8px 10px" }}>{clientName(c)}</td>
                            <td style={{ padding: "8px 10px" }}>{clientPhone(c) || "—"}</td>
                            <td style={{ padding: "8px 10px" }}>{clientEmail(c) || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </PATableWrap>
              )}

              <div className="flex flex-wrap gap-2 mt-4">
                <button style={btn} onClick={() => setStep(2)}><ChevronLeft size={15} /> {T("Retour", "Back")}</button>
                <button
                  style={{ ...btnPrimary, opacity: targets.length === 0 ? 0.6 : 1 }}
                  disabled={targets.length === 0}
                  onClick={() => setStep(4)}
                >
                  {T("Continuer", "Continue")} ({targets.length})
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div style={card}>
              <div className="text-sm font-semibold mb-3">{T("Confirmer l'envoi", "Confirm sending")}</div>
              <ul className="text-sm space-y-1" style={{ color: "var(--pp-text-primary)" }}>
                <li>{T("Clients sélectionnés", "Selected clients")} : <strong>{targets.length}</strong></li>
                {useEmail && <li>{T("Courriels à envoyer", "Emails to send")} : <strong>{countEmail}</strong></li>}
                {useSms && <li>{T("Textos à envoyer", "Texts to send")} : <strong>{countSms}</strong></li>}
              </ul>
              <div className="text-xs mt-3" style={{ color: "var(--pp-text-muted)" }}>
                {T(
                  "Les textos partent de votre numéro et les courriels de votre boîte Outlook. Les clients sans numéro ou sans adresse ne reçoivent rien.",
                  "Texts come from your number and emails from your Outlook mailbox. Clients without a number or address receive nothing.",
                )}
              </div>
              {sendError && <div className="mt-3 text-sm" style={{ color: "#b42318" }}>{sendError}</div>}
              <div className="flex flex-wrap gap-2 mt-4">
                <button style={btn} onClick={() => setStep(3)}><ChevronLeft size={15} /> {T("Retour", "Back")}</button>
                <button style={{ ...btnPrimary, opacity: sending ? 0.6 : 1 }} disabled={sending} onClick={send}>
                  {sending ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
                  {T("Envoyer maintenant", "Send now")}
                </button>
              </div>
            </div>
          )}

          {step === 5 && sendResult && (
            <div style={card}>
              <div className="flex items-center gap-2 text-sm font-semibold mb-2" style={{ color: "#0a7c42" }}>
                <CheckCircle2 size={17} /> {T("Campagne envoyée", "Campaign sent")}
              </div>
              <ul className="text-sm space-y-1">
                <li>{T("Courriels envoyés", "Emails sent")} : <strong>{sendResult.sent_email}</strong></li>
                <li>{T("Textos envoyés", "Texts sent")} : <strong>{sendResult.sent_sms}</strong></li>
                <li>{T("Échecs", "Failures")} : <strong>{sendResult.failed}</strong></li>
              </ul>
              <div className="flex gap-2 mt-4">
                <button style={btn} onClick={reset}>{T("Nouvelle campagne", "New campaign")}</button>
                <button style={btnPrimary} onClick={() => { setTab("history"); loadHistory(); }}>{T("Voir l'historique", "View history")}</button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <div style={card}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">
              {adminAll ? T("Toutes les campagnes", "All campaigns") : T("Mes campagnes", "My campaigns")}
            </div>
            <button style={btn} onClick={loadHistory}><RefreshCw size={15} /></button>
          </div>

          <div className="text-xs mb-3 flex items-start gap-2" style={{ color: "var(--pp-text-muted)" }}>
            <AlertTriangle size={14} style={{ marginTop: 2 }} />
            <span>{T(
              "Les ouvertures de courriel sont estimées (certains clients bloquent les images). Les textos n'ont aucun accusé de lecture : seuls l'envoi et les échecs sont connus.",
              "Email opens are estimated (some clients block images). Texts have no read receipt: only sending and failures are known.",
            )}</span>
          </div>

          {histLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <PPSkeleton key={i} style={{ height: 44 }} />)}</div>
          ) : campaigns.length === 0 ? (
            <PPEmptyState icon={<Megaphone size={20} />} title={T("Aucune campagne", "No campaign yet")} />
          ) : (
            <PATableWrap>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--pp-text-muted)" }}>
                    <th style={{ padding: "8px 10px" }}>{T("Date", "Date")}</th>
                    {adminAll && <th style={{ padding: "8px 10px" }}>{T("Courtier", "Broker")}</th>}
                    <th style={{ padding: "8px 10px" }}>{T("Canal", "Channel")}</th>
                    <th style={{ padding: "8px 10px" }}>{T("Objet / texto", "Subject / text")}</th>
                    <th style={{ padding: "8px 10px" }}>{T("Envoyés", "Sent")}</th>
                    <th style={{ padding: "8px 10px" }}>{T("Ouverts", "Opened")}</th>
                    <th style={{ padding: "8px 10px" }}>{T("Clics", "Clicks")}</th>
                    <th style={{ padding: "8px 10px" }}>{T("Échecs", "Failed")}</th>
                    <th style={{ padding: "8px 10px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} style={{ borderTop: "1px solid var(--pp-border, #e2e8f0)" }}>
                      <td style={{ padding: "8px 10px" }}>{new Date(c.created_at).toLocaleString(en ? "en-CA" : "fr-CA")}</td>
                      {adminAll && <td style={{ padding: "8px 10px" }}>{c.broker_name || "—"}</td>}
                      <td style={{ padding: "8px 10px" }}>{(c.channels ?? []).map((ch) => ch === "sms" ? T("Texto", "Text") : T("Courriel", "Email")).join(" + ")}</td>
                      <td style={{ padding: "8px 10px", maxWidth: 280 }} className="truncate">{c.subject || c.sms_text || "—"}</td>
                      <td style={{ padding: "8px 10px" }}>{c.sent_email + c.sent_sms}</td>
                      <td style={{ padding: "8px 10px" }}>{c.opened_count}</td>
                      <td style={{ padding: "8px 10px" }}>{c.clicked_count}</td>
                      <td style={{ padding: "8px 10px", color: c.failed_count ? "#b42318" : undefined }}>{c.failed_count}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <button style={{ ...btn, padding: "5px 10px" }} onClick={() => setOpenCampaign(openCampaign === c.id ? null : c.id)}>
                          {openCampaign === c.id ? T("Fermer", "Close") : T("Détail", "Detail")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PATableWrap>
          )}

          {openCampaign && (
            <div className="mt-4">
              <div className="text-sm font-semibold mb-2">{T("Destinataires", "Recipients")}</div>
              <PATableWrap>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--pp-text-muted)" }}>
                      <th style={{ padding: "8px 10px" }}>{T("Client", "Client")}</th>
                      <th style={{ padding: "8px 10px" }}>{T("Canal", "Channel")}</th>
                      <th style={{ padding: "8px 10px" }}>{T("Destination", "Destination")}</th>
                      <th style={{ padding: "8px 10px" }}>{T("Statut", "Status")}</th>
                      <th style={{ padding: "8px 10px" }}>{T("Détail", "Detail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.map((r) => (
                      <tr key={r.id} style={{ borderTop: "1px solid var(--pp-border, #e2e8f0)" }}>
                        <td style={{ padding: "8px 10px" }}>{r.client_name || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.channel === "sms" ? T("Texto", "Text") : T("Courriel", "Email")}</td>
                        <td style={{ padding: "8px 10px" }}>{r.email || r.phone || "—"}</td>
                        <td style={{ padding: "8px 10px", color: r.status === "failed" ? "#b42318" : undefined }}>{statusLabel(r.status)}</td>
                        <td style={{ padding: "8px 10px", color: "var(--pp-text-muted)" }}>{errorLabel(r.error)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PATableWrap>
            </div>
          )}
        </div>
      )}
    </PAPage>
  );
}
