import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

export type KpiCard = {
  label: string;
  value: string | number;
  delta?: number | null; // percent change vs previous period
  invert?: boolean;      // lower is better (missed calls)
  accent?: string;       // optional accent color
  spark?: number[];      // optional mini trend series
  Icon: React.ComponentType<{ className?: string }>;
};

const ACCENTS = ["#2E9BDC", "#E84C4C", "#00D4AA", "#9B7FE8", "#4AC9E3", "#E8A33C", "#E86CB0", "#2E9BDC"];

function Delta({ delta, invert }: { delta?: number | null; invert?: boolean }) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const flat = Math.abs(delta) < 1;
  const good = invert ? delta < 0 : delta > 0;
  const color = flat ? "var(--pp-text-muted)" : good ? "#22c55e" : "#E84C4C";
  const Icon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5"
      style={{ color, fontSize: 10.5, fontWeight: 700, background: `${flat ? "#8888881f" : good ? "#22c55e1f" : "#E84C4C1f"}` }}
    >
      <Icon className="w-3 h-3" />{Math.abs(Math.round(delta))}%
    </span>
  );
}

function Spark({ values, accent }: { values: number[]; accent: string }) {
  const pts = values.slice(-16);
  if (pts.length < 2) return null;
  const max = Math.max(...pts, 1);
  const w = 100, h = 28;
  const d = pts
    .map((v, i) => `${(i / (pts.length - 1)) * w},${h - (v / max) * (h - 3) - 1.5}`)
    .join(" L ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-x-0 bottom-0" style={{ height: 30, opacity: 0.5 }}>
      <defs>
        <linearGradient id={`sp-${accent.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
          <stop offset="100%" stopColor={accent} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`M ${d} L ${w},${h} L 0,${h} Z`} fill={`url(#sp-${accent.slice(1)})`} />
      <path d={`M ${d}`} fill="none" stroke={accent} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function OvKpiRow({ cards }: { cards: KpiCard[] }) {
  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      {cards.map(({ label, value, delta, invert, Icon, accent, spark }, idx) => {
        const color = accent ?? ACCENTS[idx % ACCENTS.length];
        return (
          <div
            key={label}
            className="relative overflow-hidden rounded-xl transition-transform duration-300 hover:-translate-y-1"
            style={{
              padding: 14,
              border: "1px solid var(--pp-bg-border)",
              background: `linear-gradient(150deg, ${color}14, transparent 55%), var(--pp-bg-card, var(--pp-bg-elevated))`,
              boxShadow: `0 18px 36px -30px rgba(0,0,0,.95), 0 0 0 1px ${color}1f inset`,
            }}
          >
            {spark && spark.length > 1 && <Spark values={spark} accent={color} />}
            <div className="relative flex items-center gap-2">
              <span
                className="rounded-lg flex items-center justify-center shrink-0"
                style={{ width: 24, height: 24, background: `${color}22`, border: `1px solid ${color}55`, color }}
              >
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{label}</span>
            </div>
            <div className="relative flex items-baseline gap-2" style={{ marginTop: 8 }}>
              <span className="tabular-nums" style={{ fontSize: 22, fontWeight: 800, color: "var(--pp-text-primary)", letterSpacing: "-.02em" }}>
                {value}
              </span>
              <Delta delta={delta} invert={invert} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
