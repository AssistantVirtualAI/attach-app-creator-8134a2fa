import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MessageSquare, Timer } from "lucide-react";
import { OvCard, OvEmpty, OV_COLORS, ovTooltip } from "./OvCard";
import type { OvDaily } from "@/hooks/useBrokerOverview";

export function OvMessagesChart({ data, lang }: { data: OvDaily[]; lang: "fr" | "en" }) {
  const empty = data.every((d) => !d.sent && !d.received);
  return (
    <OvCard
      title={lang === "en" ? "Texts per day" : "Textos par jour"}
      icon={<MessageSquare className="w-4 h-4" />}
      to="/planipret/broker/messages"
      toLabel={lang === "en" ? "View all" : "Voir tout"}
    >
      {empty ? <OvEmpty label={lang === "en" ? "No texts in this period" : "Aucun texto sur la période"} /> : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} allowDecimals={false} />
            <Tooltip {...ovTooltip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="sent" name={lang === "en" ? "Sent" : "Envoyés"} fill={OV_COLORS.out} radius={[3, 3, 0, 0]} />
            <Bar dataKey="received" name={lang === "en" ? "Received" : "Reçus"} fill={OV_COLORS.in} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </OvCard>
  );
}

export function OvDurationChart({ data, lang }: { data: OvDaily[]; lang: "fr" | "en" }) {
  const empty = data.every((d) => !d.avg);
  return (
    <OvCard title={lang === "en" ? "Average call duration (min)" : "Durée moyenne d'appel (min)"} icon={<Timer className="w-4 h-4" />}>
      {empty ? <OvEmpty label={lang === "en" ? "No data" : "Aucune donnée"} /> : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} />
            <Tooltip {...ovTooltip} />
            <Line type="monotone" dataKey="avg" name={lang === "en" ? "Minutes" : "Minutes"} stroke={OV_COLORS.accent} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </OvCard>
  );
}
