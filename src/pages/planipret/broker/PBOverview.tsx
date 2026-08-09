import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Phone, PhoneMissed, MessageSquare, Timer, Voicemail, Mic, PercentCircle, TrendingUp } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";
import { fmtDuration } from "@/lib/planipret/brokerFormat";
import { fmtMoney } from "@/lib/planipret/commissionStats";
import { useBrokerOverview } from "@/hooks/useBrokerOverview";
import OvKpiRow, { type KpiCard } from "@/components/planipret/broker/overview/OvKpiRow";
import { OvCallsChart, OvCallsSplit } from "@/components/planipret/broker/overview/OvCallsChart";
import { OvMessagesChart, OvDurationChart } from "@/components/planipret/broker/overview/OvMessagesChart";
import OvHoursChart from "@/components/planipret/broker/overview/OvHoursChart";
import OvRecordingsChart from "@/components/planipret/broker/overview/OvRecordingsChart";
import OvCommissionsChart from "@/components/planipret/broker/overview/OvCommissionsChart";
import OvM365Card from "@/components/planipret/broker/overview/OvM365Card";
import OvConnectionsStrip from "@/components/planipret/broker/overview/OvConnectionsStrip";
import { OvRecentCalls, OvRecentMessages, OvTopContacts } from "@/components/planipret/broker/overview/OvRecentTables";
import GranularityToggle from "@/components/planipret/broker/GranularityToggle";
import { bucketSeries, type Granularity } from "@/lib/planipret/timeBuckets";

const RANGES = [7, 30, 90, 180, 365];

const pct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0);

