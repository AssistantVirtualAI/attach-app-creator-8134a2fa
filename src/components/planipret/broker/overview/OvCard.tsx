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
  title, icon, to, toLabel, children, className = "",
}: {
  title: string; icon?: ReactNode; to?: string; toLabel?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={`pp-card ${className}`} style={{ padding: 14 }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2" style={{ color: "var(--pp-text-secondary)", fontSize: 12, fontWeight: 600 }}>
          {icon}<span>{title}</span>
        </div>
        {to && (
          <Link to={to} style={{ fontSize: 11, color: "var(--pp-accent, #2E9BDC)" }}>
            {toLabel}
          </Link>
        )}
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
  contentStyle: {
    background: "var(--pp-bg-elevated, #14161c)",
    border: "1px solid var(--pp-bg-border)",
    borderRadius: 10,
    fontSize: 12,
    color: "var(--pp-text-primary)",
  },
} as const;
