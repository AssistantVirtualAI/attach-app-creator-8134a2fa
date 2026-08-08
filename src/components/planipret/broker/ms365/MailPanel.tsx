import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Mail, X, Loader2, Reply, ReplyAll, Forward, Archive, Trash2, MailOpen, Plus, RefreshCw } from "lucide-react";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { fmtDateTime } from "@/lib/planipret/brokerFormat";
import ComposeEmailDialog, { type ComposeInit } from "./ComposeEmailDialog";

type Lang = "fr" | "en";
const PAGE_SIZE = 25;

export default function MailPanel({ lang }: { lang: Lang }) {
  const en = lang === "en";
  const [folder, setFolder] = useState("inbox");
  const [page, setPage] = useState(1);
  const [emails, setEmails] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [compose, setCompose] = useState<ComposeInit | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.functions.invoke("ms365-actions", {
      body: { action: "read_emails", payload: { folder, top: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE } },
    });
    setEmails((data as any)?.emails ?? []);
    setHasMore(Boolean((data as any)?.hasMore));
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [folder, page]);

  const openEmail = async (id: string) => {
    setDetailLoading(true); setDetail({ id });
    const { data } = await supabase.functions.invoke("ms365-actions", {
      body: { action: "read_email_detail", payload: { message_id: id } },
    });
    setDetail((data as any)?.email ?? null);
    setDetailLoading(false);
  };

  const act = async (action: string, payload: Record<string, unknown>, okMsg: string) => {
    const { data, error } = await supabase.functions.invoke("ms365-actions", { body: { action, payload } });
    const res = data as any;
    if (error || !res?.success) { toast.error(res?.error || error?.message || (en ? "Action failed" : "Action échouée")); return; }
    toast.success(okMsg);
    setDetail(null);
    void load();
  };

  const filtered = search.trim()
    ? emails.filter((e) => JSON.stringify(e).toLowerCase().includes(search.trim().toLowerCase()))
    : emails;

  const plainBody = (d: any) => String(d?.body?.content ?? d?.bodyPreview ?? "").replace(/<[^>]*>/g, " ").slice(0, 4000);
  const quoted = (d: any) => `\n\n---\n${d?.from?.emailAddress?.address ?? ""}\n${plainBody(d)}`;

  return (
    <>
      <div className="pp-card flex flex-wrap gap-2 items-center" style={{ padding: 12 }}>
        <select value={folder} onChange={(e) => { setFolder(e.target.value); setPage(1); }} className="pp-input" style={{ fontSize: 12 }}>
          <option value="inbox">{en ? "Inbox" : "Réception"}</option>
          <option value="unread">{en ? "Unread" : "Non lus"}</option>
          <option value="sent">{en ? "Sent" : "Envoyés"}</option>
          <option value="archive">{en ? "Archive" : "Archives"}</option>
          <option value="deleted">{en ? "Deleted" : "Supprimés"}</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={en ? "Filter this page…" : "Filtrer cette page…"}
          className="pp-input flex-1 min-w-[180px]" style={{ fontSize: 12 }} />
        <button onClick={() => void load()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]"
          style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
          <RefreshCw className="w-3.5 h-3.5" />{en ? "Refresh" : "Actualiser"}
        </button>
        <button onClick={() => setCompose({ mode: "new" })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white"
          style={{ background: "var(--pp-brand-accent-2)" }}>
          <Plus className="w-3.5 h-3.5" />{en ? "New email" : "Nouveau courriel"}
        </button>
      </div>

      <div className="pp-card" style={{ padding: 0 }}>
        {loading ? (
          <div className="p-4 space-y-2">{[0, 1, 2, 3].map((i) => <PPSkeleton key={i} className="h-10 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <PPEmptyState icon={<Mail className="w-5 h-5" />} title={en ? "No emails" : "Aucun courriel"} />
        ) : (
          filtered.map((e) => (
            <button key={e.id} onClick={() => void openEmail(e.id)} className="w-full text-left px-4 py-2.5"
              style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate" style={{ fontSize: 13, fontWeight: e.isRead ? 500 : 700, color: "var(--pp-text-primary)" }}>
                  {e.from?.emailAddress?.name || e.from?.emailAddress?.address || e.toRecipients?.[0]?.emailAddress?.address || "—"}
                </span>
                <span style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{fmtDateTime(e.receivedDateTime ?? e.sentDateTime, lang)}</span>
              </div>
              <div className="truncate" style={{ fontSize: 12.5, color: "var(--pp-text-secondary)" }}>{e.subject || "(no subject)"}</div>
              <div className="truncate" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>{e.bodyPreview}</div>
            </button>
          ))
        )}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
          <button disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-40" style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
            {en ? "Previous" : "Précédent"}
          </button>
          <span style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>Page {page}</span>
          <button disabled={!hasMore} onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-40" style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
            {en ? "Next" : "Suivant"}
          </button>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setDetail(null)}>
          <div className="pp-card w-full max-w-2xl max-h-[85vh] overflow-y-auto" style={{ padding: 18 }} onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="pp-heading" style={{ fontSize: 15.5, fontWeight: 700 }}>{detail.subject || (en ? "Email" : "Courriel")}</h3>
              <button onClick={() => setDetail(null)}><X className="w-4 h-4" style={{ color: "var(--pp-text-muted)" }} /></button>
            </div>
            {detailLoading ? (
              <div className="flex items-center gap-2 mt-4" style={{ fontSize: 13, color: "var(--pp-text-muted)" }}>
                <Loader2 className="w-4 h-4 animate-spin" />{en ? "Loading…" : "Chargement…"}
              </div>
            ) : (
              <>
                <div className="mt-2" style={{ fontSize: 12, color: "var(--pp-text-muted)" }}>
                  {detail.from?.emailAddress?.address} → {(detail.toRecipients ?? []).map((r: any) => r.emailAddress?.address).join(", ")}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>{fmtDateTime(detail.receivedDateTime ?? detail.sentDateTime, lang)}</div>

                <div className="flex flex-wrap gap-2" style={{ marginTop: 12 }}>
                  <ActionBtn icon={<Reply className="w-3.5 h-3.5" />} label={en ? "Reply" : "Répondre"}
                    onClick={() => setCompose({ mode: "reply", messageId: detail.id })} />
                  <ActionBtn icon={<ReplyAll className="w-3.5 h-3.5" />} label={en ? "Reply all" : "Répondre à tous"}
                    onClick={() => setCompose({ mode: "replyAll", messageId: detail.id })} />
                  <ActionBtn icon={<Forward className="w-3.5 h-3.5" />} label={en ? "Forward" : "Transférer"}
                    onClick={() => setCompose({ mode: "forward", messageId: detail.id, subject: detail.subject, body: quoted(detail) })} />
                  <ActionBtn icon={<MailOpen className="w-3.5 h-3.5" />} label={detail.isRead ? (en ? "Mark unread" : "Marquer non lu") : (en ? "Mark read" : "Marquer lu")}
                    onClick={() => void act("mark_read_email", { message_id: detail.id, isRead: !detail.isRead }, en ? "Updated" : "Mis à jour")} />
                  <ActionBtn icon={<Archive className="w-3.5 h-3.5" />} label={en ? "Archive" : "Archiver"}
                    onClick={() => void act("archive_email", { message_id: detail.id }, en ? "Archived" : "Archivé")} />
                  <ActionBtn icon={<Trash2 className="w-3.5 h-3.5" />} label={en ? "Delete" : "Supprimer"} danger
                    onClick={() => void act("delete_email", { message_id: detail.id }, en ? "Deleted" : "Supprimé")} />
                </div>

                <div className="mt-4" style={{ fontSize: 13, color: "var(--pp-text-secondary)", whiteSpace: "pre-wrap" }}>
                  {detail.body?.contentType === "html"
                    ? <div dangerouslySetInnerHTML={{ __html: detail.body?.content ?? "" }} />
                    : (detail.body?.content ?? detail.bodyPreview ?? "")}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {compose && (
        <ComposeEmailDialog init={compose} lang={lang} onClose={() => setCompose(null)} onSent={() => { setDetail(null); void load(); }} />
      )}
    </>
  );
}

function ActionBtn({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px]"
      style={{ border: "1px solid var(--pp-bg-border)", color: danger ? "var(--pp-danger, #dc2626)" : "var(--pp-text-secondary)" }}>
      {icon}{label}
    </button>
  );
}
