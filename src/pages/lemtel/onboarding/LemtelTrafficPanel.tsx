import { useId } from "react";
import { Activity, ArrowDownLeft, ArrowUpRight, Cloud, Server } from "lucide-react";
import type { Lang, LemtelDict } from "./lemtelI18n";
import type { LemtelTrafficNodeRole, LemtelTrafficSample, LemtelTrafficTrend } from "./lemtelHostedApi";

type Props = { t: LemtelDict; lang: Lang; trend: LemtelTrafficTrend | null; loading: boolean; unavailable: boolean };
const ROLES: LemtelTrafficNodeRole[] = ["do_writer", "hostinger_standby"];
const RX = "hsl(var(--lt-cyan))";
const TX = "#a78bfa";

function bytes(value: number | undefined, lang: Lang, unit: string) {
  if (value === undefined) return "—";
  if (value < 1024) return `${new Intl.NumberFormat(lang).format(value)} ${unit}`;
  const power = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value / 1024 ** power)} ${["", "KiB", "MiB", "GiB", "TiB"][power]}`;
}
function date(value: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function LemtelTrafficPanel({ t, lang, trend, loading, unavailable }: Props) {
  const text = t.operations.traffic;
  const hasData = trend?.roles.some((role) => role.samples.length > 0) ?? false;
  return <section aria-label={text.title} className="mb-5">
    <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
      <div><h2 className="font-semibold text-lg flex items-center gap-2"><Activity className="w-5 h-5" style={{ color: RX }} aria-hidden="true" />{text.title}</h2><p className="text-xs lt-ink-2 mt-1">{text.subtitle}</p></div>
      <div className="flex gap-4 text-xs" aria-label={text.chart}><span className="flex gap-1 items-center"><ArrowDownLeft className="w-4 h-4" style={{ color: RX }} aria-hidden="true" />{text.rx}</span><span className="flex gap-1 items-center"><ArrowUpRight className="w-4 h-4" style={{ color: TX }} aria-hidden="true" />{text.tx}</span></div>
    </div>
    {loading ? <p className="lt-notice p-4 mb-4 text-sm" role="status">{text.loading}</p> : unavailable ? <p className="lt-notice p-4 mb-4 text-sm" role="status">{text.unavailable}</p> : !hasData ? <p className="lt-notice p-4 mb-4 text-sm" role="status">{text.empty}</p> : null}
    <div className="grid md:grid-cols-2 gap-5">
      {ROLES.map((nodeRole) => {
        const role = !unavailable ? trend?.roles.find((entry) => entry.nodeRole === nodeRole) : undefined;
        const latest = role?.latest;
        const Icon = nodeRole === "do_writer" ? Server : Cloud;
        const label = nodeRole === "do_writer" ? text.doWriter : text.hostingerStandby;
        const collecting = role?.collectorState === "collecting";
        return <article key={nodeRole} className="lt-card p-5 min-w-0 overflow-hidden" aria-label={label}>
          <div className="flex flex-wrap justify-between gap-3 items-center mb-5"><h3 className="flex items-center gap-2 font-semibold"><span className="rounded-xl p-2" style={{ background: "hsl(var(--lt-cyan) / .10)", color: RX }}><Icon className="w-5 h-5" aria-hidden="true" /></span>{label}</h3><span className={`lt-chip ${collecting ? "lt-chip-ok" : "lt-chip-warn"}`}>{collecting ? text.collecting : text.pending}</span></div>
          <dl className="grid grid-cols-2 gap-4 mb-4">
            <div><dt className="text-xs lt-ink-2 flex gap-1 items-center"><ArrowDownLeft className="w-3 h-3" aria-hidden="true" />{text.rx}</dt><dd className="text-2xl font-semibold mt-1 break-words" style={{ color: RX }}>{bytes(latest?.rxBytes, lang, text.unit)}</dd></div>
            <div><dt className="text-xs lt-ink-2 flex gap-1 items-center"><ArrowUpRight className="w-3 h-3" aria-hidden="true" />{text.tx}</dt><dd className="text-2xl font-semibold mt-1 break-words" style={{ color: TX }}>{bytes(latest?.txBytes, lang, text.unit)}</dd></div>
            <div className="col-span-2 flex justify-between gap-3 text-xs border-t pt-3" style={{ borderColor: "hsl(var(--lt-border))" }}><dt className="lt-ink-2">{text.tcp}</dt><dd className="font-semibold">{latest ? new Intl.NumberFormat(lang).format(latest.tcpEstablished) : "—"}</dd></div>
          </dl>
          <p className="text-[11px] lt-ink-2 mb-4">{latest ? `${text.latest} · ${date(latest.observedAt, lang)} · ${latest.periodSeconds} ${text.seconds}` : text.noRoleData}</p>
          <TrafficChart samples={role?.samples ?? []} trend={trend} label={label} t={t} lang={lang} />
        </article>;
      })}
    </div>
    <p className="text-xs lt-ink-2 mt-3">{text.note}</p>
  </section>;
}

export function TrafficChart({ samples, trend, label, t, lang }: { samples: LemtelTrafficSample[]; trend: LemtelTrafficTrend | null; label: string; t: LemtelDict; lang: Lang }) {
  const id = useId().replace(/:/g, "");
  const text = t.operations.traffic;
  if (!trend || samples.length < 2) return <div className="lt-chart-empty text-xs">{text.chartPending}</div>;
  const start = Date.parse(trend.windowStart), end = Date.parse(trend.windowEnd);
  const width = 600, height = 190, left = 12, right = 588, top = 18, bottom = 165;
  const max = Math.max(...samples.flatMap((sample) => [sample.rxBytes, sample.txBytes]));
  const scale = max || 1; // Geometry only; never displayed as an observed value.
  const point = (sample: LemtelTrafficSample, key: "rxBytes" | "txBytes") => [
    Math.max(left, Math.min(right, left + (Date.parse(sample.observedAt) - start) / (end - start) * (right - left))),
    bottom - sample[key] / scale * (bottom - top),
  ];
  const groups: LemtelTrafficSample[][] = [];
  for (const sample of samples) {
    const group = groups.at(-1);
    if (!group || Date.parse(sample.observedAt) - Date.parse(group.at(-1)!.observedAt) > trend.bucketSeconds * 1000) groups.push([sample]);
    else group.push(sample);
  }
  return <figure>
    <div className="flex justify-between text-[10px] lt-ink-2 mb-1"><span>{text.axis}</span><span>{bytes(max, lang, text.unit)}</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`} className="w-full h-auto">
      <title id={`${id}-title`}>{`${label} · ${text.chart}`}</title><desc id={`${id}-desc`}>{text.description}</desc>
      <defs><linearGradient id={`${id}-rx`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={RX} stopOpacity=".24" /><stop offset="100%" stopColor={RX} stopOpacity="0" /></linearGradient></defs>
      {[top, (top + bottom) / 2, bottom].map((y) => <path key={y} d={`M ${left} ${y} H ${right}`} stroke="hsl(var(--lt-border))" strokeWidth="1" strokeDasharray="3 5" fill="none" />)}
      {(["rxBytes", "txBytes"] as const).map((key) => groups.map((group, index) => {
        const points = group.map((sample) => point(sample, key));
        const line = points.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
        return <g key={`${key}-${index}`} data-series={key}>
          {key === "rxBytes" && points.length > 1 ? <path d={`${line} L ${points.at(-1)![0]} ${bottom} L ${points[0][0]} ${bottom} Z`} fill={`url(#${id}-rx)`} /> : null}
          <path d={line} fill="none" stroke={key === "rxBytes" ? RX : TX} strokeWidth="2.5" strokeDasharray={key === "txBytes" ? "5 4" : undefined} strokeLinejoin="round" />
          {group.map((sample) => { const [x, y] = point(sample, key); return <circle key={sample.observedAt} cx={x} cy={y} r="2.5" fill={key === "rxBytes" ? RX : TX}><title>{`${date(sample.observedAt, lang)} · ${key === "rxBytes" ? text.rx : text.tx}: ${new Intl.NumberFormat(lang).format(sample[key])} ${text.unit}`}</title></circle>; })}
        </g>;
      }))}
    </svg>
    <figcaption className="flex justify-between text-[10px] lt-ink-2 gap-2"><span>{date(trend.windowStart, lang)}</span><span>{date(trend.windowEnd, lang)}</span></figcaption>
  </figure>;
}
