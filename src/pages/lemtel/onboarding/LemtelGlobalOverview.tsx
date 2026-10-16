import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Database, ExternalLink, HardDrive, RefreshCw, Server, ShieldCheck, Smartphone, Users } from "lucide-react";
import { LemtelError, portalApi, type LemtelPlatformOverview, type OperationalHealth } from "./lemtelHostedApi";
import type { Lang, LemtelDict } from "./lemtelI18n";
import { normalizeOperationalStatus } from "./LemtelOperationalStatus";
import LemtelTrafficPanel from "./LemtelTrafficPanel";

type Props = { t: LemtelDict; lang: Lang; readonly: boolean };
type Health = OperationalHealth;

const healthClass: Record<Health, string> = { healthy: "lt-chip-ok", degraded: "lt-chip-bad", unknown: "lt-chip-warn" };
const roleNames = ["do_writer", "hostinger_standby"] as const;

function emptyOverview(): LemtelPlatformOverview {
  return {
    schemaVersion: "lemtel-platform-overview/v1",
    observation: "no_observation",
    aggregates: {},
    operational: { telemetry: "not_configured", overall: "unknown", topology: { writer: "unknown", standby: "unknown", route: "unknown", automaticFailover: false }, services: { runtime: "unknown", database: "unknown", auth: "unknown", rest: "unknown", storage: "unknown", accountRecovery: "unknown" }, replication: { database: "unknown", storage: "unknown" } },
    standby: { schemaVersion: "lemtel-node-status/v1", observation: "no_observation", roles: roleNames.map((nodeRole) => ({ nodeRole, agentState: "unknown", runtimeState: "unknown", replicationState: "unknown", storageState: "unknown" })) },
    traffic: { observation: "no_observation", trend: { windowStart: new Date(0).toISOString(), windowEnd: new Date(0).toISOString(), bucketSeconds: 300, roles: roleNames.map((nodeRole) => ({ nodeRole, collectorState: "pending", samples: [] })) } },
    clientAccess: roleNames.slice(0, 0).map(() => ({ client: "desktop" as const, state: "pending" as const })),
  };
}

