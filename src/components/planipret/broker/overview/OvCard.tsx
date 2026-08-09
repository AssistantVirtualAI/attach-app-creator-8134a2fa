import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export const OV_COLORS = {
  in: "#2E9BDC",
  out: "#00D4AA",
  missed: "#E84C4C",
  accent: "#9B7FE8",
  warm: "#E8A33C",
};

export function OvCard({
  title, icon, to, toLabel, children, className = "", right,
}: {
  title: string; icon?: ReactNode; to?: string; toLabel?: string; children: ReactNode; className?: string; right?: ReactNode;
}) {
  return (
    <div className={`ov3d-card relative overflow-hidden ${className}`} style={{ padding: 14 }}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2" style={{ color: "var(--pp-text-secondary)", fontSize: 12, fontWeight: 600 }}>
          {icon}<span>{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {right}
          {to && (
            <Link to={to} style={{ fontSize: 11, color: "var(--pp-accent, #2E9BDC)" }}>
              {toLabel}
            </Link>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

export function OvEmpty({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center" style={{ height: 200, fontSize: 12, color: "var(--pp-text-muted)" }}>
      {label}
    </div>
  );
}

export const ovTooltip = {
  // Legibility over the 3D relief: opaque surface, no inherited filters,
  // strong label/value contrast and a soft cursor highlight.
  wrapperStyle: { outline: "none", zIndex: 40 },
  cursor: { fill: "rgba(255,255,255,0.06)", stroke: "rgba(255,255,255,0.12)" },
  contentStyle: {
    background: "var(--pp-bg-elevated, #14161c)",
    border: "1px solid var(--pp-bg-border)",
    borderRadius: 10,
    fontSize: 12,
    padding: "8px 10px",
    color: "var(--pp-text-primary)",
    boxShadow: "0 18px 40px -18px rgba(0,0,0,.95)",
    filter: "none",
  },
  labelStyle: { color: "var(--pp-text-primary)", fontWeight: 700, marginBottom: 4 },
  itemStyle: { color: "var(--pp-text-secondary)", padding: "1px 0" },
} as const;

/** Legend style that stays readable above gradients / shadows. */
export const ovLegend = {
  wrapperStyle: { fontSize: 11, filter: "none", color: "var(--pp-text-secondary)" },
  iconSize: 9,
} as const;
