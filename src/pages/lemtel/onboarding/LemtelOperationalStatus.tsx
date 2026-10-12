import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Cloud, Database, HardDrive, RefreshCw, Route, Server, ShieldCheck, Smartphone, WifiOff } from "lucide-react";
import { LemtelError, portalApi, type LemtelOperationalStatus, type PortalConfig } from "./lemtelHostedApi";
import type { LemtelDict, Lang } from "./lemtelI18n";

type Props = { t: LemtelDict; lang: Lang; config: PortalConfig; readonly: boolean };
type Health = LemtelOperationalStatus["overall"];
type ReplicationState = LemtelOperationalStatus["replication"]["database"] | LemtelOperationalStatus["replication"]["storage"];

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

export default function LemtelOperationalStatus({ t, lang, config, readonly }: Props) {
  const [data, setData] = useState<LemtelOperationalStatus | null>(null);
  const [loading, setLoading] = useState(!readonly);
  const [error, setError] = useState<"not_allowed" | "unavailable" | null>(null);

  const refresh = useCallback(async () => {
    if (readonly) { setData(null); setError("unavailable"); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      setData(await portalApi.getOperationalStatus());
    } catch (cause) {
      setError(cause instanceof LemtelError && cause.key === "not_allowed" ? "not_allowed" : "unavailable");
    } finally { setLoading(false); }
  }, [readonly]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const services = data?.services ?? { runtime: "unknown", database: "unknown", auth: "unknown", rest: "unknown", storage: "unknown" };
  const replication = data?.replication ?? { database: "unknown", storage: "unknown" };
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
    {data?.telemetry === "not_configured" ? <div className="lt-notice p-4 mb-5" role="note"><p className="font-semibold">{t.operations.pendingTitle}</p><p className="text-sm">{t.operations.pendingBody}</p></div> : null}

    <section aria-label={t.operations.liveHealth} className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
      <StatusCard icon={data?.overall === "healthy" ? CheckCircle2 : AlertTriangle} label={t.operations.liveHealth} value={data ? t.operations.states[data.overall] : t.operations.states.unknown} tone={data?.overall ?? "unknown"} detail={data?.telemetry === "live" ? `${t.operations.observedAt}: ${safeDate(data.observedAt, lang)}` : t.operations.noSnapshot} />
      <StatusCard icon={Server} label={t.operations.writer} value={data?.topology.writer ? t.operations.topology[data.topology.writer] : "—"} tone={services.runtime} detail={t.operations.writerDetail} />
      <StatusCard icon={Cloud} label={t.operations.standby} value={data?.topology.standby ? t.operations.topology[data.topology.standby] : "—"} tone={replicationHealth(replication.database)} detail={t.operations.replication[replication.database]} />
      <StatusCard icon={Route} label={t.operations.route} value={data?.topology.route ? t.operations.topology[data.topology.route] : "—"} tone={services.auth} detail={t.operations.routeDetail} />
    </section>

    <section className="grid xl:grid-cols-[1.25fr_.75fr] gap-5">
      <div className="lt-card p-5">
        <div className="flex items-center gap-2 mb-4"><ShieldCheck className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} /><h2 className="font-semibold">{t.operations.serviceHealth}</h2></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <ServiceRow icon={Server} label={t.operations.services.runtime} value={services.runtime} t={t} />
          <ServiceRow icon={Database} label={t.operations.services.database} value={services.database} t={t} />
          <ServiceRow icon={WifiOff} label={t.operations.services.auth} value={services.auth} t={t} />
          <ServiceRow icon={Route} label={t.operations.services.rest} value={services.rest} t={t} />
          <ServiceRow icon={HardDrive} label={t.operations.services.storage} value={services.storage} t={t} />
          <ServiceRow icon={AlertTriangle} label={t.operations.automaticFailover} value={data?.topology.automaticFailover ? "healthy" : "unknown"} t={t} override={data?.topology.automaticFailover ? t.operations.enabled : t.operations.disabled} />
        </div>
      </div>

      <div className="lt-card p-5">
        <div className="flex items-center gap-2 mb-4"><Cloud className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} /><h2 className="font-semibold">{t.operations.replicationHealth}</h2></div>
        <div className="space-y-3">
          <SignalRow icon={Database} label={t.operations.databaseReplication} tone={replicationHealth(replication.database)} value={t.operations.replication[replication.database]} />
          <SignalRow icon={HardDrive} label={t.operations.storageReplication} tone={replicationHealth(replication.storage)} value={t.operations.replication[replication.storage]} />
          <SignalRow icon={AlertTriangle} label={t.operations.automaticFailover} tone={data?.topology.automaticFailover ? "healthy" : "unknown"} value={data?.topology.automaticFailover ? t.operations.enabled : t.operations.disabled} />
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
      <div className="lt-card p-5"><div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-5 h-5" style={{ color: "hsl(var(--lt-gold))" }} /><h2 className="font-semibold">{t.operations.troubleshooting}</h2></div><p className="text-sm lt-ink-2">{data?.overall === "healthy" ? t.operations.healthyGuidance : t.operations.safeGuidance}</p></div>
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