/** Defensive parser: a partial or future Edge reply never becomes a fabricated green state. */
export function normalizePlatformOverview(value: unknown): LemtelPlatformOverview {
  const source = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fallback = emptyOverview();
  const aggregateSource = source.aggregates !== null && typeof source.aggregates === "object" && !Array.isArray(source.aggregates) ? source.aggregates as Record<string, unknown> : {};
  const count = (name: string) => Number.isSafeInteger(aggregateSource[name]) && Number(aggregateSource[name]) >= 0 ? Number(aggregateSource[name]) : undefined;
  const standbySource = source.standby !== null && typeof source.standby === "object" && !Array.isArray(source.standby) ? source.standby as Record<string, unknown> : {};
  const rawRoles = Array.isArray(standbySource.roles) ? standbySource.roles : [];
  const roles = roleNames.map((nodeRole) => {
    const candidate = rawRoles.find((entry) => entry !== null && typeof entry === "object" && (entry as Record<string, unknown>).nodeRole === nodeRole) as Record<string, unknown> | undefined;
    return {
      nodeRole,
      ...(typeof candidate?.observedAt === "string" ? { observedAt: candidate.observedAt } : {}),
      agentState: candidate?.agentState === "healthy" || candidate?.agentState === "degraded" ? candidate.agentState : "unknown",
      runtimeState: candidate?.runtimeState === "ready" || candidate?.runtimeState === "degraded" ? candidate.runtimeState : "unknown",
      replicationState: candidate?.replicationState === "streaming" || candidate?.replicationState === "degraded" ? candidate.replicationState : "unknown",
      storageState: candidate?.storageState === "synced" || candidate?.storageState === "degraded" ? candidate.storageState : "unknown",
    };
  });
  const trafficSource = source.traffic !== null && typeof source.traffic === "object" && !Array.isArray(source.traffic) ? source.traffic as Record<string, unknown> : {};
  const access = Array.isArray(source.clientAccess) ? source.clientAccess : [];
  const clientAccess = (["desktop", "ios", "android"] as const).map((client) => {
    const candidate = access.find((entry) => entry !== null && typeof entry === "object" && (entry as Record<string, unknown>).client === client) as Record<string, unknown> | undefined;
    const url = typeof candidate?.url === "string" && /^https:\/\//.test(candidate.url) ? candidate.url : undefined;
    return { client, state: candidate?.state === "configured" && url ? "configured" as const : "pending" as const, ...(url ? { url } : {}) };
  });
  const rawTrend = trafficSource.trend !== null && typeof trafficSource.trend === "object" && !Array.isArray(trafficSource.trend) ? trafficSource.trend : fallback.traffic.trend;
  return {
    schemaVersion: "lemtel-platform-overview/v1",
    observation: source.observation === "observed" ? "observed" : "no_observation",
    aggregates: { activeOrganizations: count("activeOrganizations"), activeMemberships: count("activeMemberships"), platformAdministrators: count("platformAdministrators") },
    operational: { ...normalizeOperationalStatus(source.operational), topology: { ...normalizeOperationalStatus(source.operational).topology, automaticFailover: false } },
    standby: { schemaVersion: "lemtel-node-status/v1", observation: standbySource.observation === "observed" ? "observed" : "no_observation", roles },
    traffic: { observation: trafficSource.observation === "observed" || trafficSource.observation === "unavailable" ? trafficSource.observation : "no_observation", trend: rawTrend as LemtelPlatformOverview["traffic"]["trend"] },
    clientAccess,
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
  const status = overview.operational;
  const serviceRows = [
    [Server, t.operations.services.runtime, status.services.runtime], [Database, t.operations.services.database, status.services.database],
    [ShieldCheck, t.operations.services.auth, status.services.auth], [Activity, t.operations.services.rest, status.services.rest],
    [HardDrive, t.operations.services.storage, status.services.storage], [ShieldCheck, t.operations.services.accountRecovery, status.services.accountRecovery],
  ] as const;
  const backupRows = [
    [Database, t.operations.databaseReplication, t.operations.replication[status.replication.database], status.replication.database === "streaming" ? "healthy" : status.replication.database === "rebuild_required" ? "degraded" : "unknown"],
    [HardDrive, t.operations.storageReplication, t.operations.replication[status.replication.storage], status.replication.storage === "integrity_verified" ? "healthy" : status.replication.storage === "sync_attention" || status.replication.storage === "rebuild_required" ? "degraded" : "unknown"],
  ] as const;
  const count = (value: number | undefined) => value === undefined ? "—" : new Intl.NumberFormat(lang).format(value);

  return <>
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div><h1 className="text-2xl font-semibold">{t.globalOverview.title}</h1><p className="lt-ink-2 text-sm mt-1">{t.globalOverview.subtitle}</p></div>
      <button className="lt-btn lt-btn-ghost" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />{t.globalOverview.refresh}</button>
    </div>
    {error ? <div className="lt-notice p-4 mb-5" role="note"><p className="font-semibold">{error === "not_allowed" ? t.operations.accessTitle : t.globalOverview.unavailableTitle}</p><p className="text-sm">{error === "not_allowed" ? t.operations.accessBody : t.globalOverview.unavailableBody}</p></div> : null}
    {overview.observation === "no_observation" && !error ? <div className="lt-notice p-4 mb-5" role="note"><p className="font-semibold">{t.globalOverview.noObservationTitle}</p><p className="text-sm">{t.globalOverview.noObservationBody}</p></div> : null}

    <section aria-label={t.globalOverview.platformCounts} className="grid sm:grid-cols-3 gap-4 mb-5">
      <Metric icon={Users} label={t.globalOverview.activeOrganizations} value={count(overview.aggregates.activeOrganizations)} />
      <Metric icon={Users} label={t.globalOverview.activeMemberships} value={count(overview.aggregates.activeMemberships)} />
      <Metric icon={ShieldCheck} label={t.globalOverview.platformAdministrators} value={count(overview.aggregates.platformAdministrators)} />
    </section>

    <section className="grid xl:grid-cols-[1.25fr_.75fr] gap-5 mb-5">
      <div className="lt-card p-5"><div className="flex items-center gap-2 mb-4"><ShieldCheck className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} /><h2 className="font-semibold">{t.operations.serviceHealth}</h2></div><div className="grid sm:grid-cols-2 gap-3">{serviceRows.map(([Icon, label, value]) => <HealthRow key={label} icon={Icon} label={label} value={value} text={t.operations.states[value]} />)}<HealthRow icon={AlertTriangle} label={t.operations.automaticFailover} value="unknown" text={t.globalOverview.failoverDisabled} /></div></div>
      <div className="lt-card p-5"><div className="flex items-center gap-2 mb-2"><Database className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} /><h2 className="font-semibold">{t.operations.replicationHealth}</h2></div><p className="text-xs lt-ink-2 mb-4">{overview.standby.observation === "observed" ? t.globalOverview.standbyObserved : t.globalOverview.standbyPending}</p><div className="space-y-3">{backupRows.map(([Icon, label, value, tone]) => <HealthRow key={label} icon={Icon} label={label} value={tone} text={value} />)}<HealthRow icon={AlertTriangle} label={t.operations.automaticFailover} value="unknown" text={t.globalOverview.failoverDisabled} /></div></div>
    </section>

    <section aria-label={t.operations.clientAccess} className="lt-card p-5 mb-5"><div className="flex items-center gap-2 mb-4"><Smartphone className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} /><h2 className="font-semibold">{t.operations.clientAccess}</h2></div><div className="grid sm:grid-cols-3 gap-3">{overview.clientAccess.map((entry) => <div key={entry.client} className="rounded-lg border p-4" style={{ borderColor: "hsl(var(--lt-border))" }}><div className="font-medium">{t.globalOverview.clients[entry.client]}</div><div className="mt-3">{entry.state === "configured" && entry.url ? <a className="lt-chip lt-chip-ok" href={entry.url} target="_blank" rel="noreferrer">{t.globalOverview.clientConfigured}<ExternalLink className="w-3 h-3 ml-1 inline" /></a> : <span className="lt-chip lt-chip-warn">{t.globalOverview.clientPending}</span>}</div></div>)}</div><p className="text-xs lt-ink-2 mt-4">{t.globalOverview.clientNote}</p></section>

    <LemtelTrafficPanel t={t} lang={lang} trend={overview.traffic.trend} loading={loading} unavailable={overview.traffic.observation === "unavailable" || Boolean(error)} />

    <section className="lt-card p-5 mb-5"><div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-5 h-5" style={{ color: "hsl(var(--lt-gold))" }} /><h2 className="font-semibold">{t.operations.troubleshooting}</h2></div><p className="text-sm lt-ink-2">{status.overall === "healthy" ? t.globalOverview.healthyGuidance : t.globalOverview.safeGuidance}</p></section>
  </>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return <div className="lt-card p-5"><div className="flex justify-between gap-3"><span className="text-sm lt-ink-2">{label}</span><Icon className="w-4 h-4" style={{ color: "hsl(var(--lt-cyan))" }} /></div><div className="text-3xl font-semibold tabular-nums mt-3">{value}</div></div>;
}
function HealthRow({ icon: Icon, label, value, text }: { icon: typeof Server; label: string; value: Health; text: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3" style={{ borderColor: "hsl(var(--lt-border))" }}><div className="flex items-center gap-2 min-w-0"><Icon className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--lt-cyan))" }} /><span className="text-sm truncate">{label}</span></div><span className={`lt-chip ${healthClass[value]}`}>{text}</span></div>;
}
