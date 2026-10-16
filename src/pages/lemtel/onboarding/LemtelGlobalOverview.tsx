import { useCallback, useEffect, useState } from "react";
import { Building2, Globe2, Phone, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, RefreshCw, ShieldCheck, Users, Voicemail } from "lucide-react";
import { LemtelError, portalApi, type LemtelPlatformOverview } from "./lemtelHostedApi";
import type { Lang, LemtelDict } from "./lemtelI18n";

type Props = { t: LemtelDict; lang: Lang; readonly: boolean };
type MetricKey = keyof LemtelPlatformOverview["telephony"]["metrics"];

function unavailableTelephony(): LemtelPlatformOverview["telephony"] {
  return {
    provisioning: "not_provisioned",
    metrics: {
      totalCalls: "unavailable", incomingCalls: "unavailable", outgoingCalls: "unavailable",
      missedCalls: "unavailable", activeCalls: "unavailable", voicemail: "unavailable",
    },
  };
}

function emptyOverview(): LemtelPlatformOverview {
  return {
    schemaVersion: "lemtel-platform-overview/v2",
    observation: "observed",
    aggregates: {},
    telephony: unavailableTelephony(),
  };
}

/** A malformed response cannot invent telephony usage or expose Operations telemetry. */
export function normalizePlatformOverview(value: unknown): LemtelPlatformOverview {
  const source = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const aggregateSource = source.aggregates !== null && typeof source.aggregates === "object" && !Array.isArray(source.aggregates) ? source.aggregates as Record<string, unknown> : {};
  const count = (name: string) => Number.isSafeInteger(aggregateSource[name]) && Number(aggregateSource[name]) >= 0 ? Number(aggregateSource[name]) : undefined;
  // The dashboard intentionally accepts no raw call counter until a separately
  // provisioned, server-authoritative telephony contract exists.
  return {
    schemaVersion: "lemtel-platform-overview/v2",
    observation: "observed",
    aggregates: {
      activeOrganizations: count("activeOrganizations"),
      activeDomains: count("activeDomains"),
      activeUsers: count("activeUsers"),
      platformAdministrators: count("platformAdministrators"),
    },
    telephony: unavailableTelephony(),
  };
}

export default function LemtelGlobalOverview({ t, lang, readonly }: Props) {
  const [data, setData] = useState<LemtelPlatformOverview | null>(null);
  const [loading, setLoading] = useState(!readonly);
  const [error, setError] = useState<"not_allowed" | "unavailable" | null>(null);
  const refresh = useCallback(async () => {
    if (readonly) { setData(null); setError("unavailable"); setLoading(false); return; }
    setLoading(true); setError(null);
    try { setData(normalizePlatformOverview(await portalApi.getPlatformOverview())); }
    catch (cause) { setData(null); setError(cause instanceof LemtelError && cause.key === "not_allowed" ? "not_allowed" : "unavailable"); }
    finally { setLoading(false); }
  }, [readonly]);
  useEffect(() => { void refresh(); const interval = window.setInterval(() => void refresh(), 30_000); return () => window.clearInterval(interval); }, [refresh]);

  const overview = data ?? emptyOverview();
  const count = (value: number | undefined) => value === undefined ? "—" : new Intl.NumberFormat(lang).format(value);
  const telephonyMetrics: Array<{ key: MetricKey; icon: typeof Phone; label: string }> = [
    { key: "totalCalls", icon: PhoneCall, label: t.globalOverview.telephonyMetrics.totalCalls },
    { key: "incomingCalls", icon: PhoneIncoming, label: t.globalOverview.telephonyMetrics.incomingCalls },
    { key: "outgoingCalls", icon: PhoneOutgoing, label: t.globalOverview.telephonyMetrics.outgoingCalls },
    { key: "missedCalls", icon: PhoneMissed, label: t.globalOverview.telephonyMetrics.missedCalls },
    { key: "activeCalls", icon: Phone, label: t.globalOverview.telephonyMetrics.activeCalls },
    { key: "voicemail", icon: Voicemail, label: t.globalOverview.telephonyMetrics.voicemail },
  ];

  return <>
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div><h1 className="text-2xl font-semibold">{t.globalOverview.title}</h1><p className="lt-ink-2 text-sm mt-1">{t.globalOverview.subtitle}</p></div>
      <button className="lt-btn lt-btn-ghost" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />{t.globalOverview.refresh}</button>
    </div>
    {error ? <div className="lt-notice p-4 mb-5" role="note"><p className="font-semibold">{error === "not_allowed" ? t.operations.accessTitle : t.globalOverview.unavailableTitle}</p><p className="text-sm">{error === "not_allowed" ? t.operations.accessBody : t.globalOverview.unavailableBody}</p></div> : null}

    <section aria-label={t.globalOverview.organizationStats} className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
      <Metric icon={Building2} label={t.globalOverview.activeOrganizations} value={count(overview.aggregates.activeOrganizations)} />
      <Metric icon={Globe2} label={t.globalOverview.activeDomains} value={count(overview.aggregates.activeDomains)} />
      <Metric icon={Users} label={t.globalOverview.activeUsers} value={count(overview.aggregates.activeUsers)} />
      <Metric icon={ShieldCheck} label={t.globalOverview.platformAdministrators} value={count(overview.aggregates.platformAdministrators)} />
    </section>

    <section aria-label={t.globalOverview.telephonyTitle} className="lt-card p-5 mb-5">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5"><div><div className="flex items-center gap-2"><PhoneCall className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} /><h2 className="font-semibold">{t.globalOverview.telephonyTitle}</h2></div><p className="text-sm lt-ink-2 mt-1">{t.globalOverview.telephonySubtitle}</p></div><span className="lt-chip lt-chip-warn">{t.globalOverview.telephonyNotProvisioned}</span></div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{telephonyMetrics.map(({ key, icon: Icon, label }) => <Metric key={key} icon={Icon} label={label} value="—" detail={t.globalOverview.telephonyUnavailable} />)}</div>
      <p className="text-xs lt-ink-2 mt-5">{t.globalOverview.telephonyNote}</p>
    </section>

    <section className="lt-card p-5"><div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} /><h2 className="font-semibold">{t.globalOverview.dataAuthorityTitle}</h2></div><p className="text-sm lt-ink-2 mt-2">{t.globalOverview.dataAuthorityBody}</p></section>
  </>;
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Phone; label: string; value: string; detail?: string }) {
  return <div className="rounded-lg border p-4" style={{ borderColor: "hsl(var(--lt-border))" }}><div className="flex justify-between gap-3"><span className="text-sm lt-ink-2">{label}</span><Icon className="w-4 h-4" style={{ color: "hsl(var(--lt-cyan))" }} /></div><div className="text-2xl font-semibold tabular-nums mt-3">{value}</div>{detail ? <p className="text-xs lt-ink-2 mt-1">{detail}</p> : null}</div>;
}
