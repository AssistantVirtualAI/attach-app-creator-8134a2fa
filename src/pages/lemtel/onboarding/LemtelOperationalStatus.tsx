import LemtelFailoverBridge from "./LemtelFailoverBridge";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Cloud, Database, HardDrive, RefreshCw, Route, Server, ShieldCheck, Smartphone, WifiOff } from "lucide-react";
import { LemtelError, portalApi, type LemtelDoWriterResources, type LemtelHostingerStandbyResources, type LemtelNodeStatus, type LemtelOperationalStatus, type LemtelOperationalTrendSample, type LemtelTrafficTrend, type PortalConfig } from "./lemtelHostedApi";
import type { LemtelDict, Lang } from "./lemtelI18n";
import LemtelNodeResourcePanel from "./LemtelNodeResourcePanel";
import LemtelTrafficPanel from "./LemtelTrafficPanel";

type Props = { t: LemtelDict; lang: Lang; config: PortalConfig; readonly: boolean };
type Health = LemtelOperationalStatus["overall"];
type ReplicationState = LemtelOperationalStatus["replication"]["database"] | LemtelOperationalStatus["replication"]["storage"];
export const TRAFFIC_READ_DEADLINE_MS = 8_000;

const healthClass: Record<Health, string> = {
  healthy: "lt-chip-ok",
  degraded: "lt-chip-bad",
  unknown: "lt-chip-warn",
};

function safeDate(value: string | undefined, lang: Lang) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusClass(status: "ready" | "not_configured") {
  return status === "ready" ? "lt-chip-ok" : "lt-chip-warn";
}

function replicationHealth(value: ReplicationState): Health {
  if (value === "streaming" || value === "integrity_verified") return "healthy";
  if (value === "sync_attention") return "degraded";
  return "unknown";
}

/** Keeps a non-essential redacted read from blocking the whole Operations view indefinitely. */
function boundedTrafficRead() {
  let timeout: number | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => reject(new Error("traffic_read_deadline")), TRAFFIC_READ_DEADLINE_MS);
  });
  return Promise.race([portalApi.getTrafficTrend(), deadline]).finally(() => {
    if (timeout !== undefined) window.clearTimeout(timeout);
  });
}

