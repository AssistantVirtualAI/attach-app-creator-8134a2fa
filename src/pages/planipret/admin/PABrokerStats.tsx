import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

interface BrokerRow {
  userId: string;
  name: string;
  email: string;
  extension: string;
  maestroConnected: boolean;
  maestroLastSync: string | null;
  calls30: number;
  texts30: number;
  openTasks: number;
  overdueTasks: number;
}

const DONE = new Set(["done", "completed", "complete", "closed", "termine", "terminé", "3", "4"]);

/** Tableau global par courtier : appels, textos, tâches et statut de connexion (30 jours). */
export default function PABrokerStats() {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  const L = (fr: string, e: string) => (en ? e : fr);

  const [rows, setRows] = useState<BrokerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [profiles, calls, texts, tasks] = await Promise.all([
        supabase.from("planipret_profiles")
          .select("user_id, full_name, email, extension, ns_extension, maestro_connected, maestro_last_sync_at")
          .limit(1000),
        supabase.from("planipret_phone_calls").select("user_id").gte("started_at", since).limit(10000),
        supabase.from("planipret_phone_messages").select("user_id").gte("created_at", since).limit(10000),
        supabase.from("planipret_tasks_projection").select("user_id, status, due_at").is("deleted_at", null).limit(10000),
      ]);
      if (!alive) return;

      const countBy = (list: any[] | null) => {
        const m = new Map<string, number>();
        for (const r of list ?? []) {
          const k = String(r.user_id ?? "");
          if (k) m.set(k, (m.get(k) ?? 0) + 1);
        }
        return m;
      };
      const callsBy = countBy(calls.data as any[]);
      const textsBy = countBy(texts.data as any[]);

      const tasksBy = new Map<string, { open: number; overdue: number }>();
      const now = Date.now();
      for (const t of (tasks.data ?? []) as any[]) {
        const k = String(t.user_id ?? "");
        if (!k) continue;
        const done = DONE.has(String(t.status ?? "").toLowerCase());
        if (done) continue;
        const cur = tasksBy.get(k) ?? { open: 0, overdue: 0 };
        cur.open += 1;
        if (t.due_at && new Date(t.due_at).getTime() < now) cur.overdue += 1;
        tasksBy.set(k, cur);
      }

      const out: BrokerRow[] = ((profiles.data ?? []) as any[]).map((p) => {
        const uid = String(p.user_id ?? "");
        const t = tasksBy.get(uid) ?? { open: 0, overdue: 0 };
        return {
          userId: uid,
          name: p.full_name || p.email || uid.slice(0, 8),
          email: p.email ?? "",
          extension: String(p.extension || p.ns_extension || "").trim(),
          maestroConnected: Boolean(p.maestro_connected),
          maestroLastSync: p.maestro_last_sync_at ?? null,
          calls30: callsBy.get(uid) ?? 0,
          texts30: textsBy.get(uid) ?? 0,
          openTasks: t.open,
          overdueTasks: t.overdue,
        };
      }).filter((r) => r.userId);
      out.sort((a, b) => b.calls30 - a.calls30 || a.name.localeCompare(b.name));
      setRows(out);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  const totals = useMemo(() => ({
    calls: rows.reduce((s, r) => s + r.calls30, 0),
    texts: rows.reduce((s, r) => s + r.texts30, 0),
    open: rows.reduce((s, r) => s + r.openTasks, 0),
    connected: rows.filter((r) => r.maestroConnected).length,
  }), [rows]);

  const surface = { background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" };
  const muted = { color: "var(--pp-text-muted)" };

  return (
    <PAPage>
      <PAPageHeader
        icon={<Users className="w-5 h-5" />}
        title={L("Statistiques par courtier", "Stats by broker")}
        subtitle={L("Appels, textos, tâches et statut de connexion sur 30 jours.", "Calls, texts, tasks and connection status over 30 days.")}
        actions={
          <button onClick={() => setReloadKey((k) => k + 1)} className="min-h-[36px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5" style={surface}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> {L("Actualiser", "Refresh")}
          </button>
        }
      />

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <PPSkeleton key={i} style={{ height: 56 }} />)}</div>
      ) : rows.length === 0 ? (
        <PPEmptyState icon={<Users className="w-5 h-5" />} title={L("Aucun courtier", "No broker")} />
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label={L("Courtiers connectés Maestro", "Maestro-connected brokers")} value={`${totals.connected}/${rows.length}`} style={surface} />
            <Kpi label={L("Appels (30 j)", "Calls (30 d)")} value={String(totals.calls)} style={surface} />
            <Kpi label={L("Textos (30 j)", "Texts (30 d)")} value={String(totals.texts)} style={surface} />
            <Kpi label={L("Tâches ouvertes", "Open tasks")} value={String(totals.open)} style={surface} />
          </div>

          <div className="rounded-xl overflow-x-auto" style={surface}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
                  <Th>{L("Courtier", "Broker")}</Th>
                  <Th>{L("Poste", "Ext.")}</Th>
                  <Th>{L("Connexion", "Connection")}</Th>
                  <Th>{L("Appels (30 j)", "Calls (30 d)")}</Th>
                  <Th>{L("Textos (30 j)", "Texts (30 d)")}</Th>
                  <Th>{L("Tâches ouvertes", "Open tasks")}</Th>
                  <Th>{L("En retard", "Overdue")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.name}</p>
                      <p style={muted}>{r.email}</p>
                    </td>
                    <td className="px-3 py-2">{r.extension || "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={r.maestroConnected
                          ? { background: "#10B9811A", color: "#047857" }
                          : { background: "#B91C1C1A", color: "#B91C1C" }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.maestroConnected ? "#10B981" : "#B91C1C" }} />
                        {r.maestroConnected ? L("Connecté", "Connected") : L("Déconnecté", "Disconnected")}
                      </span>
                      {r.maestroLastSync && (
                        <p className="mt-0.5 text-[10px]" style={muted}>
                          {L("Sync", "Synced")} {new Date(r.maestroLastSync).toLocaleDateString(en ? "en-CA" : "fr-CA")}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 font-semibold">{r.calls30}</td>
                    <td className="px-3 py-2 font-semibold">{r.texts30}</td>
                    <td className="px-3 py-2">{r.openTasks}</td>
                    <td className="px-3 py-2" style={r.overdueTasks ? { color: "#B91C1C", fontWeight: 600 } : undefined}>
                      {r.overdueTasks || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PAPage>
  );
}

function Kpi({ label, value, style }: { label: string; value: string; style: React.CSSProperties }) {
  return (
    <div className="rounded-xl p-3" style={style}>
      <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--pp-text-muted)" }}>{label}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-wide" style={{ color: "var(--pp-text-muted)" }}>
      {children}
    </th>
  );
}
