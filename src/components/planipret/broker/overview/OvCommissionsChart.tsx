import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp } from "lucide-react";
import { OvCard, OvEmpty, OV_COLORS, ovTooltip, ovLegend } from "./OvCard";
import { Chart3D, Ov3DGradients, fill3d } from "./ov3dChart";
import { PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { fetchCommissionRows, fmtMoney, type CommissionRow } from "@/lib/planipret/commissionStats";

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

export default function OvCommissionsChart({
  brokerUserId, brokerName, lang, onTotal,
}: {
  brokerUserId?: string | null;
  brokerName?: string | null;
  lang: "fr" | "en";
  onTotal?: (cy: number, py: number) => void;
}) {
  const [rows, setRows] = useState<CommissionRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchCommissionRows({ brokerUserId, brokerName });
        if (!cancelled) setRows(data);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [brokerUserId, brokerName]);

  const quarters = (rows ?? []).filter((r) => String(r.section) === "quarter");
  const data = QUARTERS.map((q) => {
    const hit = quarters.find((r) => String(r.dimension ?? "").toUpperCase().includes(q));
    return { label: q, cy: Number(hit?.cy_commission ?? 0), py: Number(hit?.py_commission ?? 0) };
  });
  const cyTotal = data.reduce((a, b) => a + b.cy, 0);
  const pyTotal = data.reduce((a, b) => a + b.py, 0);

  useEffect(() => {
    if (rows) onTotal?.(cyTotal, pyTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cyTotal, pyTotal]);

  return (
    <OvCard
      title={lang === "en" ? "Commissions by quarter" : "Commissions par trimestre"}
      icon={<TrendingUp className="w-4 h-4" />}
      to="/planipret/broker/commissions"
      toLabel={lang === "en" ? "View all" : "Voir tout"}
    >
      {rows === null ? <PPSkeleton style={{ height: 220 }} />
        : !cyTotal && !pyTotal ? <OvEmpty label={lang === "en" ? "No commission data" : "Aucune donnée de commission"} />
        : (
          <>
            <div className="flex items-baseline gap-3 mb-1">
              <span style={{ fontSize: 20, fontWeight: 700, color: "var(--pp-text-primary)" }}>{fmtMoney(cyTotal)}</span>
              <span style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>
                {lang === "en" ? "prior year" : "année précédente"} {fmtMoney(pyTotal)}
              </span>
            </div>
            <Chart3D>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
                <Ov3DGradients colors={[OV_COLORS.out, OV_COLORS.accent]} />
                <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--pp-text-muted)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-muted)" }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip {...ovTooltip} formatter={(v: any) => fmtMoney(Number(v))} />
                <Legend {...ovLegend} />
                <Bar dataKey="cy" name={lang === "en" ? "This year" : "Cette année"} fill={fill3d(OV_COLORS.out)} radius={[4, 4, 2, 2]} />
                <Bar dataKey="py" name={lang === "en" ? "Last year" : "An dernier"} fill={fill3d(OV_COLORS.accent)} radius={[4, 4, 2, 2]} />
              </BarChart>
            </ResponsiveContainer>
            </Chart3D>
          </>
        )}
    </OvCard>
  );
}
