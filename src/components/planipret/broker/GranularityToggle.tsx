import { GRANULARITY_LABELS, type Granularity } from "@/lib/planipret/timeBuckets";

const ORDER: Granularity[] = ["day", "week", "month", "quarter"];

export default function GranularityToggle({
  value, onChange, lang, options = ORDER,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
  lang: "fr" | "en";
  options?: Granularity[];
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onChange(g)}
          className="px-2.5 py-1.5 rounded-lg"
          style={{
            fontSize: 12,
            border: "1px solid var(--pp-bg-border)",
            background: value === g ? "var(--pp-bg-elevated, rgba(255,255,255,0.06))" : "transparent",
            color: value === g ? "var(--pp-text-primary)" : "var(--pp-text-secondary)",
          }}
        >
          {GRANULARITY_LABELS[g][lang]}
        </button>
      ))}
    </div>
  );
}
