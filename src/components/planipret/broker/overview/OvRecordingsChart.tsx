import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Mic } from "lucide-react";
import { OvCard, OvEmpty, OV_COLORS, ovTooltip } from "./OvCard";
import { Chart3D, Ov3DGradients, fill3d } from "./ov3dChart";
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
        <Chart3D>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <Ov3DGradients colors={[OV_COLORS.in, OV_COLORS.out, OV_COLORS.accent]} />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} />
            <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} allowDecimals={false} />
            <Tooltip {...ovTooltip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="recorded" stackId="r" name={lang === "en" ? "Recorded" : "Enregistrés"} fill={fill3d(OV_COLORS.in)} radius={[0, 0, 0, 0]} />
            <Bar dataKey="transcribed" stackId="r" name={lang === "en" ? "Transcribed" : "Transcrits"} fill={fill3d(OV_COLORS.out)} />
            <Bar dataKey="analyzed" stackId="r" name={lang === "en" ? "Analyzed" : "Analysés"} fill={fill3d(OV_COLORS.accent)} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        </Chart3D>
      )}
    </OvCard>
  );
}
