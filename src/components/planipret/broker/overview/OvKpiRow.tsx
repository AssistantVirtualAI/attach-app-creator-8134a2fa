import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

export type KpiCard = {
  label: string;
  value: string | number;
  delta?: number | null; // percent change vs previous period
  invert?: boolean;      // lower is better (missed calls)
  Icon: React.ComponentType<{ className?: string }>;
};

function Delta({ delta, invert }: { delta?: number | null; invert?: boolean }) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const flat = Math.abs(delta) < 1;
  const good = invert ? delta < 0 : delta > 0;
  const color = flat ? "var(--pp-text-muted)" : good ? "#22c55e" : "#E84C4C";
  const Icon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5" style={{ color, fontSize: 11, fontWeight: 600 }}>
      <Icon className="w-3 h-3" />{Math.abs(Math.round(delta))}%
    </span>
  );
}

export default function OvKpiRow({ cards }: { cards: KpiCard[] }) {
  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      {cards.map(({ label, value, delta, invert, Icon }) => (
        <div key={label} className="pp-card" style={{ padding: 14 }}>
          <div className="flex items-center gap-2" style={{ color: "var(--pp-text-muted)" }}>
            <Icon className="w-4 h-4" />
            <span style={{ fontSize: 11 }}>{label}</span>
          </div>
          <div className="flex items-baseline gap-2" style={{ marginTop: 6 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: "var(--pp-text-primary)" }}>{value}</span>
            <Delta delta={delta} invert={invert} />
          </div>
        </div>
      ))}
    </div>
  );
}
