import { memo } from "react";
import { Boxes } from "lucide-react";
import type { Ov3dLevel } from "@/hooks/useOv3dIntensity";

const LEVELS: { key: Ov3dLevel; fr: string; en: string }[] = [
  { key: "flat", fr: "Plat", en: "Flat" },
  { key: "light", fr: "Léger", en: "Light" },
  { key: "medium", fr: "Moyen", en: "Medium" },
  { key: "max", fr: "Max", en: "Max" },
];

/** Segmented control tuning relief height / shadows / bevels (CSS var --ov3d-d). */
const Ov3DIntensityControl = memo(function Ov3DIntensityControl({
  level, onChange, lang, autoReduced,
}: {
  level: Ov3dLevel;
  onChange: (v: Ov3dLevel) => void;
  lang: "fr" | "en";
  autoReduced?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded-lg px-1.5 py-1"
      style={{ border: "1px solid var(--pp-bg-border)" }}
      title={autoReduced
        ? (lang === "en" ? "3D reduced automatically (low framerate)" : "3D réduit automatiquement (framerate bas)")
        : (lang === "en" ? "3D intensity" : "Intensité 3D")}
    >
      <Boxes className="w-3.5 h-3.5" style={{ color: autoReduced ? "#E8A33C" : "var(--pp-text-muted)" }} />
      {LEVELS.map((l) => {
        const active = level === l.key;
        return (
          <button
            key={l.key}
            type="button"
            onClick={() => onChange(l.key)}
            className="px-2 py-0.5 rounded-md"
            style={{
              fontSize: 11,
              fontWeight: active ? 700 : 500,
              background: active ? "var(--pp-bg-elevated, rgba(255,255,255,.08))" : "transparent",
              color: active ? "var(--pp-text-primary)" : "var(--pp-text-secondary)",
            }}
          >
            {lang === "en" ? l.en : l.fr}
          </button>
        );
      })}
    </div>
  );
});

export default Ov3DIntensityControl;
