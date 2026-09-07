import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Link2, PlayCircle, PlugZap, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

const surface = { background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" };
const muted = { color: "var(--pp-text-muted)" };

interface PendingCall {
  id: string;
  userId: string | null;
  broker: string;
  extension: string;
  direction: string;
  peer: string;
  duration: number;
  at: string;
  ageHours: number;
  attempts: number;
  reason: string | null;
  stuck: boolean;
}

interface OrphanExt { extension: string; calls: number; last: string | null; talk: number }
interface Broker { user_id: string; name: string; connected: boolean; extension: string | null }

const STUCK_HOURS = 24;

/**
 * Suivi des appels en attente d'envoi vers Maestro : file de rejeu, relance
 * manuelle (globale ou par appel), alerte sur les appels bloqués et
 * rattachement des postes téléphoniques sans courtier.
 */
export default function PAMaestroPending() {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  const L = (fr: string, e: string) => (en ? e : fr);

  const [calls, setCalls] = useState<PendingCall[]>([]);
  const [orphans, setOrphans] = useState<OrphanExt[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [callRes, profRes, retryRes, orphanRes] = await Promise.all([
      supabase.from("planipret_phone_calls")
        .select("id, user_id, extension, direction, from_number, to_number, duration_seconds, started_at, created_at")
        .is("maestro_call_id", null)
        .gt("duration_seconds", 0)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("planipret_profiles")
        .select("user_id, full_name, email, extension, maestro_connected")
        .not("user_id", "is", null)
        .limit(1000),
      supabase.from("planipret_maestro_cdr_retries")
        .select("call_id, attempts, status, last_reason, next_attempt_at")
        .limit(2000),
      supabase.functions.invoke("pp-admin-attach-extension", { body: { action: "list", days: 90 } }),
    ]);

    const nameBy = new Map<string, string>();
    for (const p of (profRes.data ?? []) as any[]) {
      nameBy.set(String(p.user_id), p.full_name || p.email || String(p.user_id).slice(0, 8));
    }
    const retryBy = new Map<string, any>();
    for (const r of (retryRes.data ?? []) as any[]) retryBy.set(String(r.call_id), r);

    const now = Date.now();
    const rows: PendingCall[] = ((callRes.data ?? []) as any[]).map((c) => {
      const at = c.started_at ?? c.created_at;
      const ageHours = Math.max(0, (now - new Date(at).getTime()) / 3600000);
      const retry = retryBy.get(String(c.id));
      return {
        id: String(c.id),
        userId: c.user_id ? String(c.user_id) : null,
        broker: c.user_id ? (nameBy.get(String(c.user_id)) ?? L("Inconnu", "Unknown")) : L("Aucun courtier", "No broker"),
        extension: String(c.extension ?? "—"),
        direction: String(c.direction ?? "—"),
        peer: String(c.direction === "inbound" ? (c.from_number ?? "") : (c.to_number ?? "")) || "—",
        duration: Number(c.duration_seconds ?? 0),
        at,
        ageHours,
        attempts: Number(retry?.attempts ?? 0),
        reason: retry?.last_reason ?? null,
        stuck: ageHours > STUCK_HOURS,
      };
    });

    const fn: any = orphanRes.data ?? {};
    setOrphans(Array.isArray(fn.orphan_extensions) ? fn.orphan_extensions : []);
    setBrokers(Array.isArray(fn.brokers) ? fn.brokers : []);
    setCalls(rows);
    setLoading(false);
  }, [en]);

  useEffect(() => { void load(); }, [load]);

  const stuckCount = useMemo(() => calls.filter((c) => c.stuck).length, [calls]);
  const noBroker = useMemo(() => calls.filter((c) => !c.userId).length, [calls]);
  const connectedBrokers = useMemo(() => brokers.filter((b) => b.connected), [brokers]);

  const replayAll = async () => {
    setBusy("all");
    try {
      await Promise.all([
        supabase.functions.invoke("maestro-cdr-retry-job", { body: { limit: 50, sweep: true } }),
        supabase.functions.invoke("pp-maestro-push-sweeper", { body: { limit: 100 } }),
      ]);
      toast.success(L("Rejeu lancé", "Replay started"));
      setTimeout(() => void load(), 4000);
    } finally { setBusy(null); }
  };

  const replayOne = async (id: string) => {
    setBusy(id);
    try {
      await supabase.functions.invoke("maestro-cdr-retry-job", { body: { call_ids: [id], limit: 5, sweep: false } });
      toast.success(L("Appel relancé", "Call replayed"));
      setTimeout(() => void load(), 3000);
    } finally { setBusy(null); }
  };

  const attach = async (extension: string) => {
    const userId = picked[extension];
    if (!userId) { toast.error(L("Choisissez un courtier", "Pick a broker")); return; }
    setBusy(extension);
    try {
      const { data, error } = await supabase.functions.invoke("pp-admin-attach-extension", {
        body: { action: "assign", extension, user_id: userId, days: 90 },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message);
      toast.success(L(`Poste ${extension} rattaché (${(data as any)?.attached ?? 0} appels)`, `Extension ${extension} attached (${(data as any)?.attached ?? 0} calls)`));
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString(en ? "en-CA" : "fr-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <PAPage>
      <PAPageHeader
        title={L("Maestro", "Maestro")}
        subtitle={L("Courtiers connectés, postes sans courtier et appels en attente d'envoi vers Maestro.", "Connected brokers, unassigned extensions and calls pending delivery to Maestro.")}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} className="min-h-[36px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5" style={surface}>
              <RefreshCw className="w-3.5 h-3.5" /> {L("Actualiser", "Refresh")}
            </button>
            <button onClick={() => void replayAll()} disabled={busy === "all"} className="min-h-[36px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5" style={surface}>
              <PlayCircle className={`w-3.5 h-3.5 ${busy === "all" ? "animate-pulse" : ""}`} /> {L("Relancer le rejeu", "Replay all")}
            </button>
          </div>
        }
      />

      {loading ? <PPSkeleton /> : (
        <div className="space-y-4">
          {stuckCount > 0 && (
            <div className="rounded-xl p-3 text-sm flex items-start gap-2" style={{ ...surface, borderColor: "rgba(239,68,68,.45)" }}>
              <AlertTriangle className="w-4 h-4 mt-0.5" style={{ color: "#ef4444" }} />
              <span>
                {L(
                  `${stuckCount} appel(s) bloqué(s) depuis plus de ${STUCK_HOURS} h sans arriver dans Maestro.`,
                  `${stuckCount} call(s) stuck for more than ${STUCK_HOURS} h without reaching Maestro.`,
                )}
                {noBroker > 0 && " " + L(`${noBroker} n'ont aucun courtier rattaché.`, `${noBroker} have no broker attached.`)}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { k: L("En attente", "Pending"), v: calls.length },
              { k: L("Bloqués", "Stuck"), v: stuckCount },
              { k: L("Sans courtier", "No broker"), v: noBroker },
              { k: L("Postes orphelins", "Orphan extensions"), v: orphans.length },
              { k: L("Courtiers connectés", "Connected brokers"), v: connectedBrokers.length },
            ].map((c) => (
              <div key={c.k} className="rounded-xl p-3" style={surface}>
                <div className="text-xs" style={muted}>{c.k}</div>
                <div className="text-2xl font-semibold">{c.v}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl overflow-hidden" style={surface}>
            <div className="px-3 py-2 text-sm font-medium flex items-center gap-2">
              <PlugZap className="w-4 h-4" /> {L("Courtiers connectés à Maestro", "Brokers connected to Maestro")}
              <span className="text-xs" style={muted}>{connectedBrokers.length}/{brokers.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr style={muted}>
                  <th className="text-left px-3 py-2">{L("Courtier", "Broker")}</th>
                  <th className="text-left px-3 py-2">{L("Poste", "Ext")}</th>
                  <th className="text-left px-3 py-2">{L("Maestro", "Maestro")}</th>
                  <th className="text-right px-3 py-2">{L("En attente", "Pending")}</th>
                </tr></thead>
                <tbody>
                  {[...brokers].sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name)).map((b) => (
                    <tr key={b.user_id} style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                      <td className="px-3 py-2">{b.name}</td>
                      <td className="px-3 py-2">{b.extension ?? "—"}</td>
                      <td className="px-3 py-2" style={{ color: b.connected ? "#047857" : "#B45309" }}>
                        {b.connected ? L("Connecté", "Connected") : L("Non connecté", "Not connected")}
                      </td>
                      <td className="px-3 py-2 text-right">{calls.filter((c) => c.userId === b.user_id).length}</td>
                    </tr>
                  ))}
                  {brokers.length === 0 && (
                    <tr><td className="px-3 py-3" style={muted} colSpan={4}>{L("Aucun courtier.", "No broker.")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {orphans.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={surface}>
              <div className="px-3 py-2 text-sm font-medium flex items-center gap-2"><Link2 className="w-4 h-4" /> {L("Postes sans courtier", "Extensions without a broker")}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr style={muted}>
                    <th className="text-left px-3 py-2">{L("Poste", "Extension")}</th>
                    <th className="text-right px-3 py-2">{L("Appels", "Calls")}</th>
                    <th className="text-left px-3 py-2">{L("Dernier", "Last")}</th>
                    <th className="text-left px-3 py-2">{L("Rattacher à", "Attach to")}</th>
                    <th className="px-3 py-2" />
                  </tr></thead>
                  <tbody>
                    {orphans.map((o) => (
                      <tr key={o.extension} style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                        <td className="px-3 py-2 font-medium">{o.extension}</td>
                        <td className="px-3 py-2 text-right">{o.calls}</td>
                        <td className="px-3 py-2">{o.last ? fmt(o.last) : "—"}</td>
                        <td className="px-3 py-2">
                          <select
                            value={picked[o.extension] ?? ""}
                            onChange={(e) => setPicked((p) => ({ ...p, [o.extension]: e.target.value }))}
                            className="min-h-[32px] px-2 rounded-lg text-xs"
                            style={surface}
                          >
                            <option value="">{L("Courtier connecté…", "Connected broker…")}</option>
                            {connectedBrokers.map((b) => <option key={b.user_id} value={b.user_id}>{b.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => void attach(o.extension)} disabled={busy === o.extension} className="min-h-[30px] px-2.5 rounded-lg text-xs" style={surface}>
                            {L("Rattacher", "Attach")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {calls.length === 0 ? (
            <PPEmptyState title={L("Aucun appel en attente", "No pending calls")} />
          ) : (
            <div className="rounded-xl overflow-hidden" style={surface}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr style={muted}>
                    <th className="text-left px-3 py-2">{L("Quand", "When")}</th>
                    <th className="text-left px-3 py-2">{L("Courtier", "Broker")}</th>
                    <th className="text-left px-3 py-2">{L("Poste", "Ext")}</th>
                    <th className="text-left px-3 py-2">{L("Contact", "Contact")}</th>
                    <th className="text-right px-3 py-2">{L("Durée", "Duration")}</th>
                    <th className="text-right px-3 py-2">{L("Essais", "Attempts")}</th>
                    <th className="text-left px-3 py-2">{L("Motif", "Reason")}</th>
                    <th className="px-3 py-2" />
                  </tr></thead>
                  <tbody>
                    {calls.map((c) => (
                      <tr key={c.id} style={{ borderTop: "1px solid var(--pp-bg-border)", background: c.stuck ? "rgba(239,68,68,.06)" : undefined }}>
                        <td className="px-3 py-2 whitespace-nowrap">{fmt(c.at)}</td>
                        <td className="px-3 py-2">{c.broker}</td>
                        <td className="px-3 py-2">{c.extension}</td>
                        <td className="px-3 py-2">{c.peer}</td>
                        <td className="px-3 py-2 text-right">{Math.round(c.duration)}s</td>
                        <td className="px-3 py-2 text-right">{c.attempts}</td>
                        <td className="px-3 py-2" style={muted}>{c.reason ?? "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => void replayOne(c.id)} disabled={busy === c.id} className="min-h-[30px] px-2.5 rounded-lg text-xs" style={surface}>
                            {L("Relancer", "Replay")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </PAPage>
  );
}
