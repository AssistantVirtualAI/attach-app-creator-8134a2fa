import type { ReactNode } from "react";

/**
 * Decorative page banner used at the top of Planiprêt admin & broker pages.
 * Presentation only.
 */
export default function PPPageBanner({
  image,
  title,
  subtitle,
  accent = "#3B82F6",
  actions,
}: {
  image: string;
  title: ReactNode;
  subtitle?: ReactNode;
  accent?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl mb-4"
      style={{
        border: "1px solid var(--pp-bg-border)",
        boxShadow: "0 18px 40px -24px rgba(0,0,0,.7)",
        minHeight: 116,
      }}
    >
      <img
        src={image}
        alt=""
        aria-hidden="true"
        loading="lazy"
        width={1600}
        height={512}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 0.55 }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(100deg, rgba(6,13,26,.96) 0%, rgba(6,13,26,.78) 45%, ${accent}22 100%)`,
        }}
      />
      <div className="relative flex items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <div className="min-w-0">
          <h2
            className="truncate"
            style={{ fontSize: 19, fontWeight: 900, color: "var(--pp-text-primary)", letterSpacing: -0.3 }}
          >
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1" style={{ fontSize: 12.5, color: "var(--pp-text-secondary)" }}>
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div
        className="absolute left-0 bottom-0 h-[3px] w-full"
        style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
      />
    </div>
  );
}
