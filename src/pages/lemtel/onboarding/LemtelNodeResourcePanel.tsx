import { Activity, Cloud, Cpu, Database, HardDrive, MemoryStick, Server, ShieldCheck } from "lucide-react";
import type { Lang, LemtelDict } from "./lemtelI18n";
import type { LemtelNodeStatus, LemtelTrafficNodeRole } from "./lemtelHostedApi";

type Props = {
  t: LemtelDict;
  lang: Lang;
  status: LemtelNodeStatus | null;
  loading: boolean;
  unavailable: boolean;
};

type NodeSignal = "healthy" | "degraded" | "unknown";

const ROLES: LemtelTrafficNodeRole[] = ["do_writer", "hostinger_standby"];

function safeDate(value: string | undefined, lang: Lang) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function health(value: unknown): NodeSignal {
  return value === "healthy" || value === "degraded" ? value : "unknown";
}

function runtimeHealth(value: unknown): NodeSignal {
  return value === "ready" ? "healthy" : value === "degraded" ? "degraded" : "unknown";
}

function resourceTone(value: NodeSignal) {
  return value === "healthy" ? "lt-chip-ok" : value === "degraded" ? "lt-chip-bad" : "lt-chip-warn";
}

function normalizeNodeStatus(value: LemtelNodeStatus | null) {
  if (value?.telemetry !== "live" || !Array.isArray(value.roles)) return null;
  const now = Date.now();
  return value.roles.filter((entry) => {
    if (entry.nodeRole !== "do_writer" && entry.nodeRole !== "hostinger_standby" || typeof entry.observedAt !== "string") return false;
    const observedAt = Date.parse(entry.observedAt);
    return Number.isFinite(observedAt) && observedAt <= now + 120_000 && now - observedAt <= 180_000;
  });
}

/**
 * Renders only a server-authoritative node observation. Hostinger is deliberately
 * held at unknown until a future signed-enrollment contract identifies the source.
 * Existing replication and traffic projections cannot substitute for that proof.
 */
export default function LemtelNodeResourcePanel({ t, lang, status, loading, unavailable }: Props) {
  const text = t.operations.resources;
  const trustedRoles = normalizeNodeStatus(status);
  return <section aria-label={text.title} className="mb-5">
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h2 className="font-semibold text-lg flex items-center gap-2"><Activity className="w-5 h-5" style={{ color: "hsl(var(--lt-cyan))" }} aria-hidden="true" />{text.title}</h2>
        <p className="text-xs lt-ink-2 mt-1">{text.subtitle}</p>
      </div>
      <span className={`lt-chip ${status?.telemetry === "live" && !unavailable ? "lt-chip-cyan" : "lt-chip-warn"}`}>{loading ? text.loading : unavailable ? text.unavailable : text.redacted}</span>
    </div>
    <div className="grid xl:grid-cols-2 gap-5">
      {ROLES.map((nodeRole) => {
        const hostinger = nodeRole === "hostinger_standby";
        // No Hostinger data is displayable under the current projection: it does not certify secure enrollment.
        const entry = hostinger ? undefined : trustedRoles?.find((candidate) => candidate.nodeRole === nodeRole);
        const observed = Boolean(entry?.observedAt && !unavailable);
        const label = hostinger ? text.hostingerUnknown : text.doWriter;
        const Icon = hostinger ? Cloud : Server;
        const signals = observed ? [
          { label: text.signals.publisher, value: health(entry?.agentState), icon: ShieldCheck },
          { label: text.signals.runtime, value: runtimeHealth(entry?.runtimeState), icon: Server },
          { label: text.signals.replication, value: entry?.replicationState === "streaming" ? "healthy" as const : health(entry?.replicationState), icon: Database },
          { label: text.signals.storage, value: entry?.storageState === "synced" ? "healthy" as const : health(entry?.storageState), icon: HardDrive },
        ] : [];
        return <article key={nodeRole} data-node-role={nodeRole} className="lt-card p-5 min-w-0 overflow-hidden" aria-label={label}>
          <div className="flex flex-wrap justify-between gap-3 items-start mb-4">
            <div className="flex items-center gap-3 min-w-0"><span className="rounded-xl p-2" style={{ background: "hsl(var(--lt-cyan) / .10)", color: "hsl(var(--lt-cyan))" }}><Icon className="w-5 h-5" aria-hidden="true" /></span><div><h3 className="font-semibold">{label}</h3><p className="text-[11px] lt-ink-2 mt-0.5">{hostinger ? text.hostingerDetail : observed ? `${text.lastObservation} · ${safeDate(entry?.observedAt, lang)}` : text.noObservation}</p></div></div>
            <span className={`lt-chip ${observed ? "lt-chip-ok" : "lt-chip-warn"}`}>{hostinger ? text.hostingerPending : observed ? text.observed : text.noObservation}</span>
          </div>
          {observed ? <div className="grid sm:grid-cols-2 gap-3 mb-4">{signals.map(({ label: signalLabel, value, icon: SignalIcon }) => <div key={signalLabel} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5" style={{ borderColor: "hsl(var(--lt-border))" }}><span className="text-xs flex items-center gap-2 min-w-0"><SignalIcon className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--lt-cyan))" }} />{signalLabel}</span><span className={`lt-chip ${resourceTone(value)}`}>{text.states[value]}</span></div>)}</div> : <p className="lt-resource-notice text-xs mb-4">{hostinger ? text.hostingerDetail : unavailable ? text.unavailableDetail : text.noObservationDetail}</p>}
          <div className="grid grid-cols-2 gap-3" aria-label={text.resourceMetrics}>
            <ResourceSlot icon={Cpu} label={text.metrics.cpu} detail={text.metrics.unavailable} />
            <ResourceSlot icon={MemoryStick} label={text.metrics.memory} detail={text.metrics.unavailable} />
            <ResourceSlot icon={HardDrive} label={text.metrics.disk} detail={text.metrics.unavailable} />
            <ResourceSlot icon={Activity} label={text.metrics.load} detail={text.metrics.unavailable} />
          </div>
          <p className="text-[11px] lt-ink-2 mt-4">{text.resourceNote}</p>
        </article>;
      })}
    </div>
  </section>;
}

function ResourceSlot({ icon: Icon, label, detail }: { icon: typeof Cpu; label: string; detail: string }) {
  return <div className="lt-resource-slot"><div className="flex items-center gap-2 text-xs lt-ink-2"><Icon className="w-3.5 h-3.5" style={{ color: "hsl(var(--lt-cyan))" }} aria-hidden="true" />{label}</div><div className="text-xl font-semibold mt-2">—</div><p className="text-[10px] lt-ink-2 mt-1">{detail}</p></div>;
}