export default function PBOverview() {
  const { userId, authUserId, profile } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [days, setDays] = useState(30);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [commissions, setCommissions] = useState<{ cy: number; py: number } | null>(null);

  const ov = useBrokerOverview(userId, days, lang as "fr" | "en");
  const { kpi, prev } = ov;
  const series = bucketSeries(ov.daily, granularity, lang as "fr" | "en");
  const recSeries = granularity === "day"
    ? ov.recWeeks
    : bucketSeries(ov.daily, granularity, lang as "fr" | "en").map((d) => ({
        label: d.label, recorded: d.recorded, transcribed: d.transcribed, analyzed: d.analyzed,
      }));

  const sp = (key: "inbound" | "outbound" | "missed" | "sent" | "received" | "avg") =>
    (ov.daily ?? []).map((d: any) => Number(d?.[key] ?? 0));
  const callsSpark = (ov.daily ?? []).map((d: any) => Number(d?.inbound ?? 0) + Number(d?.outbound ?? 0));

  const cards: KpiCard[] = [
    { Icon: Phone, accent: "#2E9BDC", spark: callsSpark, label: lang === "en" ? "Calls" : "Appels", value: kpi.calls, delta: pct(kpi.calls, prev.calls) },
    { Icon: PhoneMissed, accent: "#E84C4C", spark: sp("missed"), label: lang === "en" ? "Missed" : "Manqués", value: kpi.missed, delta: pct(kpi.missed, prev.missed), invert: true },
    { Icon: PercentCircle, accent: "#00D4AA", label: lang === "en" ? "Answer rate" : "Taux de réponse", value: `${Math.round(kpi.answerRate)}%`, delta: pct(kpi.answerRate, prev.answerRate) },
    { Icon: Timer, accent: "#9B7FE8", spark: sp("avg"), label: lang === "en" ? "Avg. duration" : "Durée moyenne", value: fmtDuration(kpi.avgDuration), delta: pct(kpi.avgDuration, prev.avgDuration) },
    { Icon: MessageSquare, accent: "#4AC9E3", spark: sp("sent"), label: lang === "en" ? "Texts sent" : "Textos envoyés", value: kpi.smsSent, delta: pct(kpi.smsSent, prev.smsSent) },
    { Icon: MessageSquare, accent: "#E8A33C", spark: sp("received"), label: lang === "en" ? "Texts received" : "Textos reçus", value: kpi.smsReceived, delta: pct(kpi.smsReceived, prev.smsReceived) },
    { Icon: Mic, accent: "#E86CB0", label: lang === "en" ? "Recordings" : "Enregistrements", value: kpi.recordings, delta: pct(kpi.recordings, prev.recordings) },
    {
      Icon: TrendingUp,
      accent: "#00D4AA",
      label: lang === "en" ? "Commissions (YTD)" : "Commissions (cumul)",
      value: commissions ? fmtMoney(commissions.cy) : "…",
      delta: commissions ? pct(commissions.cy, commissions.py) : null,
    },
  ];

  // ----- AI insights -----
  const [aiSummary, setAiSummary] = useState("");
  const [aiInsights, setAiInsights] = useState<OverviewInsight[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiGenerated, setAiGenerated] = useState(false);

  useEffect(() => {
    setAiSummary(""); setAiInsights([]); setAiError(null); setAiGenerated(false);
  }, [days, userId]);

  const runInsights = async () => {
    if (aiLoading) return;
    setAiLoading(true); setAiError(null);
    try {
      const metrics = buildOverviewMetrics({
        days,
        kpi: kpi as any,
        prev: prev as any,
        daily: (ov.daily ?? []) as any,
        hourly: (ov.hourly ?? []) as any,
        topContacts: (ov.topContacts ?? []) as any,
        commissions,
      });
      const res = await fetchOverviewInsights({ lang: lang as "fr" | "en", days, metrics });
      if (!res.ok) {
        setAiError(res.error || (lang === "en" ? "Analysis unavailable right now." : "Analyse indisponible pour le moment."));
      } else {
        setAiSummary(res.summary);
        setAiInsights(res.insights);
        setAiGenerated(true);
      }
    } catch (e: any) {
      setAiError(e?.message ?? (lang === "en" ? "Unexpected error." : "Erreur inattendue."));
    } finally {
      setAiLoading(false);
    }
  };


  return (
    <PAPage>
      <PAPageHeader
        title={lang === "en" ? `Hello ${profile?.full_name ?? ""}` : `Bonjour ${profile?.full_name ?? ""}`}
        subtitle={lang === "en" ? "Your personal activity" : "Votre activité personnelle"}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <OvConnectionsStrip profile={profile} lang={lang as "fr" | "en"} />
        <div className="flex flex-wrap items-center gap-2">
        <GranularityToggle value={granularity} onChange={setGranularity} lang={lang as "fr" | "en"} />
        <div className="flex items-center gap-1">
          {RANGES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="px-3 py-1.5 rounded-lg"
              style={{
                fontSize: 12,
                border: "1px solid var(--pp-bg-border)",
                background: days === d ? "var(--pp-bg-elevated, rgba(255,255,255,0.06))" : "transparent",
                color: days === d ? "var(--pp-text-primary)" : "var(--pp-text-secondary)",
              }}
            >
              {d} {lang === "en" ? "days" : "jours"}
            </button>
          ))}
        </div>
        </div>
      </div>

      {ov.loading ? (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => <PPSkeleton key={i} style={{ height: 74 }} />)}
        </div>
      ) : (
        <OvKpiRow
          cards={[
            ...cards.slice(0, 7),
            { ...cards[7] },
          ]}
        />
      )}

      <div className="grid gap-3 xl:grid-cols-3">
        {ov.loading ? (
          <>
            <PPSkeleton style={{ height: 280 }} className="xl:col-span-2" />
            <PPSkeleton style={{ height: 280 }} />
          </>
        ) : (
          <>
            <OvCallsChart data={series} lang={lang as "fr" | "en"} granularity={granularity} />
            <OvCallsSplit split={ov.split} lang={lang as "fr" | "en"} />
            <OvMessagesChart data={series} lang={lang as "fr" | "en"} granularity={granularity} />
            <OvDurationChart data={series} lang={lang as "fr" | "en"} granularity={granularity} />
            <OvHoursChart data={ov.hourly} lang={lang as "fr" | "en"} />
            <OvRecordingsChart data={recSeries} lang={lang as "fr" | "en"} />
          </>
        )}

        <OvCommissionsChart
          brokerUserId={authUserId}
          brokerName={profile?.full_name}
          lang={lang as "fr" | "en"}
          onTotal={(cy, py) => setCommissions({ cy, py })}
        />
        <OvM365Card days={days} lang={lang as "fr" | "en"} granularity={granularity} />
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        {ov.loading ? (
          <>
            <PPSkeleton style={{ height: 240 }} className="xl:col-span-2" />
            <PPSkeleton style={{ height: 240 }} />
          </>
        ) : (
          <>
            <OvRecentCalls rows={ov.recentCalls} lang={lang as "fr" | "en"} />
            <OvRecentMessages rows={ov.recentMsgs} lang={lang as "fr" | "en"} />
            <OvTopContacts rows={ov.topContacts} lang={lang as "fr" | "en"} />
          </>
        )}
      </div>

      <div style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>
        {lang === "en" ? `Unread voicemails: ${ov.vmUnread}` : `Messages vocaux non lus : ${ov.vmUnread}`}
      </div>
    </PAPage>
  );
}