const unknownOperationalStatus: LemtelOperationalStatus = {
  telemetry: "not_configured",
  overall: "unknown",
  topology: { writer: "unknown", standby: "unknown", route: "unknown", automaticFailover: false },
  services: { runtime: "unknown", database: "unknown", auth: "unknown", rest: "unknown", storage: "unknown", accountRecovery: "unknown" },
  replication: { database: "unknown", storage: "unknown" },
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function health(value: unknown): Health {
  return value === "healthy" || value === "degraded" ? value : "unknown";
}

/** Safely consumes the redacted server contract, including a partial legacy snapshot. */
export function normalizeOperationalStatus(value: unknown): LemtelOperationalStatus {
  const source = object(value);
  const topology = object(source.topology);
  const services = object(source.services);
  const replication = object(source.replication);
  return {
    telemetry: source.telemetry === "live" ? "live" : "not_configured",
    ...(typeof source.observedAt === "string" ? { observedAt: source.observedAt } : {}),
    overall: health(source.overall),
    topology: {
      writer: topology.writer === "digitalocean_promoted_writer" ? "digitalocean_promoted_writer" : "unknown",
      standby: topology.standby === "hostinger_streaming_standby" || topology.standby === "hostinger_fenced_rebuild_required" ? topology.standby : "unknown",
      route: topology.route === "canonical_digitalocean_live" ? "canonical_digitalocean_live" : "unknown",
      automaticFailover: topology.automaticFailover === true,
    },
    services: {
      runtime: health(services.runtime), database: health(services.database), auth: health(services.auth),
      rest: health(services.rest), storage: health(services.storage), accountRecovery: health(services.accountRecovery),
    },
    replication: {
      database: replication.database === "streaming" || replication.database === "rebuild_required" ? replication.database : "unknown",
      storage: replication.storage === "integrity_verified" || replication.storage === "sync_attention" || replication.storage === "rebuild_required" ? replication.storage : "unknown",
    },
  };
}

export default function LemtelOperationalStatus({ t, lang, config, readonly }: Props) {
  const [data, setData] = useState<LemtelOperationalStatus | null>(null);
  const [trend, setTrend] = useState<LemtelOperationalTrendSample[] | null>(null);
  const [loading, setLoading] = useState(!readonly);
  const [traffic, setTraffic] = useState<LemtelTrafficTrend | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(!readonly);
  const [trafficUnavailable, setTrafficUnavailable] = useState(readonly);
  const [nodeStatus, setNodeStatus] = useState<LemtelNodeStatus | null>(null);
  const [writerResources, setWriterResources] = useState<LemtelDoWriterResources | null>(null);
  const [hostingerResources, setHostingerResources] = useState<LemtelHostingerStandbyResources | null>(null);
  const [nodeStatusLoading, setNodeStatusLoading] = useState(!readonly);
  const [nodeStatusUnavailable, setNodeStatusUnavailable] = useState(readonly);
  const [error, setError] = useState<"not_allowed" | "unavailable" | null>(null);

  const refresh = useCallback(async () => {
    if (readonly) { setData(null); setTraffic(null); setTrafficUnavailable(true); setTrafficLoading(false); setNodeStatus(null); setWriterResources(null); setHostingerResources(null); setNodeStatusUnavailable(true); setNodeStatusLoading(false); setError("unavailable"); setLoading(false); return; }
    setLoading(true); setError(null);
    setTraffic(null); setTrafficLoading(true); setTrafficUnavailable(false);
    setNodeStatus(null); setNodeStatusLoading(true); setNodeStatusUnavailable(false);
    // Failure is not an empty/provisioning result, and health reads never gate traffic reads.
    const trafficRequest = (async () => {
      try { setTraffic(await boundedTrafficRead()); }
      catch { setTraffic(null); setTrafficUnavailable(true); }
      finally { setTrafficLoading(false); }
    })();
    const nodeStatusRequest = (async () => {
      try { setNodeStatus(await portalApi.getNodeStatus()); }
      catch { setNodeStatus(null); setNodeStatusUnavailable(true); }
      finally { setNodeStatusLoading(false); }
    })();
    const writerResourcesRequest = portalApi.getDoWriterResources().then(setWriterResources).catch(() => setWriterResources(null));
    const hostingerResourcesRequest = portalApi.getHostingerStandbyResources().then(setHostingerResources).catch(() => setHostingerResources(null));
    try {
      setData(await portalApi.getOperationalStatus());
      const history = await portalApi.getOperationalTrend().catch(() => ({ samples: [] }));
      setTrend(history.samples);
    } catch (cause) {
      setError(cause instanceof LemtelError && cause.key === "not_allowed" ? "not_allowed" : "unavailable");
    } finally { await Promise.all([trafficRequest, nodeStatusRequest, writerResourcesRequest, hostingerResourcesRequest]); setLoading(false); }
  }, [readonly]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const status = normalizeOperationalStatus(data ?? unknownOperationalStatus);
  const services = status.services;
  const replication = status.replication;
  const sampleCount = trend?.length ?? 0;
  const healthySamples = (trend ?? []).filter((sample) => sample.overall === "healthy").length;
  const clients = [
    { label: t.desktop, href: config.downloads.desktop },
    { label: t.ios, href: config.downloads.ios },
    { label: t.android, href: config.downloads.android },
  ];

  return <>
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div><h1 className="text-2xl font-semibold">{t.operations.title}</h1><p className="lt-ink-2 text-sm mt-1">{t.operations.subtitle}</p></div>
      <button className="lt-btn lt-btn-ghost" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />{t.operations.refresh}</button>
    </div>

    {error === "not_allowed" ? <div className="lt-notice p-4 mb-5" role="note"><p className="font-semibold">{t.operations.accessTitle}</p><p className="text-sm">{t.operations.accessBody}</p></div> : null}
    {error === "unavailable" ? <div className="lt-notice p-4 mb-5" role="note"><p className="font-semibold">{t.operations.unavailableTitle}</p><p className="text-sm">{t.operations.unavailableBody}</p></div> : null}
    {status.telemetry === "not_configured" ? <div className="lt-notice p-4 mb-5" role="note"><p className="font-semibold">{t.operations.pendingTitle}</p><p className="text-sm">{t.operations.pendingBody}</p></div> : null}

    <section aria-label={t.operations.liveHealth} className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
      <StatusCard icon={status.overall === "healthy" ? CheckCircle2 : AlertTriangle} label={t.operations.liveHealth} value={t.operations.states[status.overall]} tone={status.overall} detail={status.telemetry === "live" ? `${t.operations.observedAt}: ${safeDate(status.observedAt, lang)}` : t.operations.noSnapshot} />
      <StatusCard icon={Server} label={t.operations.writer} value={t.operations.topology[status.topology.writer]} tone={services.runtime} detail={t.operations.writerDetail} />
      <StatusCard icon={Cloud} label={t.operations.standby} value={t.operations.topology[status.topology.standby]} tone={replicationHealth(replication.database)} detail={t.operations.replication[replication.database]} />
      <StatusCard icon={Route} label={t.operations.route} value={t.operations.topology[status.topology.route]} tone={services.auth} detail={t.operations.routeDetail} />
    </section>

    <section className="grid xl:grid-cols-[1.4fr_.6fr] gap-5 mb-5" aria-label={lang === "fr" ? "Tendances opérationnelles" : "Operational trends"}>
      <div className="lt-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4"><div><div className="flex items-center gap-2"><Activity className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} /><h2 className="font-semibold">{lang === "fr" ? "Tendance de disponibilité" : "Availability trend"}</h2></div><p className="text-xs lt-ink-2 mt-1">{lang === "fr" ? "Échantillons de santé redigés publiés par le writer, sans adresses ni secrets." : "Redacted health samples published by the writer, without addresses or secrets."}</p></div><span className={`lt-chip ${sampleCount > 0 ? "lt-chip-cyan" : "lt-chip-warn"}`}>{sampleCount} {lang === "fr" ? "échantillon(s)" : "sample(s)"}</span></div>
        <AvailabilityChart samples={trend ?? []} lang={lang} />
      </div>
      <div className="lt-card p-5 space-y-4"><div><div className="text-sm lt-ink-2">{lang === "fr" ? "Santé observée" : "Observed health"}</div><div className="text-3xl font-semibold mt-1">{sampleCount ? `${healthySamples}/${sampleCount}` : "—"}</div><p className="text-xs lt-ink-2 mt-1">{lang === "fr" ? "échantillons sains" : "healthy samples"}</p></div></div>
    </section>

    {!readonly && <LemtelFailoverBridge lang={lang} />}
    <LemtelNodeResourcePanel t={t} lang={lang} status={nodeStatus} writerResources={writerResources} hostingerResources={hostingerResources} loading={nodeStatusLoading} unavailable={nodeStatusUnavailable} />
    <LemtelTrafficPanel t={t} lang={lang} trend={traffic} loading={trafficLoading} unavailable={trafficUnavailable} />

    <section className="grid xl:grid-cols-[1.25fr_.75fr] gap-5">
      <div className="lt-card p-5">
        <div className="flex items-center gap-2 mb-4"><ShieldCheck className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} /><h2 className="font-semibold">{t.operations.serviceHealth}</h2></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <ServiceRow icon={Server} label={t.operations.services.runtime} value={services.runtime} t={t} />
          <ServiceRow icon={Database} label={t.operations.services.database} value={services.database} t={t} />
          <ServiceRow icon={WifiOff} label={t.operations.services.auth} value={services.auth} t={t} />
          <ServiceRow icon={Route} label={t.operations.services.rest} value={services.rest} t={t} />
          <ServiceRow icon={HardDrive} label={t.operations.services.storage} value={services.storage} t={t} />
          <ServiceRow icon={ShieldCheck} label={t.operations.services.accountRecovery} value={services.accountRecovery} t={t} />
          <ServiceRow icon={AlertTriangle} label={t.operations.automaticFailover} value={status.topology.automaticFailover ? "healthy" : "unknown"} t={t} override={status.topology.automaticFailover ? t.operations.enabled : t.operations.disabled} />
        </div>
      </div>

      <div className="lt-card p-5">
        <div className="flex items-center gap-2 mb-4"><Cloud className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} /><h2 className="font-semibold">{t.operations.replicationHealth}</h2></div>
        <div className="space-y-3">
          <SignalRow icon={Database} label={t.operations.databaseReplication} tone={replicationHealth(replication.database)} value={t.operations.replication[replication.database]} />
          <SignalRow icon={HardDrive} label={t.operations.storageReplication} tone={replicationHealth(replication.storage)} value={t.operations.replication[replication.storage]} />
          <SignalRow icon={AlertTriangle} label={t.operations.automaticFailover} tone={status.topology.automaticFailover ? "healthy" : "unknown"} value={status.topology.automaticFailover ? t.operations.enabled : t.operations.disabled} />
        </div>
        <p className="text-xs lt-ink-2 mt-4">{t.operations.replicationNote}</p>
      </div>
    </section>

    <section className="grid xl:grid-cols-[1.25fr_.75fr] gap-5 mt-5">
      <div className="lt-card p-5">
        <div className="flex items-center gap-2 mb-4"><Smartphone className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} /><h2 className="font-semibold">{t.operations.clientAccess}</h2></div>
        <div className="grid sm:grid-cols-3 gap-3">{clients.map((client) => <div key={client.label} className="rounded-lg border px-3 py-3" style={{ borderColor: "hsl(var(--lt-border))" }}><div className="text-sm font-medium mb-2">{client.label}</div>{client.href ? <a className={`lt-chip ${statusClass("ready")}`} href={client.href} target="_blank" rel="noreferrer">{t.operations.linkReady}</a> : <span className={`lt-chip ${statusClass("not_configured")}`}>{t.operations.linkPending}</span>}</div>)}</div>
        <p className="text-xs lt-ink-2 mt-4">{t.operations.clientNote}</p>
      </div>
      <div className="lt-card p-5"><div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-5 h-5" style={{ color: "hsl(var(--lt-gold))" }} /><h2 className="font-semibold">{t.operations.troubleshooting}</h2></div><p className="text-sm lt-ink-2">{status.overall === "healthy" ? t.operations.healthyGuidance : t.operations.safeGuidance}</p></div>
    </section>
  </>;
}

