import { memo, useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";

/**
 * Accessible contextual tooltip used across the Planiprêt dashboards to
 * explain how a statistic is computed and how to read a variation.
 * Works on hover, focus (keyboard) and tap (mobile).
 */
export const InfoTip = memo(function InfoTip({
  text,
  title,
  size = 12,
  align = "start",
  className = "",
}: {
  text: string;
  title?: string;
  size?: number;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className={`pp-infotip ${className}`} style={{ display: "inline-flex", position: "relative" }}>
      <button
        type="button"
        aria-label={title ? `${title} — info` : "Info"}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: size + 4, height: size + 4, borderRadius: 999,
          color: "var(--pp-text-muted)", background: "transparent", cursor: "help", lineHeight: 0,
        }}
      >
        <Info style={{ width: size, height: size }} />
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          style={{
            position: "absolute", top: "calc(100% + 6px)", zIndex: 60,
            left: align === "start" ? 0 : align === "center" ? "50%" : undefined,
            right: align === "end" ? 0 : undefined,
            transform: align === "center" ? "translateX(-50%)" : undefined,
            width: "max-content", maxWidth: 260,
            background: "var(--pp-bg-elevated, #14161c)",
            border: "1px solid var(--pp-bg-border)",
            borderRadius: 10, padding: "8px 10px",
            fontSize: 11.5, lineHeight: 1.45, fontWeight: 500,
            color: "var(--pp-text-secondary)",
            boxShadow: "0 18px 40px -18px rgba(0,0,0,.95)",
            whiteSpace: "normal", textAlign: "left", pointerEvents: "none",
          }}
        >
          {title && (
            <span style={{ display: "block", fontWeight: 800, color: "var(--pp-text-primary)", marginBottom: 3 }}>
              {title}
            </span>
          )}
          {text}
        </span>
      )}
    </span>
  );
});

/** Small inline caption placed under a stat / chart to explain its meaning. */
export const StatNote = memo(function StatNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, lineHeight: 1.4, color: "var(--pp-text-muted)", marginTop: 6 }}>
      {children}
    </div>
  );
});

export default InfoTip;
