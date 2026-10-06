import { LEMTEL_DICT, type Lang } from "./lemtelI18n";
import { LemtelMonogram } from "./LemtelUi";

export interface DownloadLinks { desktop?: string; ios?: string; android?: string }

/** Preview only — the real temporary password exists only in the server-side send. */
export function LemtelEmailPreview({ lang, name, email, org, links, support }: {
  lang: Lang; name: string; email: string; org: string; links: DownloadLinks; support?: string;
}) {
  const t = LEMTEL_DICT[lang];
  const e = t.mail;
  return (
    <article aria-label={t.previewEmail} className="lt-card overflow-hidden text-sm">
      <header className="lt-chrome px-6 py-5 flex items-center gap-3">
        <LemtelMonogram size={34} />
        <div><div className="font-semibold">{t.brand}</div><div className="lt-muted-on-navy text-xs">{t.tagline}</div></div>
      </header>
      <div className="px-6 py-5 space-y-4">
        <h3 className="text-xl font-semibold">{e.subject}</h3>
        <p>{e.hello(name || "—")}</p>
        <p>{e.intro(org || "—")}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-4 rounded-xl" style={{ background: "hsl(var(--lt-surface))" }}>
          <dt className="lt-ink-2">{e.username}</dt><dd className="font-medium break-all">{email || "—"}</dd>
          <dt className="lt-ink-2">{e.tempPwd}</dt><dd className="italic lt-ink-2">{e.tempPlaceholder}</dd>
        </dl>
        <div>
          <p className="font-semibold mb-1">{e.stepsTitle}</p>
          <ol className="list-decimal pl-5 space-y-0.5">{e.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
        <div>
          <p className="font-semibold mb-2">{e.getApps}</p>
          <div className="flex flex-wrap gap-2">
            {(["desktop", "ios", "android"] as const).map((k) => (
              <span key={k} className={`lt-chip ${links[k] ? "lt-chip-cyan" : ""}`}>{t[k]}{!links[k] && ` · ${t.notConfigured}`}</span>
            ))}
          </div>
        </div>
        <p className="lt-notice px-3 py-2 text-xs">{e.note}</p>
        <p className="lt-ink-2 text-xs">{e.supportLine} {support || "support@…"}</p>
      </div>
    </article>
  );
}