function StatusCard({ icon: Icon, label, value, tone, detail }: { icon: typeof Server; label: string; value: string; tone: Health; detail: string }) {
  return <div className="lt-card p-5"><div className="flex items-center justify-between gap-3"><span className="text-sm lt-ink-2">{label}</span><Icon className="w-4 h-4" style={{ color: "hsl(var(--lt-cyan))" }} /></div><div className="mt-3 text-lg font-semibold truncate">{value}</div><p className="text-xs lt-ink-2 mt-2 min-h-8">{detail}</p><span className={`lt-chip ${healthClass[tone]}`}>{value}</span></div>;
}

function ServiceRow({ icon: Icon, label, value, t, override }: { icon: typeof Server; label: string; value: Health; t: LemtelDict; override?: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3" style={{ borderColor: "hsl(var(--lt-border))" }}><div className="flex items-center gap-2 min-w-0"><Icon className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--lt-cyan))" }} /><span className="text-sm truncate">{label}</span></div><span className={`lt-chip ${healthClass[value]}`}>{override ?? t.operations.states[value]}</span></div>;
}

function SignalRow({ icon: Icon, label, tone, value }: { icon: typeof Server; label: string; tone: Health; value: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3" style={{ borderColor: "hsl(var(--lt-border))" }}><div className="flex items-center gap-2 min-w-0"><Icon className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--lt-cyan))" }} /><span className="text-sm truncate">{label}</span></div><span className={`lt-chip ${healthClass[tone]}`}>{value}</span></div>;
}

