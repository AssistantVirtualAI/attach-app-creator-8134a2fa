import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MessageSquare, Trash2, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import PortalSmsComposer from "@/components/planipret/PortalSmsComposer";
import { useSmsThreadState, smsThreadKey, isHidden } from "@/lib/planipret/smsThreadState";
import { confirmDialog } from "@/lib/confirmDialog";
import { toast } from "sonner";
import { smsDeliveryLabel } from "@/lib/planipret/smsDelivery";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import Pagination from "@/components/planipret/admin/Pagination";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";
import { fmtDateTime, msgPeer } from "@/lib/planipret/brokerFormat";
import { useCallerNames } from "@/lib/planipret/callerLookup";
import { brokerSelect, searchFilter, periodStartISO, PERIOD_OPTIONS, type BrokerPeriod } from "@/lib/planipret/brokerAccess";
import PPPageBanner from "@/components/planipret/analytics/PPPageBanner";
import PPActivityCharts from "@/components/planipret/analytics/PPActivityCharts";
import ppBanner from "@/assets/planipret/banner-messages.jpg";

type Thread = { key: string; peer: string; last: any; messages: any[]; unread: number };

const THREADS_PER_PAGE = 20;

export default function PBMessages() {
  const { userId, authUserId } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [params, setParams] = useSearchParams();

  const period = (params.get("period") ?? "") as BrokerPeriod;
  const direction = params.get("direction") ?? "";
  const status = params.get("status") ?? "";
  const search = params.get("q") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [composeTarget, setComposeTarget] = useState<{ number: string } | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const { state: smsState, act: smsAct } = useSmsThreadState(userId);

  const patch = (next: Record<string, string | null>, resetPage = true) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => { if (!v) p.delete(k); else p.set(k, v); });
    if (resetPage) p.set("page", "1");
    setParams(p, { replace: true });
  };

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    let q = brokerSelect("planipret_phone_messages", userId, "*")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (direction) q = q.eq("direction", direction);
    if (status === "unread") q = q.is("read_at", null);
    if (status === "read") q = q.not("read_at", "is", null);
    const since = periodStartISO(period);
    if (since) q = q.gte("created_at", since);
    if (search) q = q.or(searchFilter("planipret_phone_messages", search));

    const { data } = await q;
    setRows((data as any[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [userId, period, direction, status, search]);

  const threads = useMemo<Thread[]>(() => {
    const map = new Map<string, Thread>();
    for (const m of rows) {
      const peer = msgPeer(m);
      // One conversation per phone number/person: group by normalized peer digits, not per-send thread ids.
      const digits = String(peer ?? "").replace(/\D/g, "");
      const key = (digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits) || m.thread_id || String(peer);
      const existing = map.get(key);
      if (existing) {
        existing.messages.push(m);
        if (m.direction === "inbound" && !m.read_at) existing.unread += 1;
      } else {
        map.set(key, { key, peer, last: m, messages: [m], unread: m.direction === "inbound" && !m.read_at ? 1 : 0 });
      }
    }
    return Array.from(map.values()).filter((t) => !isHidden(smsState, smsThreadKey(t.key, t.peer), t.last.sent_at ?? t.last.created_at));
  }, [rows, smsState]);

  const totalThreads = threads.length;
  const pageThreads = threads.slice((page - 1) * THREADS_PER_PAGE, page * THREADS_PER_PAGE);
  const contactNames = useCallerNames(pageThreads.map((t) => t.peer));
  const peerLabel = (peer: string) => contactNames[peer] ?? peer;
  const active = pageThreads.find((t) => t.key === activeKey) ?? pageThreads[0] ?? null;
  const ordered = active ? [...active.messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) : [];

  useEffect(() => {
    if (!active || active.unread === 0) return;
    const ids = active.messages.filter((m) => m.direction === "inbound" && !m.read_at).map((m) => m.id);
    if (!ids.length) return;
    void supabase.from("planipret_phone_messages")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids)
      .eq("user_id", userId);
  }, [active?.key]);

  // Broker context is always the signed-in broker's own profile; the server
  // derives sender identity from the JWT, so the auth uid alone gates compose.
  const canCompose = Boolean(userId && authUserId);
  useEffect(() => { setComposeTarget(null); }, [userId, authUserId]);

  return (
    <PAPage>
      <PPPageBanner
        image={ppBanner}
        accent="#6366F1"
        title={lang === "en" ? "Messages" : "Textos"}
        subtitle={lang === "en" ? "SMS conversations and exchanged volume" : "Conversations SMS et volume échangé"}
      />
      <PPActivityCharts kind="messages" lang={lang === "en" ? "en" : "fr"} userId={userId} />

      <PAPageHeader
        icon={<MessageSquare className="w-4 h-4" />}
        title={lang === "en" ? "My texts" : "Mes textos"}
        subtitle={`${totalThreads} ${lang === "en" ? "conversations" : "conversations"} · ${rows.length} ${lang === "en" ? "messages" : "messages"}`}
      />

      {canCompose && <div className="flex justify-end"><Button onClick={() => setComposeTarget({ number: "" })}><Plus />{lang === "en" ? "New text message" : "Nouveau texto"}</Button></div>}

      <div className="pp-card flex flex-wrap gap-2" style={{ padding: 12 }}>
        <select value={period} onChange={(e) => patch({ period: e.target.value })} className="pp-input" style={{ fontSize: 12 }}>
          {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{lang === "en" ? o.en : o.fr}</option>)}
        </select>
        <select value={direction} onChange={(e) => patch({ direction: e.target.value })} className="pp-input" style={{ fontSize: 12 }}>
          <option value="">{lang === "en" ? "All directions" : "Toutes directions"}</option>
          <option value="inbound">{lang === "en" ? "Received" : "Reçus"}</option>
          <option value="outbound">{lang === "en" ? "Sent" : "Envoyés"}</option>
        </select>
        <select value={status} onChange={(e) => patch({ status: e.target.value })} className="pp-input" style={{ fontSize: 12 }}>
          <option value="">{lang === "en" ? "All statuses" : "Tous les statuts"}</option>
          <option value="unread">{lang === "en" ? "Unread" : "Non lus"}</option>
          <option value="read">{lang === "en" ? "Read" : "Lus"}</option>
        </select>
        <input value={search} onChange={(e) => patch({ q: e.target.value })}
          placeholder={lang === "en" ? "Number, contact or keyword…" : "Numéro, contact ou mot-clé…"}
          className="pp-input flex-1 min-w-[200px]" style={{ fontSize: 12 }} />
        {(period || direction || status || search) && (
          <button onClick={() => patch({ period: null, direction: null, status: null, q: null })}
            className="px-3 py-1.5 rounded-lg text-[12px]" style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
            {lang === "en" ? "Reset" : "Réinitialiser"}
          </button>
        )}
      </div>

      {loading ? (
        <div className="pp-card p-4 space-y-2">{[0, 1, 2].map((i) => <PPSkeleton key={i} className="h-10 w-full" />)}</div>
      ) : totalThreads === 0 ? (
        <div className="pp-card"><PPEmptyState icon={<MessageSquare className="w-5 h-5" />} title={lang === "en" ? "No messages" : "Aucun message"} /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="pp-card flex min-h-0 flex-col" style={{ padding: 0, maxHeight: "70vh" }}>
            <div className="overflow-y-auto flex-1">
              {pageThreads.map((t) => (
                <button key={t.key} onClick={() => setActiveKey(t.key)}
                  className="w-full text-left px-3 py-2.5"
                  style={{
                    borderBottom: "1px solid var(--pp-bg-border)",
                    background: active?.key === t.key ? "var(--pp-bg-elevated)" : "transparent",
                  }}>
                  <div className="flex items-center justify-between gap-2">
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--pp-text-primary)" }}>{peerLabel(t.peer)}</span>
                    {t.unread > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "var(--pp-danger)", borderRadius: 999, padding: "1px 6px" }}>{t.unread}</span>
                    )}
                  </div>
                  <div className="truncate" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>{t.last.body ?? "—"}</div>
                  <div style={{ fontSize: 10, color: "var(--pp-text-muted)" }}>{fmtDateTime(t.last.sent_at ?? t.last.created_at, lang)}</div>
                </button>
              ))}
            </div>
            {totalThreads > THREADS_PER_PAGE && (
              <div className="px-3 py-2" style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                <Pagination page={page} pageSize={THREADS_PER_PAGE} total={totalThreads}
                  unit={lang === "en" ? "conversations" : "conversations"}
                  onPageSizeChange={() => {}}
                  onPageChange={(p: number) => patch({ page: String(p) }, false)} />
              </div>
            )}
          </div>

          <div className="pp-card flex flex-col" style={{ padding: 0, maxHeight: "70vh" }}>
            <div className="shrink-0 px-4 py-3" style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
              <span className="pp-heading" style={{ fontSize: 14, fontWeight: 700 }}>{active ? peerLabel(active.peer) : ""}</span>
              {active && (
                <button aria-label={lang === "en" ? "Delete conversation" : "Supprimer la conversation"}
                  onClick={async () => {
                    const at = active.last.sent_at ?? active.last.created_at;
                    const ok = await confirmDialog({ title: lang === "en" ? "Delete this conversation?" : "Supprimer cette conversation ?", message: lang === "en" ? "It will be removed from this list on this device. A new text will bring it back." : "Elle sera retirée de cette liste sur cet appareil. Un nouveau texto la fera réapparaître.", confirmLabel: lang === "en" ? "Delete" : "Supprimer", destructive: true });
                    if (!ok) return;
                    const k = smsThreadKey(active.key, active.peer);
                    if (smsAct([k], "hide", { [k]: at })) { setActiveKey(null); toast.success(lang === "en" ? "Conversation deleted" : "Conversation supprimée"); }
                  }}
                  className="float-right inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px]"
                  style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-danger)" }}>
                  <Trash2 className="w-3.5 h-3.5" />{lang === "en" ? "Delete" : "Supprimer"}
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-2">
              {ordered.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <button onClick={() => setDetail(m)} className="text-left" style={{
                    maxWidth: "72%", borderRadius: 14, padding: "8px 12px", fontSize: 13,
                    background: m.direction === "outbound" ? "var(--pp-brand-accent-2)" : "rgba(16,185,129,0.16)",
                    color: m.direction === "outbound" ? "#fff" : "var(--pp-text-primary)",
                  }}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 3 }}>{fmtDateTime(m.sent_at ?? m.created_at, lang)}{m.direction === "outbound" ? ` · ${smsDeliveryLabel(m, lang)}` : ""}</div>
                  </button>
                </div>
              ))}
            </div>
            {canCompose && active && <PortalSmsComposer key={`${authUserId}:${active.key}`} inline target={{ number: active.peer }} userId={authUserId} lang={lang} onClose={() => {}} onSent={() => void load()} />}
          </div>
        </div>
      )}

      <PortalSmsComposer target={composeTarget} userId={authUserId} lang={lang} onClose={() => setComposeTarget(null)} onSent={() => void load()} />

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setDetail(null)}>
          <div className="pp-card w-full max-w-lg max-h-[85vh] overflow-y-auto" style={{ padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="pp-heading" style={{ fontSize: 15, fontWeight: 700 }}>
                {lang === "en" ? "Message details" : "Détails du message"}
              </h3>
              <button onClick={() => setDetail(null)}><X className="w-4 h-4" style={{ color: "var(--pp-text-muted)" }} /></button>
            </div>
            <p style={{ fontSize: 13, color: "var(--pp-text-primary)", whiteSpace: "pre-wrap", marginTop: 10 }}>{detail.body}</p>
            <dl className="mt-4 grid grid-cols-2 gap-y-2" style={{ fontSize: 12 }}>
              <Meta label={lang === "en" ? "From" : "De"} value={detail.from_number} />
              <Meta label={lang === "en" ? "To" : "À"} value={detail.to_number} />
              <Meta label={lang === "en" ? "Direction" : "Direction"} value={detail.direction} />
              <Meta label={lang === "en" ? "Status" : "Statut"} value={detail.direction === "outbound" ? smsDeliveryLabel(detail, lang) : detail.status} />
              <Meta label={lang === "en" ? "Sent" : "Envoyé"} value={fmtDateTime(detail.sent_at ?? detail.created_at, lang)} />
              <Meta label={lang === "en" ? "Read" : "Lu"} value={detail.read_at ? fmtDateTime(detail.read_at, lang) : "—"} />
            </dl>
            {Array.isArray(detail.media_urls) && detail.media_urls.length > 0 && (
              <div className="mt-3 space-y-1">
                {detail.media_urls.map((u: string) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="block truncate" style={{ fontSize: 12, color: "var(--pp-brand-accent-2)" }}>{u}</a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </PAPage>
  );
}

function Meta({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <dt style={{ color: "var(--pp-text-muted)" }}>{label}</dt>
      <dd style={{ color: "var(--pp-text-secondary)" }}>{value || "—"}</dd>
    </>
  );
}
