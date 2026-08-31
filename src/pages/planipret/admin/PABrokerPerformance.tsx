import { useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

interface BrokerOption { id: string; name: string; userId: string | null }

const cad = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n || 0);

const DONE = new Set(["done", "completed", "complete", "closed", "termine", "terminé", "3", "4"]);

/**
 * Rapports de performance par courtier : tâches par mois, commissions par
 * année fiscale et temps moyen de traitement d'une tâche (création → clôture).
 * Lecture seule, une seule sélection de courtier à la fois (jamais d'import
 * global des autres courtiers).
 */
export default function PABrokerPerformance() {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  const L = (fr: string, e: string) => (en ? e : fr);

  const [brokers, setBrokers] = useState<BrokerOption[]>([]);
  const [broker, setBroker] = useState<BrokerOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data: me } = await supabase.auth.getUser();
      const { data: rows } = await supabase
        .from("planipret_profiles")
        .select("user_id, full_name, email, maestro_broker_id")
        .not("maestro_broker_id", "is", null)
        .order("full_name", { ascending: true });
      if (!alive) return;
      const seen = new Set<string>();
      const opts: BrokerOption[] = [];
      for (const r of (rows ?? []) as any[]) {
        const id = String(r.maestro_broker_id ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        opts.push({
          id, userId: r.user_id ?? null,
          name: r.full_name || r.email || `#${id}`,
        });
      }
      setBrokers(opts);
      setBroker(opts.find((o) => o.userId && o.userId === me.user?.id) ?? opts[0] ?? null);
    })();
    return () => { alive = false; };
  }, []);

  // Charge uniquement les données du courtier sélectionné.
  useEffect(() => {
    if (!broker) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - 11, 1);
      const [t, c] = await Promise.all([
        broker.userId
          ? supabase.from("planipret_tasks_projection")
              .select("task_id, status, due_at, payload, created_at, updated_at, deleted_at")
              .eq("user_id", broker.userId).is("deleted_at", null)
              .gte("created_at", since.toISOString()).limit(1000)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from("planipret_commission_live_cache")
          .select("fiscal_year, row_data, date_trans")
          .eq("maestro_broker_id", broker.id).limit(2000),
      ]);
      if (!alive) return;
      setTasks(((t as any).data ?? []) as any[]);
      setCommissions(((c as any).data ?? []) as any[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [broker, reloadKey]);

  const monthly = useMemo(() => {
    const map = new Map<string, { month: string; created: number; done: number }>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(k, { month: k.slice(2), created: 0, done: 0 });
    }
    for (const t of tasks) {
      const d = new Date(t.created_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const row = map.get(k);
      if (!row) continue;
      row.created += 1;
      if (DONE.has(String(t.status ?? "").toLowerCase())) row.done += 1;
    }
    return [...map.values()];
  }, [tasks]);

  const yearly = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of commissions) {
      const raw = (c.row_data ?? {}) as any;
      const amount = Number(raw.amount ?? raw.commission ?? raw.montant ?? 0);
      const year = String(c.fiscal_year ?? (c.date_trans ? String(c.date_trans).slice(0, 4) : "—"));
      map.set(year, (map.get(year) ?? 0) + (Number.isFinite(amount) ? amount : 0));
    }
    return [...map.entries()].map(([year, total]) => ({ year, total })).sort((a, b) => a.year.localeCompare(b.year));
  }, [commissions]);

  const avgDays = useMemo(() => {
    const spans: number[] = [];
    for (const t of tasks) {
      if (!DONE.has(String(t.status ?? "").toLowerCase())) continue;
      const a = new Date(t.created_at).getTime();
      const b = new Date(t.updated_at ?? t.created_at).getTime();
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a) spans.push((b - a) / 86400000);
    }
    if (!spans.length) return null;
    return spans.reduce((s, v) => s + v, 0) / spans.length;
  }, [tasks]);

  const openTasks = tasks.filter((t) => !DONE.has(String(t.status ?? "").toLowerCase())).length;
  const overdue = tasks.filter((t) => !DONE.has(String(t.status ?? "").toLowerCase()) && t.due_at && new Date(t.due_at) < new Date()).length;
  const commissionTotal = yearly.reduce((s, y) => s + y.total, 0);

  const surface = { background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" };

  return (
    <PAPage>
      <PAPageHeader
        icon={<BarChart3 className="w-5 h-5" />}
        title={L("Performance par courtier", "Broker performance")}
        subtitle={L(
          "Tâches par mois, commissions par année et temps moyen de traitement — un courtier à la fois.",
          "Tasks per month, commissions per year and average handling time — one broker at a time.",
        )}
        actions={
          <div className="flex items-center gap-2">
            <select
              aria-label={L("Courtier", "Broker")}
              value={broker?.id ?? ""}
              onChange={(e) => setBroker(brokers.find((b) => b.id === e.target.value) ?? null)}
              className="min-h-[36px] rounded-lg px-2 text-xs" style={surface}
            >
              {brokers.map((b) => <option key={b.id} value={b.id}>{b.name} · #{b.id}</option>)}
            </select>
            <button onClick={() => setReloadKey((k) => k + 1)} className="min-h-[36px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5" style={surface}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> {L("Actualiser", "Refresh")}
            </button>
          </div>
        }
      />

      {!broker ? (
        <PPEmptyState icon={<BarChart3 className="w-5 h-5" />} title={L("Aucun courtier Maestro", "No Maestro broker")} />
      ) : loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <PPSkeleton key={i} style={{ height: 90 }} />)}</div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label={L("Tâches ouvertes", "Open tasks")} value={String(openTasks)} style={surface} />
            <Kpi label={L("En retard", "Overdue")} value={String(overdue)} tone={overdue ? "#B91C1C" : undefined} style={surface} />
            <Kpi
              label={L("Temps moyen de traitement", "Average handling time")}
              value={avgDays === null ? "—" : `${avgDays.toFixed(1)} ${L("j", "d")}`}
              style={surface}
            />
            <Kpi label={L("Commissions cumulées", "Total commissions")} value={cad(commissionTotal)} style={surface} />
          </div>

          <Panel title={L("Tâches par mois (12 mois)", "Tasks per month (12 months)")} style={surface}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="created" name={L("Créées", "Created")} fill="var(--pp-brand-accent)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="done" name={L("Complétées", "Completed")} fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title={L("Commissions par année", "Commissions per year")} style={surface}>
            {yearly.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: "var(--pp-text-muted)" }}>
                {L("Aucune commission synchronisée pour ce courtier.", "No commission synced for this broker.")}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={yearly}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => cad(Number(v))} width={80} />
                  <Tooltip formatter={(v) => cad(Number(v))} />
                  <Bar dataKey="total" name={L("Commissions", "Commissions")} radius={[4, 4, 0, 0]}>
                    {yearly.map((y) => <Cell key={y.year} fill="var(--pp-brand-accent-2)" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title={L("Rythme de clôture", "Completion pace")} style={surface}>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="done" name={L("Complétées", "Completed")} stroke="#10B981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      )}
    </PAPage>
  );
}

function Kpi({ label, value, tone, style }: { label: string; value: string; tone?: string; style: React.CSSProperties }) {
  return (
    <div className="rounded-xl p-3" style={style}>
      <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--pp-text-muted)" }}>{label}</p>
      <p className="text-xl font-semibold mt-1" style={tone ? { color: tone } : undefined}>{value}</p>
    </div>
  );
}

function Panel({ title, children, style }: { title: string; children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <section className="rounded-xl p-3" style={style}>
      <h2 className="text-sm font-semibold mb-2">{title}</h2>
      {children}
    </section>
  );
}
