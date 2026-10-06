import { LEMTEL_DICT, type Lang } from "./lemtelI18n";
import { LemtelMonogram } from "./LemtelUi";

export interface DownloadLinks { desktop?: string; ios?: string; android?: string }

/** Preview only: the real temporary password exists only in Auth memory and the server-side email send. */
export function LemtelEmailPreview({ lang, name, email, org, links, support }: { lang: Lang; name: string; email: string; org: string; links: DownloadLinks; support?: string }) {
  const text = LEMTEL_DICT[lang];
  const mail = text.mail;
  return <article aria-label={text.previewEmail} className="lt-card overflow-hidden text-sm">
    <header className="lt-chrome px-6 py-5 flex items-center gap-3"><LemtelMonogram size={34} /><div><div className="font-semibold">{text.brand}</div><div className="lt-muted-on-navy text-xs">{text.tagline}</div></div></header>
    <div className="px-6 py-5 space-y-4"><h3 className="text-xl font-semibold">{mail.subject}</h3><p>{mail.hello(name || "—")}</p><p>{mail.intro(org || "—")}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-4 rounded-xl" style={{ background: "hsl(var(--lt-surface))" }}><dt className="lt-ink-2">{mail.username}</dt><dd className="font-medium break-all">{email || "—"}</dd><dt className="lt-ink-2">{mail.tempPwd}</dt><dd className="italic lt-ink-2">{mail.tempPlaceholder}</dd></dl>
      <div><p className="font-semibold mb-1">{mail.stepsTitle}</p><ol className="list-decimal pl-5 space-y-0.5">{mail.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>
      <div><p className="font-semibold mb-2">{mail.getApps}</p><div className="flex flex-wrap gap-2">{(["desktop", "ios", "android"] as const).map((platform) => <span key={platform} className={`lt-chip ${links[platform] ? "lt-chip-cyan" : ""}`}>{text[platform]}{!links[platform] && ` · ${text.notConfigured}`}</span>)}</div></div>
      <p className="lt-notice px-3 py-2 text-xs">{mail.note}</p><p className="lt-ink-2 text-xs">{mail.supportLine} {support || "support@…"}</p>
    </div>
  </article>;
}