function AvailabilityChart({ samples, lang }: { samples: LemtelOperationalTrendSample[]; lang: Lang }) {
  if (samples.length < 2) return <div className="lt-chart-empty">{lang === "fr" ? "La courbe s’affichera après au moins deux relevés vérifiés." : "The line will appear after at least two verified samples."}</div>;
  const width = 560;
  const height = 140;
  const point = (sample: LemtelOperationalTrendSample, index: number) => {
    const x = 16 + (index * (width - 32)) / (samples.length - 1);
    const y = sample.overall === "healthy" ? 28 : sample.overall === "degraded" ? 74 : 116;
    return `${x},${y}`;
  };
  return <div className="lt-chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={lang === "fr" ? "Tendance de disponibilité Lemtel" : "Lemtel availability trend"} className="w-full h-auto"><path d={`M 16 28 H ${width - 16} M 16 74 H ${width - 16} M 16 116 H ${width - 16}`} className="lt-chart-grid" /><polyline points={samples.map(point).join(" ")} fill="none" className="lt-chart-line" />{samples.map((sample, index) => { const [x, y] = point(sample, index).split(","); return <circle key={`${sample.observedAt ?? index}-${index}`} cx={x} cy={y} r="4" className={`lt-chart-point lt-chart-point-${sample.overall}`}><title>{`${safeDate(sample.observedAt, lang)} · ${sample.overall}`}</title></circle>; })}</svg><div className="flex justify-between text-[11px] lt-ink-2 mt-1"><span>{safeDate(samples[0]?.observedAt, lang)}</span><span>{safeDate(samples[samples.length - 1]?.observedAt, lang)}</span></div></div>;
}
