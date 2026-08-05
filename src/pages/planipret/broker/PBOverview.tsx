import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Phone, PhoneMissed, MessageSquare, Timer, Voicemail } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";
import { fmtDateTime, fmtDuration, callPeer } from "@/lib/planipret/brokerFormat";

export default function PBOverview() {
  const { userId, profile } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ today: 0, week: 0, missed: 0, avg: 0, unread: 0, vm: 0 });
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
      const startWeek = new Date(Date.now() - 7 * 864e5);

      const [todayRes, weekRes, missedRes, msgRes, vmRes, recentRes] = await Promise.all([
        supabase.from("planipret_phone_calls").select("id", { count: "exact", head: true })
          .eq("user_id", userId).gte("created_at", startToday.toISOString()),
        supabase.from("planipret_phone_calls").select("duration_seconds")
          .eq("user_id", userId).gte("created_at", startWeek.toISOString()),
        supabase.from("planipret_phone_calls").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("status", "missed").gte("created_at", startToday.toISOString()),
        supabase.from("planipret_phone_messages").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("direction", "inbound").is("read_at", null),
        supabase.from("planipret_voicemails").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("is_read", false),
        supabase.from("planipret_phone_calls").select("*")
          .eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
      ]);
      if (cancelled) return;
      const durations = (weekRes.data ?? []).map((r: any) => r.duration_seconds ?? 0);
      const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
      setStats({
        today: todayRes.count ?? 0,
        week: durations.length,
        missed: missedRes.count ?? 0,
        avg,
        unread: msgRes.count ?? 0,
        vm: vmRes.count ?? 0,
      });
      setRecent(recentRes.data ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const cards = [
    { Icon: Phone, label: lang === "en" ? "Calls today" : "Appels aujourd'hui", value: stats.today },
    { Icon: PhoneMissed, label: lang === "en" ? "Missed today" : "Manqués aujourd'hui", value: stats.missed },
    { Icon: Timer, label: lang === "en" ? "Avg. duration (7d)" : "Durée moy. (7j)", value: fmtDuration(stats.avg) },
    { Icon: Phone, label: lang === "en" ? "Calls (7 days)" : "Appels (7 jours)", value: stats.week },
    { Icon: MessageSquare, label: lang === "en" ? "Unread texts" : "Textos non lus", value: stats.unread },
    { Icon: Voicemail, label: lang === "en" ? "New voicemails" : "Nouveaux messages vocaux", value: stats.vm },
  ];

  return (
    <PAPage>
      <PAPageHeader
        title={lang === "en" ? `Hello ${profile?.full_name ?? ""}` : `Bonjour ${profile?.full_name ?? ""}`}
        subtitle={lang === "en" ? "Your personal activity" : "Votre activité personnelle"}
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map(({ Icon, label, value }) => (
          <div key={label} className="pp-card" style={{ padding: 14 }}>
            <div className="flex items-center gap-2" style={{ color: "var(--pp-text-muted)" }}>
              <Icon className="w-4 h-4" />
              <span style={{ fontSize: 11 }}>{label}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--pp-text-primary)", marginTop: 6 }}>
              {loading ? <PPSkeleton className="h-6 w-14" /> : value}
            </div>
          </div>
        ))}
      </div>

      <div className="pp-card" style={{ padding: 0 }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
          <h2 className="pp-heading" style={{ fontSize: 14, fontWeight: 700 }}>{lang === "en" ? "Recent calls" : "Appels récents"}</h2>
          <Link to="/planipret/broker/calls" style={{ fontSize: 12, color: "var(--pp-brand-accent-2)" }}>
            {lang === "en" ? "See all" : "Voir tout"}
          </Link>
        </div>
        {loading ? (
          <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <PPSkeleton key={i} className="h-8 w-full" />)}</div>
        ) : recent.length === 0 ? (
          <PPEmptyState icon={<Phone className="w-5 h-5" />} title={lang === "en" ? "No calls yet" : "Aucun appel"} />
        ) : (
          <div className="pa-scroll">
            <table className="w-full text-sm">
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
                    <td className="px-4 py-2">{callPeer(c)}</td>
                    <td className="px-4 py-2" style={{ color: "var(--pp-text-muted)" }}>{c.direction === "inbound" ? (lang === "en" ? "Inbound" : "Entrant") : (lang === "en" ? "Outbound" : "Sortant")}</td>
                    <td className="px-4 py-2" style={{ color: "var(--pp-text-muted)" }}>{fmtDuration(c.duration_seconds)}</td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--pp-text-muted)" }}>{fmtDateTime(c.started_at ?? c.created_at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PAPage>
  );
}
