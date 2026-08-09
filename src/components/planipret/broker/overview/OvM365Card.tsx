import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Calendar, Mail, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OvCard, OvEmpty, OV_COLORS, ovTooltip, ovLegend } from "./OvCard";
import { PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { fmtDateTime } from "@/lib/planipret/brokerFormat";
import { bucketSeries, type Granularity } from "@/lib/planipret/timeBuckets";

type Stats = {
  connected?: boolean;
  totals?: { emails_received: number; emails_sent: number; emails_unread: number; meetings: number; meeting_minutes: number };
  daily?: Array<{ date: string; emails_received: number; emails_sent: number; meetings: number }>;
  upcomingMeetings?: Array<{ subject: string; start: string; attendees: number; is_online: boolean; join_url: string | null }>;
};

export default function OvM365Card({ days, lang, granularity = "day" }: { days: number; lang: "fr" | "en"; granularity?: Granularity }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "off">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState("loading");
      const { data, error } = await supabase.functions.invoke("ms365-stats", { body: { days, insights: false } });
      if (cancelled) return;
      if (error || !data || (data as Stats).connected === false) { setState("off"); return; }
      setStats(data as Stats);
      setState("ready");
    })();
    return () => { cancelled = true; };
  }, [days]);

  const t = stats?.totals;
  const daily = bucketSeries(
    (stats?.daily ?? []).map((d) => ({
      date: d.date,
      label: new Date(d.date).toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", { day: "2-digit", month: "short" }),
      received: d.emails_received, sent: d.emails_sent, meetings: d.meetings,
    })),
    granularity,
    lang,
    [],
  );

  return (
    <>
      <OvCard
        title={lang === "en" ? "Microsoft 365 — emails & Teams" : "Microsoft 365 — courriels & Teams"}
        icon={<Mail className="w-4 h-4" />}
        to="/planipret/broker/microsoft"
        toLabel={lang === "en" ? "View all" : "Voir tout"}
        className="xl:col-span-2"
      >
        {state === "loading" ? <PPSkeleton style={{ height: 220 }} />
          : state === "off" ? <OvEmpty label={lang === "en" ? "Microsoft 365 not connected" : "Microsoft 365 non connecté"} />
          : (
            <>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {[
                  { l: lang === "en" ? "Received" : "Reçus", v: t?.emails_received ?? 0 },
                  { l: lang === "en" ? "Sent" : "Envoyés", v: t?.emails_sent ?? 0 },
                  { l: lang === "en" ? "Unread" : "Non lus", v: t?.emails_unread ?? 0 },
                  { l: lang === "en" ? "Meetings" : "Réunions", v: t?.meetings ?? 0 },
                ].map((k) => (
                  <div key={k.l}>
                    <div style={{ fontSize: 10, color: "var(--pp-text-muted)" }}>{k.l}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--pp-text-primary)" }}>{k.v}</div>
                  </div>
                ))}
              </div>
              {daily.length === 0 ? <OvEmpty label={lang === "en" ? "No data" : "Aucune donnée"} /> : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={daily} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} allowDecimals={false} />
                    <Tooltip {...ovTooltip} />
                    <Legend {...ovLegend} />
                    <Bar dataKey="received" name={lang === "en" ? "Received" : "Reçus"} fill={OV_COLORS.in} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="sent" name={lang === "en" ? "Sent" : "Envoyés"} fill={OV_COLORS.out} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="meetings" name={lang === "en" ? "Meetings" : "Réunions"} fill={OV_COLORS.warm} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </>
          )}
      </OvCard>

      <OvCard title={lang === "en" ? "Upcoming meetings" : "Prochains rendez-vous"} icon={<Calendar className="w-4 h-4" />}>
        {state === "loading" ? <PPSkeleton style={{ height: 200 }} />
          : state === "off" ? <OvEmpty label={lang === "en" ? "Microsoft 365 not connected" : "Microsoft 365 non connecté"} />
          : !(stats?.upcomingMeetings ?? []).length
            ? <OvEmpty label={lang === "en" ? "Nothing scheduled" : "Rien de planifié"} />
            : (
              <div className="space-y-2">
                {(stats?.upcomingMeetings ?? []).slice(0, 5).map((m, i) => (
                  <div key={i} className="flex items-start gap-2" style={{ fontSize: 12 }}>
                    {m.is_online ? <Video className="w-3.5 h-3.5 mt-0.5" style={{ color: OV_COLORS.accent }} /> : <Calendar className="w-3.5 h-3.5 mt-0.5" style={{ color: "var(--pp-text-muted)" }} />}
                    <div className="min-w-0">
                      <div className="truncate" style={{ color: "var(--pp-text-primary)" }}>{m.subject}</div>
                      <div style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>
                        {fmtDateTime(m.start, lang)} · {m.attendees} {lang === "en" ? "attendees" : "participants"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
      </OvCard>
    </>
  );
}
