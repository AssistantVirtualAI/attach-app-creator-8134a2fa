import { Eye } from "lucide-react";
import { usePpHighReadability } from "@/hooks/usePpHighReadability";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

/** Header toggle enabling the accessible "high readability" rendering. */
export default function HighReadabilityToggle({ compact }: { compact?: boolean }) {
  const { enabled, toggle } = usePpHighReadability();
  const { lang } = useMplanipretLang();
  const isFr = lang !== "en";
  const label = isFr ? "Haute lisibilité" : "High readability";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      title={isFr
        ? "Mode haute lisibilité : graphiques à plat, contrastes et polices renforcés"
        : "High readability mode: flat charts, stronger contrast and larger type"}
      className="inline-flex items-center gap-1.5 rounded-lg"
      style={{
        height: 30,
        padding: compact ? "0 8px" : "0 10px",
        fontSize: 11.5,
        fontWeight: 700,
        border: `1px solid ${enabled ? "var(--pp-brand-accent-2, #2E9BDC)" : "var(--pp-bg-border)"}`,
        background: enabled ? "color-mix(in srgb, var(--pp-brand-accent-2, #2E9BDC) 18%, transparent)" : "var(--pp-bg-elevated)",
        color: enabled ? "var(--pp-text-primary)" : "var(--pp-text-muted)",
      }}
    >
      <Eye className="w-4 h-4" />
      {!compact && <span className="hidden lg:inline">{label}</span>}
    </button>
  );
}
