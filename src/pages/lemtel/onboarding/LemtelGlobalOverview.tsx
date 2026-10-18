import { useCallback, useEffect, useState } from "react";
import { BarChart3, Building2, FileText, Globe2, Laptop, Monitor, Phone, PhoneCall, RefreshCw, Server, ShieldCheck, Smartphone, Users, Voicemail, type LucideIcon } from "lucide-react";
import { LemtelError, portalApi, type LemtelPlatformOverview } from "./lemtelHostedApi";
import type { Lang, LemtelDict } from "./lemtelI18n";

type Props = { t: LemtelDict; lang: Lang; readonly: boolean };
type AggregateKey = keyof LemtelPlatformOverview["aggregates"];
type DistributionItem = { label: string; value: number | undefined };

function unavailableTelephony(): LemtelPlatformOverview["telephony"] {
  return {
    provisioning: "not_provisioned",
    metrics: {
      cdr: "unavailable", activeCalls: "unavailable", extensions: "unavailable", trunks: "unavailable", voicemail: "unavailable",
    },
  };
}

function noObservationClientPresence(): LemtelPlatformOverview["clientPresence"] {
  return { observation: "no_observation" };
}

function emptyOverview(): LemtelPlatformOverview {
  return {
    schemaVersion: "lemtel-platform-overview/v3",
    observation: "no_observation",
    aggregates: {},
    clientPresence: noObservationClientPresence(),
    telephony: unavailableTelephony(),
  };
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function count(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function normalizeClientPresence(value: unknown): LemtelPlatformOverview["clientPresence"] {
  const source = object(value);
  if (source.observation !== "observed") return noObservationClientPresence();
  const observed = object(source.observedConnections);
  const controls = object(source.accessControls);
  const total = count(observed.total);
  const desktop = count(observed.desktop);
  const mobile = count(observed.mobile);
  const portal = count(observed.portal);
  const client = count(observed.client);
  const explicitlyRevoked = count(controls.explicitlyRevoked);
  if ([total, desktop, mobile, portal, client, explicitlyRevoked].some((value) => value === undefined)
    || total !== desktop + mobile + portal + client) return noObservationClientPresence();
  return { observation: "observed", observedConnections: { total, desktop, mobile, portal, client }, accessControls: { explicitlyRevoked } };
}

/** A malformed response cannot invent telephony usage, connection counts or Operations telemetry. */
function normalizePlatformOverview(value: unknown): LemtelPlatformOverview {
  const source = object(value);
  if (source.schemaVersion !== "lemtel-platform-overview/v3") return emptyOverview();
  const aggregateSource = object(source.aggregates);
  return {
    schemaVersion: "lemtel-platform-overview/v3",
    observation: source.observation === "observed" ? "observed" : "no_observation",
    aggregates: {
      activeOrganizations: count(aggregateSource.activeOrganizations),
      activeDomains: count(aggregateSource.activeDomains),
      activeUsers: count(aggregateSource.activeUsers),
      platformAdministrators: count(aggregateSource.platformAdministrators),
    },
    clientPresence: normalizeClientPresence(source.clientPresence),
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
  const format = (value: number | undefined) => value === undefined ? "—" : new Intl.NumberFormat(lang).format(value);
  const connectionObservation = overview.clientPresence.observation === "observed" ? overview.clientPresence : undefined;
  const businessMetrics: Array<{ key: AggregateKey; icon: LucideIcon; label: string; value: number | undefined }> = [
    { key: "activeOrganizations", icon: Building2, label: t.globalOverview.activeOrganizations, value: overview.aggregates.activeOrganizations },
    { key: "activeDomains", icon: Globe2, label: t.globalOverview.activeDomains, value: overview.aggregates.activeDomains },
    { key: "activeUsers", icon: Users, label: t.globalOverview.activeUsers, value: overview.aggregates.activeUsers },
    { key: "platformAdministrators", icon: ShieldCheck, label: t.globalOverview.platformAdministrators, value: overview.aggregates.platformAdministrators },
  ];
  const distribution: DistributionItem[] = [
    { label: t.globalOverview.activeOrganizations, value: overview.aggregates.activeOrganizations },
    { label: t.globalOverview.activeDomains, value: overview.aggregates.activeDomains },
    { label: t.globalOverview.activeUsers, value: overview.aggregates.activeUsers },
    { label: t.globalOverview.observedConnections, value: connectionObservation?.observedConnections.total },
  ];
  const connectionMetrics: Array<{ icon: LucideIcon; label: string; value: number | undefined }> = [
    { icon: Monitor, label: t.globalOverview.observedConnections, value: connectionObservation?.observedConnections.total },
    { icon: Laptop, label: t.globalOverview.desktopConnections, value: connectionObservation?.observedConnections.desktop },
    { icon: Smartphone, label: t.globalOverview.mobileConnections, value: connectionObservation?.observedConnections.mobile },
    { icon: ShieldCheck, label: t.globalOverview.accessRevocations, value: connectionObservation?.accessControls.explicitlyRevoked },
  ];
  const telephonyCards: Array<{ icon: LucideIcon; label: string }> = [
    { icon: FileText, label: t.globalOverview.telephonyMetrics.cdr },
    { icon: Phone, label: t.globalOverview.telephonyMetrics.activeCalls },
    { icon: PhoneCall, label: t.globalOverview.telephonyMetrics.extensions },
    { icon: Server, label: t.globalOverview.telephonyMetrics.trunks },
    { icon: Voicemail, label: t.globalOverview.telephonyMetrics.voicemail },
  ];

  return <>
    <div className="lt-overview-hero flex flex-wrap items-start justify-between gap-4 mb-6">
      <div><span className="lt-overview-kicker">{t.globalOverview.kicker}</span><h1 className="text-2xl font-semibold mt-1">{t.globalOverview.title}</h1><p className="lt-ink-2 text-sm mt-1 max-w-2xl">{t.globalOverview.subtitle}</p></div>
      <button className="lt-btn lt-btn-ghost" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />{t.globalOverview.refresh}</button>
    </div>
    {error ? <div className="lt-notice p-4 mb-5" role="note"><p className="font-semibold">{error === "not_allowed" ? t.operations.accessTitle : t.globalOverview.unavailableTitle}</p><p className="text-sm">{error === "not_allowed" ? t.operations.accessBody : t.globalOverview.unavailableBody}</p></div> : null}

    <section aria-label={t.globalOverview.organizationStats} className="mb-5">
      <SectionHeading icon={Building2} title={t.globalOverview.organizationStats} detail={t.globalOverview.organizationStatsDetail} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">{businessMetrics.map(({ key, icon, label, value }) => <Metric key={key} icon={icon} label={label} value={format(value)} detail={t.globalOverview.authoritativeAggregate} />)}</div>
    </section>

    <section className="lt-card p-5 mb-5" aria-label={t.globalOverview.aggregateDistribution}>
      <SectionHeading icon={BarChart3} title={t.globalOverview.aggregateDistribution} detail={t.globalOverview.aggregateDistributionBody} />
      <AggregateDistribution lang={lang} items={distribution} emptyLabel={t.globalOverview.aggregateDistributionEmpty} ariaLabel={t.globalOverview.aggregateDistributionAria} />
    </section>

    <section className="lt-card p-5 mb-5" aria-label={t.globalOverview.applicationsTitle}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5"><div><SectionHeading icon={Monitor} title={t.globalOverview.applicationsTitle} detail={t.globalOverview.applicationsSubtitle} /></div><span className={`lt-chip ${connectionObservation ? "lt-chip-cyan" : "lt-chip-warn"}`}>{connectionObservation ? t.globalOverview.observed : t.globalOverview.noObservation}</span></div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">{connectionMetrics.map(({ icon, label, value }) => <Metric key={label} icon={icon} label={label} value={format(value)} detail={connectionObservation ? t.globalOverview.authoritativeAggregate : t.globalOverview.noObservationDetail} />)}</div>
    </section>

    <section aria-label={t.globalOverview.telephonyTitle} className="lt-card p-5 mb-5">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5"><div><SectionHeading icon={PhoneCall} title={t.globalOverview.telephonyTitle} detail={t.globalOverview.telephonySubtitle} /></div><span className="lt-chip lt-chip-warn">{t.globalOverview.telephonyNotProvisioned}</span></div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">{telephonyCards.map(({ icon, label }) => <Metric key={label} icon={icon} label={label} value="—" detail={t.globalOverview.telephonyUnavailable} status={t.globalOverview.telephonyNotProvisioned} />)}</div>
      <p className="text-xs lt-ink-2 mt-5">{t.globalOverview.telephonyNote}</p>
    </section>

    <section className="lt-card p-5"><SectionHeading icon={ShieldCheck} title={t.globalOverview.dataAuthorityTitle} detail={t.globalOverview.dataAuthorityBody} /></section>
  </>;
}

function SectionHeading({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return <div className="flex items-start gap-3 mb-4"><span className="lt-overview-section-icon"><Icon className="w-4 h-4" /></span><div><h2 className="font-semibold">{title}</h2><p className="text-sm lt-ink-2 mt-1">{detail}</p></div></div>;
}

function AggregateDistribution({ lang, items, emptyLabel, ariaLabel }: { lang: Lang; items: DistributionItem[]; emptyLabel: string; ariaLabel: string }) {
  const known = items.filter((item): item is { label: string; value: number } => item.value !== undefined);
  if (!known.length) return <div className="lt-chart-empty">{emptyLabel}</div>;
  const maximum = Math.max(1, ...known.map((item) => item.value));
  const format = (value: number) => new Intl.NumberFormat(lang).format(value);
  return <div className="lt-distribution" role="img" aria-label={ariaLabel}>{items.map((item) => <div className="lt-distribution-row" key={item.label}><div className="flex justify-between gap-3 text-xs"><span className="lt-ink-2">{item.label}</span><span className="font-semibold tabular-nums">{item.value === undefined ? "—" : format(item.value)}</span></div><div className="lt-distribution-track" aria-hidden><span className="lt-distribution-fill" style={{ width: item.value === undefined ? "0%" : `${(item.value / maximum) * 100}%` }} /></div></div>)}</div>;
}

function Metric({ icon: Icon, label, value, detail, status }: { icon: LucideIcon; label: string; value: string; detail?: string; status?: string }) {
  return <div className="lt-card lt-stat-card p-4"><div className="flex justify-between gap-3"><span className="text-sm lt-ink-2">{label}</span><Icon className="w-4 h-4" style={{ color: "hsl(var(--lt-cyan))" }} /></div><div className="text-2xl font-semibold tabular-nums mt-3">{value}</div>{status ? <span className="lt-chip lt-chip-warn mt-2">{status}</span> : null}{detail ? <p className="text-xs lt-ink-2 mt-2 leading-relaxed">{detail}</p> : null}</div>;
}
