import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

/**
 * Vue globale Maestro par courtier : tâches, appels et lignes de commissions
 * agrégés à partir des projections déjà connues. Aucune liste live globale
 * n'est inventée — l'API Maestro ne la documente pas.
 */

interface Row {
  userId: string;
  name: string;
  brokerId: string | null;
  tasksOpen: number;
  tasksOverdue: number;
  tasksTotal: number;
  calls30d: number;
  commissionRows: number;
  commissionSync: string | null;
  taskSync: string | null;
}

const DONE = new Set(["done", "completed", "complete", "closed", "termine", "terminé", "3", "4"]);

export default function PAMaestroBrokers() {
  const { lang } = useMplanipretLang();
  const isEn = lang === "en";
  const L = (fr: string, en: string) => (isEn ? en : fr);
  const fmt = (d?: string | null) =>
    d ? new Date(d).toLocaleString(isEn ? "en-CA" : "fr-CA", { dateStyle: "short", timeStyle: "short", timeZone: "America/Toronto" }) : "—";

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const [profiles, tasks, calls, commissions, syncs] = await Promise.all([
      supabase.from("planipret_profiles").select("user_id, full_name, email, maestro_broker_id"),
      supabase.from("planipret_tasks_projection").select("user_id, status, due_at").is("deleted_at", null).limit(5000),
      supabase.from("planipret_phone_calls").select("user_id").gte("started_at", since).limit(5000),
      supabase.from("planipret_commission_live_cache").select("broker_user_id, synced_at").limit(20000),
      supabase.from("planipret_task_sync_runs").select("user_id, finished_at").order("finished_at", { ascending: false }).limit(2000),
    ]);

    const now = Date.now();
    const map = new Map<string, Row>();
    for (const p of (profiles.data ?? []) as any[]) {
      if (!p.user_id) continue;
      map.set(p.user_id, {
        userId: p.user_id,
        name: p.full_name || p.email || p.user_id.slice(0, 8),
        brokerId: p.maestro_broker_id ?? null,
        tasksOpen: 0, tasksOverdue: 0, tasksTotal: 0,
        calls30d: 0, commissionRows: 0, commissionSync: null, taskSync: null,
      });
    }
    const get = (id?: string | null) => (id ? map.get(id) : undefined);

    for (const t of (tasks.data ?? []) as any[]) {
      const r = get(t.user_id); if (!r) continue;
      r.tasksTotal++;
      const done = DONE.has(String(t.status ?? "").toLowerCase());
      if (done) continue;
      r.tasksOpen++;
      if (t.due_at && new Date(t.due_at).getTime() < now) r.tasksOverdue++;
    }
    for (const c of (calls.data ?? []) as any[]) { const r = get(c.user_id); if (r) r.calls30d++; }
    for (const c of (commissions.data ?? []) as any[]) {
      const r = get(c.broker_user_id); if (!r) continue;
      r.commissionRows++;
      if (c.synced_at && (!r.commissionSync || c.synced_at > r.commissionSync)) r.commissionSync = c.synced_at;
    }
    for (const s of (syncs.data ?? []) as any[]) {
      const r = get(s.user_id); if (!r || r.taskSync) continue;
      r.taskSync = s.finished_at ?? null;
    }

    setRows([...map.values()].filter((r) => r.brokerId || r.tasksTotal || r.calls30d || r.commissionRows));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || String(r.brokerId ?? "").includes(q)) : rows;
    return [...list].sort((a, b) => b.tasksOpen - a.tasksOpen || b.calls30d - a.calls30d);
  }, [rows, search]);

  const totals = useMemo(() => ({
    brokers: filtered.length,
    tasks: filtered.reduce((s, r) => s + r.tasksTotal, 0),
    overdue: filtered.reduce((s, r) => s + r.tasksOverdue, 0),
    calls: filtered.reduce((s, r) => s + r.calls30d, 0),
    commissions: filtered.reduce((s, r) => s + r.commissionRows, 0),
  }), [filtered]);

  return (
    <PAPage>
      <PAPageHeader
        icon={<Users className="h-5 w-5" />}
        title={L("Vue globale Maestro", "Maestro global view")}
        subtitle={L(
          "Courtiers, tâches, appels et commissions agrégés des projections connues",
          "Brokers, tasks, calls and commissions aggregated from known projections",
        )}
        actions={
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {L("Actualiser", "Refresh")}
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          [L("Courtiers", "Brokers"), totals.brokers],
          [L("Tâches", "Tasks"), totals.tasks],
          [L("En retard", "Overdue"), totals.overdue],
          [L("Appels 30j", "Calls 30d"), totals.calls],
          [L("Lignes commissions", "Commission rows"), totals.commissions],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-xl font-semibold text-foreground">{value as number}</div>
          </div>
        ))}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={L("Rechercher un courtier…", "Search a broker…")}
        className="mt-4 w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />

      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{L("Courtier", "Broker")}</th>
              <th className="px-3 py-2">Maestro</th>
              <th className="px-3 py-2">{L("Tâches", "Tasks")}</th>
              <th className="px-3 py-2">{L("Ouvertes", "Open")}</th>
              <th className="px-3 py-2">{L("En retard", "Overdue")}</th>
              <th className="px-3 py-2">{L("Appels 30j", "Calls 30d")}</th>
              <th className="px-3 py-2">{L("Commissions", "Commissions")}</th>
              <th className="px-3 py-2">{L("Dernière sync tâches", "Last task sync")}</th>
              <th className="px-3 py-2">{L("Dernière sync commissions", "Last commission sync")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">{L("Chargement…", "Loading…")}</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">{L("Aucun courtier", "No broker")}</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.userId} className="border-t border-border">
                <td className="px-3 py-2 font-medium text-foreground">{r.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.brokerId ?? "—"}</td>
                <td className="px-3 py-2">{r.tasksTotal}</td>
                <td className="px-3 py-2">{r.tasksOpen}</td>
                <td className={`px-3 py-2 ${r.tasksOverdue ? "font-semibold text-destructive" : ""}`}>{r.tasksOverdue}</td>
                <td className="px-3 py-2">{r.calls30d}</td>
                <td className="px-3 py-2">{r.commissionRows}</td>
                <td className="px-3 py-2 text-muted-foreground">{fmt(r.taskSync)}</td>
                <td className="px-3 py-2 text-muted-foreground">{fmt(r.commissionSync)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {L(
          "Agrégation des projections déjà synchronisées. Maestro ne documente pas de liste live globale de tous les courtiers.",
          "Aggregation of already synced projections. Maestro documents no global live list across brokers.",
        )}
      </p>
    </PAPage>
  );
}
