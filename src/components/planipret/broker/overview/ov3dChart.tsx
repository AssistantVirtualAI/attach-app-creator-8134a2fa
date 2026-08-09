import { memo, type ReactNode } from "react";

/** Global SVG filter used by .ov3d-chart bars to look extruded. */
export const Ov3DChartFilters = memo(function Ov3DChartFilters() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <filter id="ov3dExtrude" x="-30%" y="-30%" width="180%" height="180%">
          <feDropShadow dx="2" dy="3" stdDeviation="0" floodColor="rgba(0,0,0,0.55)" />
          <feDropShadow dx="0" dy="10" stdDeviation="6" floodColor="rgba(0,0,0,0.45)" />
        </filter>
      </defs>
    </svg>
  );
});

/** Wrapper adding the 3D stage (shadow, extrusion filters) around a chart. */
export function Chart3D({ children }: { children: ReactNode }) {
  return <div className="ov3d-chart">{children}</div>;
}

const gid = (color: string) => `ov3dg-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

/** Gradient defs for a set of colors — use with fill3d(color). */
export function Ov3DGradients({ colors }: { colors: string[] }) {
  return (
    <defs>
      {Array.from(new Set(colors)).map((c) => (
        <linearGradient key={c} id={gid(c)} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.45} />
          <stop offset="18%" stopColor={c} stopOpacity={1} />
          <stop offset="100%" stopColor={c} stopOpacity={0.55} />
        </linearGradient>
      ))}
      {Array.from(new Set(colors)).map((c) => (
        <linearGradient key={`a-${c}`} id={`${gid(c)}-area`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={0.75} />
          <stop offset="100%" stopColor={c} stopOpacity={0.05} />
        </linearGradient>
      ))}
    </defs>
  );
}

export const fill3d = (color: string) => `url(#${gid(color)})`;
export const areaFill3d = (color: string) => `url(#${gid(color)}-area)`;
