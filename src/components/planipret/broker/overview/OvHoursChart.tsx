import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock } from "lucide-react";
import { OvCard, OvEmpty, OV_COLORS, ovTooltip, ovLegend } from "./OvCard";
import { Chart3D, Ov3DGradients, fill3d } from "./ov3dChart";
import type { OvHour } from "@/hooks/useBrokerOverview";

export default function OvHoursChart({ data, lang }: { data: OvHour[]; lang: "fr" | "en" }) {
  const empty = data.every((d) => !d.calls);
  return (
    <OvCard
      title={lang === "en" ? "Busiest hours" : "Heures de pointe"}
      icon={<Clock className="w-4 h-4" />}
      info={lang === "en" ? "Calls aggregated by hour of day (business hours 6am to 11pm, America/Toronto). Use it to align availability with peaks." : "Appels cumulés par heure de la journée (heures d'affaires 6 h à 23 h, heure de Toronto). Sert à aligner votre disponibilité sur les pointes."}
    >
      {empty ? <OvEmpty label={lang === "en" ? "No data" : "Aucune donnée"} /> : (
        <Chart3D>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <Ov3DGradients colors={[OV_COLORS.in]} />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
            <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "var(--pp-text-muted)" }} interval={1} />
            <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} allowDecimals={false} />
            <Tooltip {...ovTooltip} />
            <Bar dataKey="calls" name={lang === "en" ? "Calls" : "Appels"} fill={fill3d(OV_COLORS.in)} radius={[4, 4, 2, 2]} />
          </BarChart>
        </ResponsiveContainer>
        </Chart3D>
      )}
    </OvCard>
  );
}
