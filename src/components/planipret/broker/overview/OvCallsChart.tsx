import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PhoneCall, PieChart as PieIcon } from "lucide-react";
import { OvCard, OvEmpty, OV_COLORS, ovTooltip } from "./OvCard";
import type { OvDaily } from "@/hooks/useBrokerOverview";

export function OvCallsChart({ data, lang }: { data: OvDaily[]; lang: "fr" | "en" }) {
  const empty = data.every((d) => !d.inbound && !d.outbound && !d.missed);
  return (
    <OvCard
      title={lang === "en" ? "Calls per day" : "Appels par jour"}
      icon={<PhoneCall className="w-4 h-4" />}
      to="/planipret/broker/calls"
      toLabel={lang === "en" ? "View all" : "Voir tout"}
      className="xl:col-span-2"
    >
      {empty ? <OvEmpty label={lang === "en" ? "No calls in this period" : "Aucun appel sur la période"} /> : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} allowDecimals={false} />
            <Tooltip {...ovTooltip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="inbound" stackId="1" name={lang === "en" ? "Inbound" : "Entrants"} stroke={OV_COLORS.in} fill={OV_COLORS.in} fillOpacity={0.35} />
            <Area type="monotone" dataKey="outbound" stackId="1" name={lang === "en" ? "Outbound" : "Sortants"} stroke={OV_COLORS.out} fill={OV_COLORS.out} fillOpacity={0.35} />
            <Area type="monotone" dataKey="missed" stackId="1" name={lang === "en" ? "Missed" : "Manqués"} stroke={OV_COLORS.missed} fill={OV_COLORS.missed} fillOpacity={0.35} />
          </AreaChart>
        </ResponsiveContainer>
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
    <OvCard title={lang === "en" ? "Call mix" : "Répartition des appels"} icon={<PieIcon className="w-4 h-4" />}>
      {!total ? <OvEmpty label={lang === "en" ? "No data" : "Aucune donnée"} /> : (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={3}>
              {data.map((d) => <Cell key={d.key} fill={colors[d.key]} stroke="transparent" />)}
            </Pie>
            <Tooltip {...ovTooltip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </OvCard>
  );
}
