import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MessageSquare, Timer } from "lucide-react";
import { OvCard, OvEmpty, OV_COLORS, ovTooltip, ovLegend } from "./OvCard";
import { Chart3D, Ov3DGradients, fill3d } from "./ov3dChart";
import type { OvDaily } from "@/hooks/useBrokerOverview";

const PER: Record<string, { fr: string; en: string }> = {
  day: { fr: "par jour", en: "per day" },
  week: { fr: "par semaine", en: "per week" },
  month: { fr: "par mois", en: "per month" },
  quarter: { fr: "par trimestre", en: "per quarter" },
};

export function OvMessagesChart({ data, lang, granularity }: { data: OvDaily[]; lang: "fr" | "en"; granularity?: string }) {
  const empty = data.every((d) => !d.sent && !d.received);
  return (
    <OvCard
      title={`${lang === "en" ? "Texts" : "Textos"} ${PER[granularity ?? "day"][lang]}`}
      icon={<MessageSquare className="w-4 h-4" />}
      to="/planipret/broker/messages"
      toLabel={lang === "en" ? "View all" : "Voir tout"}
    >
      {empty ? <OvEmpty label={lang === "en" ? "No texts in this period" : "Aucun texto sur la période"} /> : (
        <Chart3D>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <Ov3DGradients colors={[OV_COLORS.out, OV_COLORS.in]} />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} allowDecimals={false} />
            <Tooltip {...ovTooltip} />
            <Legend {...ovLegend} />
            <Bar dataKey="sent" name={lang === "en" ? "Sent" : "Envoyés"} fill={fill3d(OV_COLORS.out)} radius={[4, 4, 2, 2]} />
            <Bar dataKey="received" name={lang === "en" ? "Received" : "Reçus"} fill={fill3d(OV_COLORS.in)} radius={[4, 4, 2, 2]} />
          </BarChart>
        </ResponsiveContainer>
        </Chart3D>
      )}
    </OvCard>
  );
}

export function OvDurationChart({ data, lang, granularity }: { data: OvDaily[]; lang: "fr" | "en"; granularity?: string }) {
  const empty = data.every((d) => !d.avg);
  return (
    <OvCard title={lang === "en" ? "Average call duration (min)" : "Durée moyenne d'appel (min)"} icon={<Timer className="w-4 h-4" />}>
      {empty ? <OvEmpty label={lang === "en" ? "No data" : "Aucune donnée"} /> : (
        <Chart3D>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <Ov3DGradients colors={[OV_COLORS.accent]} />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} />
            <Tooltip {...ovTooltip} />
            <Line type="monotone" dataKey="avg" name={lang === "en" ? "Minutes" : "Minutes"} stroke={OV_COLORS.accent} strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        </Chart3D>
      )}
    </OvCard>
  );
}
