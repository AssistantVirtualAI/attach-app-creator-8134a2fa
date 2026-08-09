import { memo } from "react";
import { Badge3D, Delta3D, Threshold3D } from "./ov3d";

export type KpiCard = {
  label: string;
  value: string | number;
  delta?: number | null; // percent change vs previous period
  invert?: boolean;      // lower is better (missed calls)
  accent?: string;       // optional accent color
  spark?: number[];      // optional mini trend series
  /** Optional micro threshold indicator (e.g. answer rate targets). */
  threshold?: { value: number; warn: number; bad: number; invert?: boolean; label?: string };
  /** Optional small caption under the value (e.g. "vs 120 période préc.") */
  hint?: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const ACCENTS = ["#2E9BDC", "#E84C4C", "#00D4AA", "#9B7FE8", "#4AC9E3", "#E8A33C", "#E86CB0", "#2E9BDC"];

const Spark = memo(function Spark({ values, accent }: { values: number[]; accent: string }) {
  const pts = values.slice(-16);
  if (pts.length < 2) return null;
  const max = Math.max(...pts, 1);
  const w = 100, h = 28;
  const d = pts
    .map((v, i) => `${(i / (pts.length - 1)) * w},${h - (v / max) * (h - 3) - 1.5}`)
    .join(" L ");
  const id = `sp-${accent.slice(1)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-x-0 bottom-0" style={{ height: 30, opacity: 0.5 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
          <stop offset="100%" stopColor={accent} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`M ${d} L ${w},${h} L 0,${h} Z`} fill={`url(#${id})`} />
      <path d={`M ${d}`} fill="none" stroke={accent} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
});

function OvKpiRow({ cards }: { cards: KpiCard[] }) {
  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      {cards.map(({ label, value, delta, invert, Icon, accent, spark, threshold, hint }, idx) => {
        const color = accent ?? ACCENTS[idx % ACCENTS.length];
        return (
          <div key={label} className="ov3d-card ov3d-tile relative overflow-hidden" style={{ ["--ov3d-accent" as any]: color, padding: 14, borderRadius: 12 }}>
            {spark && spark.length > 1 && <Spark values={spark} accent={color} />}
            <div className="relative flex items-center gap-2">
              <span
                className="rounded-lg flex items-center justify-center shrink-0"
                style={{ width: 24, height: 24, background: `${color}22`, border: `1px solid ${color}55`, color }}
              >
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{label}</span>
              {threshold && (
                <span className="ml-auto">
                  <Threshold3D {...threshold} />
                </span>
              )}
            </div>
            <div className="relative flex items-baseline gap-2" style={{ marginTop: 8 }}>
              <span className="tabular-nums" style={{ fontSize: 22, fontWeight: 800, color: "var(--pp-text-primary)", letterSpacing: "-.02em" }}>
                {value}
              </span>
              <Delta3D delta={delta} invert={invert} />
            </div>
            {hint && (
              <div className="relative" style={{ marginTop: 4 }}>
                <Badge3D color="#8b93a7">{hint}</Badge3D>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default memo(OvKpiRow);
