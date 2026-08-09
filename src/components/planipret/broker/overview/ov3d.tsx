import { memo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

/* Shared 3D primitives for the broker overview.
   Styling lives in src/index.css (.ov3d-*) so rows don't ship
   per-instance inline shadow/gradient objects — much cheaper to
   re-render while sorting or filtering. */

export const OV3D = {
  in: "#2E9BDC",
  out: "#00D4AA",
  missed: "#E84C4C",
  accent: "#9B7FE8",
  warm: "#E8A33C",
  cyan: "#4AC9E3",
  good: "#22c55e",
  muted: "#8b93a7",
} as const;

export const Badge3D = memo(function Badge3D({
  color, children, title,
}: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span className="ov3d-badge" title={title} style={{ ["--ov3d-c" as any]: color }}>
      {children}
    </span>
  );
});

/** Micro delta indicator (variation vs previous period). */
export const Delta3D = memo(function Delta3D({
  delta, invert, suffix = "%",
}: { delta?: number | null; invert?: boolean; suffix?: string }) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const flat = Math.abs(delta) < 1;
  const good = invert ? delta < 0 : delta > 0;
  const color = flat ? OV3D.muted : good ? OV3D.good : OV3D.missed;
  const Icon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Badge3D color={color}>
      <Icon className="w-3 h-3" />
      {Math.abs(Math.round(delta))}{suffix}
    </Badge3D>
  );
});

/** Threshold dot: green / amber / red against a target. */
export const Threshold3D = memo(function Threshold3D({
  value, warn, bad, invert, label,
}: { value: number; warn: number; bad: number; invert?: boolean; label?: string }) {
  const over = (a: number, b: number) => (invert ? a >= b : a <= b);
  const color = over(value, bad) ? OV3D.missed : over(value, warn) ? OV3D.warm : OV3D.good;
  return (
    <span
      title={label}
      style={{
        display: "inline-block", width: 7, height: 7, borderRadius: 999,
        background: color, boxShadow: `0 0 8px -1px ${color}`,
      }}
    />
  );
});

/** Inline proportion bar (share of max) with optional caption. */
export const MicroBar3D = memo(function MicroBar3D({
  value, max, color = OV3D.in, caption,
}: { value: number; max: number; color?: string; caption?: string }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div>
      <div className="ov3d-track" style={{ ["--ov3d-c" as any]: color, marginTop: 5 }}>
        <div className="ov3d-fill" style={{ width: `${pct}%` }} />
      </div>
      {caption && <div style={{ fontSize: 10, color: "var(--pp-text-muted)", marginTop: 3 }}>{caption}</div>}
    </div>
  );
});

export function Table3D({ children, quiet }: { children: React.ReactNode; quiet?: boolean }) {
  return (
    <div className={quiet ? "ov3d-quiet" : undefined}>
      <table className="ov3d-table">{children}</table>
    </div>
  );
}

export const Row3D = memo(function Row3D({
  accent = OV3D.in, children,
}: { accent?: string; children: React.ReactNode }) {
  return <tr className="ov3d-row" style={{ ["--ov3d-accent" as any]: accent }}>{children}</tr>;
});
