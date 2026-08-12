import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PhoneCall, PieChart as PieIcon } from "lucide-react";
import { OvCard, OvEmpty, OV_COLORS, ovTooltip, ovLegend } from "./OvCard";
import { Chart3D, Ov3DGradients, areaFill3d, fill3d } from "./ov3dChart";
import type { OvDaily } from "@/hooks/useBrokerOverview";

const periodTitle = (g: string | undefined, lang: "fr" | "en", what: string) => {
  const per: Record<string, { fr: string; en: string }> = {
    day: { fr: "par jour", en: "per day" },
    week: { fr: "par semaine", en: "per week" },
    month: { fr: "par mois", en: "per month" },
    quarter: { fr: "par trimestre", en: "per quarter" },
  };
  return `${what} ${per[g ?? "day"][lang]}`;
};

export function OvCallsChart({ data, lang, granularity }: { data: OvDaily[]; lang: "fr" | "en"; granularity?: string }) {
  const empty = data.every((d) => !d.inbound && !d.outbound && !d.missed);
  return (
    <OvCard
      title={periodTitle(granularity, lang, lang === "en" ? "Calls" : "Appels")}
      info={lang === "en" ? "Inbound, outbound and missed calls per bucket. Buckets follow the selected granularity (day/week/month), America/Toronto time." : "Appels entrants, sortants et manqués par intervalle. Les intervalles suivent la granularité choisie (jour/semaine/mois), heure de Toronto."}
      icon={<PhoneCall className="w-4 h-4" />}
      to="/planipret/broker/calls"
      toLabel={lang === "en" ? "View all" : "Voir tout"}
      className="xl:col-span-2"
    >
      {empty ? <OvEmpty label={lang === "en" ? "No calls in this period" : "Aucun appel sur la période"} /> : (
        <Chart3D>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <Ov3DGradients colors={[OV_COLORS.in, OV_COLORS.out, OV_COLORS.missed]} />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} allowDecimals={false} />
            <Tooltip {...ovTooltip} />
            <Legend {...ovLegend} />
            <Area type="monotone" dataKey="inbound" stackId="1" name={lang === "en" ? "Inbound" : "Entrants"} stroke={OV_COLORS.in} fill={areaFill3d(OV_COLORS.in)} fillOpacity={1} strokeWidth={2} />
            <Area type="monotone" dataKey="outbound" stackId="1" name={lang === "en" ? "Outbound" : "Sortants"} stroke={OV_COLORS.out} fill={areaFill3d(OV_COLORS.out)} fillOpacity={1} strokeWidth={2} />
            <Area type="monotone" dataKey="missed" stackId="1" name={lang === "en" ? "Missed" : "Manqués"} stroke={OV_COLORS.missed} fill={areaFill3d(OV_COLORS.missed)} fillOpacity={1} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
        </Chart3D>
      )}
    </OvCard>
  );
}

export function OvCallsSplit({ split, lang }: { split: { key: string; value: number }[]; lang: "fr" | "en" }) {
  const labels: Record<string, string> = lang === "en"
    ? { inbound: "Inbound", outbound: "Outbound", missed: "Missed" }
    : { inbound: "Entrants", outbound: "Sortants", missed: "Manqués" };
  const colors: Record<string, string> = { inbound: OV_COLORS.in, outbound: OV_COLORS.out, missed: OV_COLORS.missed };
  const data = split.map((s) => ({ name: labels[s.key], value: s.value, key: s.key }));
  const total = data.reduce((a, b) => a + b.value, 0);
  return (
    <OvCard
      title={lang === "en" ? "Call mix" : "Répartition des appels"}
      icon={<PieIcon className="w-4 h-4" />}
      info={lang === "en" ? "Share of inbound, outbound and missed calls over the period. Percentages are relative to total calls." : "Part des appels entrants, sortants et manqués sur la période. Les pourcentages sont calculés sur le total des appels."}
    >
      {!total ? <OvEmpty label={lang === "en" ? "No data" : "Aucune donnée"} /> : (
        <Chart3D>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Ov3DGradients colors={[OV_COLORS.in, OV_COLORS.out, OV_COLORS.missed]} />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={3}>
              {data.map((d) => <Cell key={d.key} fill={fill3d(colors[d.key])} stroke="transparent" />)}
            </Pie>
            <Tooltip {...ovTooltip} />
            <Legend {...ovLegend} />
          </PieChart>
        </ResponsiveContainer>
        </Chart3D>
      )}
    </OvCard>
  );
}
