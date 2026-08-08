import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Mic } from "lucide-react";
import { OvCard, OvEmpty, OV_COLORS, ovTooltip } from "./OvCard";
import type { OvRecWeek } from "@/hooks/useBrokerOverview";

export default function OvRecordingsChart({ data, lang }: { data: OvRecWeek[]; lang: "fr" | "en" }) {
  const empty = data.every((d) => !d.recorded && !d.transcribed && !d.analyzed);
  return (
    <OvCard
      title={lang === "en" ? "Recordings & AI analysis" : "Enregistrements & analyses IA"}
      icon={<Mic className="w-4 h-4" />}
      to="/planipret/broker/recordings"
      toLabel={lang === "en" ? "View all" : "Voir tout"}
    >
      {empty ? <OvEmpty label={lang === "en" ? "No recordings in this period" : "Aucun enregistrement sur la période"} /> : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} />
            <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} allowDecimals={false} />
            <Tooltip {...ovTooltip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="recorded" stackId="r" name={lang === "en" ? "Recorded" : "Enregistrés"} fill={OV_COLORS.in} radius={[0, 0, 0, 0]} />
            <Bar dataKey="transcribed" stackId="r" name={lang === "en" ? "Transcribed" : "Transcrits"} fill={OV_COLORS.out} />
            <Bar dataKey="analyzed" stackId="r" name={lang === "en" ? "Analyzed" : "Analysés"} fill={OV_COLORS.accent} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </OvCard>
  );
}
