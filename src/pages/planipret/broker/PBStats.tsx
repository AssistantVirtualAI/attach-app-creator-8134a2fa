import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3 } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";
import { fmtDuration } from "@/lib/planipret/brokerFormat";

const RANGES = [7, 30, 90];

export default function PBStats() {
  const { userId } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [days, setDays] = useState(30);
  const [calls, setCalls] = useState<any[]>([]);
  const [messages, setMessages] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const [callsRes, msgRes] = await Promise.all([
        supabase.from("planipret_phone_calls")
          .select("id, direction, status, duration_seconds, created_at")
          .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: true }),
        supabase.from("planipret_phone_messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId).gte("created_at", since),
      ]);
      if (cancelled) return;
      setCalls(callsRes.data ?? []);
      setMessages(msgRes.count ?? 0);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, days]);

  const summary = useMemo(() => {
    const inbound = calls.filter((c) => c.direction === "inbound").length;
    const outbound = calls.filter((c) => c.direction === "outbound").length;
    const missed = calls.filter((c) => c.status === "missed").length;
    const totalSec = calls.reduce((a, c) => a + (c.duration_seconds ?? 0), 0);
    const avg = calls.length ? Math.round(totalSec / calls.length) : 0;
    return { inbound, outbound, missed, totalSec, avg, total: calls.length };
  }, [calls]);

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      map.set(d.toISOString().slice(0, 10), 0);
    }
    for (const c of calls) {
      const k = new Date(c.created_at).toISOString().slice(0, 10);
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Array.from(map.entries());
  }, [calls, days]);

  const max = Math.max(1, ...byDay.map(([, v]) => v));

  const cards = [
    { label: lang === "en" ? "Total calls" : "Appels totaux", value: summary.total },
    { label: lang === "en" ? "Inbound" : "Entrants", value: summary.inbound },
    { label: lang === "en" ? "Outbound" : "Sortants", value: summary.outbound },
    { label: lang === "en" ? "Missed" : "Manqués", value: summary.missed },
    { label: lang === "en" ? "Talk time" : "Temps au téléphone", value: fmtDuration(summary.totalSec) },
    { label: lang === "en" ? "Avg. duration" : "Durée moyenne", value: fmtDuration(summary.avg) },
    { label: lang === "en" ? "Texts" : "Textos", value: messages },
  ];

  return (
    <PAPage>
      <PAPageHeader
        icon={<BarChart3 className="w-4 h-4" />}
        title={lang === "en" ? "My statistics" : "Mes statistiques"}
        actions={
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setDays(r)}
                className="px-3 py-1.5 rounded-lg text-[12px]"
                style={{
                  border: "1px solid var(--pp-bg-border)",
                  background: days === r ? "var(--pp-brand-accent-2)" : "transparent",
                  color: days === r ? "#fff" : "var(--pp-text-secondary)",
                }}>
                {r}{lang === "en" ? "d" : "j"}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {cards.map((c) => (
          <div key={c.label} className="pp-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--pp-text-primary)", marginTop: 6 }}>
              {loading ? <PPSkeleton className="h-5 w-12" /> : c.value}
            </div>
          </div>
        ))}
      </div>

      <div className="pp-card" style={{ padding: 16 }}>
        <h2 className="pp-heading" style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
          {lang === "en" ? "Calls per day" : "Appels par jour"}
        </h2>
        {loading ? (
          <PPSkeleton className="h-40 w-full" />
        ) : (
          <div className="flex items-end gap-[3px]" style={{ height: 160 }}>
            {byDay.map(([day, count]) => (
              <div key={day} className="flex-1 flex flex-col justify-end" title={`${day} · ${count}`}>
                <div style={{
                  height: `${(count / max) * 100}%`,
                  minHeight: count ? 3 : 1,
                  background: count ? "var(--pp-brand-accent-2)" : "var(--pp-bg-border)",
                  borderRadius: 3,
                }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </PAPage>
  );
}
