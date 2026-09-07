import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import BrokerActivityDaily from "@/components/planipret/brokers/BrokerActivityDaily";
import { fetchBrokerActivity, type BrokerActivity } from "@/lib/planipret/brokerActivity";

interface BrokerOption { userId: string; name: string }
const RANGES = [1, 7, 14, 30];

/** Rapport quotidien par courtier : appels, textos et tâches triés par date. */
export default function PABrokerDailyReport() {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  const L = (fr: string, e: string) => (en ? e : fr);

  const [brokers, setBrokers] = useState<BrokerOption[]>([]);
  const [selected, setSelected] = useState("");
  const [days, setDays] = useState(7);
  const [activity, setActivity] = useState<BrokerActivity>({ calls: [], messages: [], tasks: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ data: auth }, { data: rows }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("planipret_profiles").select("user_id, full_name, email").order("full_name", { ascending: true }).limit(1000),
      ]);
      if (!alive) return;
      const opts = ((rows ?? []) as any[]).filter((r) => r.user_id).map((r) => ({
        userId: String(r.user_id),
        name: r.full_name || r.email || String(r.user_id).slice(0, 8),
      }));
      setBrokers(opts);
      setSelected((s) => s || auth.user?.id || opts[0]?.userId || "");
    })();
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setActivity(await fetchBrokerActivity(selected, days));
    setLoading(false);
  }, [selected, days]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => ({
    calls: activity.calls.length,
    texts: activity.messages.length,
    tasks: activity.tasks.length,
    overdue: activity.tasks.filter((t) => t.overdue).length,
  }), [activity]);

  const surface = { background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" };

  return (
    <PAPage>
      <PAPageHeader
        icon={<CalendarDays className="w-5 h-5" />}
        title={L("Rapport quotidien par courtier", "Daily report by broker")}
        subtitle={L("Appels, textos et tâches, triés par date.", "Calls, texts and tasks, sorted by date.")}
        actions={
          <button onClick={() => void load()} className="min-h-[36px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5" style={surface}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> {L("Actualiser", "Refresh")}
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select aria-label={L("Courtier", "Broker")} value={selected} onChange={(e) => setSelected(e.target.value)}
          className="min-h-[36px] rounded-lg px-2 text-xs min-w-[220px]" style={surface}>
          {brokers.map((b) => <option key={b.userId} value={b.userId}>{b.name}</option>)}
        </select>
        {RANGES.map((d) => (
          <button key={d} onClick={() => setDays(d)} className="min-h-[36px] px-3 rounded-lg text-xs font-semibold"
            style={days === d ? { background: "var(--pp-brand-accent)", color: "#fff", border: "1px solid var(--pp-brand-accent)" } : surface}>
            {d === 1 ? L("Aujourd'hui", "Today") : `${d} ${L("jours", "days")}`}
          </button>
        ))}
        <span className="text-[11px]" style={{ color: "var(--pp-text-muted)" }}>
          {totals.calls} {L("appels", "calls")} · {totals.texts} {L("textos", "texts")} · {totals.tasks} {L("tâches", "tasks")}
          {totals.overdue > 0 ? ` · ${totals.overdue} ${L("en retard", "overdue")}` : ""}
        </span>
      </div>

      <BrokerActivityDaily activity={activity} lang={lang} loading={loading} />
    </PAPage>
  );
}
