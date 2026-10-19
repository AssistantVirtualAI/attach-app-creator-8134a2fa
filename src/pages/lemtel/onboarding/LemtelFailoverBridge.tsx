// Plan 6.8 — real automatic-failover state and the Cloudflare bridge between the two VPS.
// Data: Edge Function lemtel-failover-status (platform administrators), real signals only; unknown stays unknown.
import { useCallback, useEffect, useState } from "react";
import { Cloud, RefreshCw, Server, ShieldCheck, ShieldOff } from "lucide-react";
import { LemtelError, portalApi, type PortalFailoverStatus } from "./lemtelHostedApi";

type Lang = "fr" | "en";
export type FailoverStatus = PortalFailoverStatus;

// The official logo is never redrawn: drop the file from Cloudflare's brand page in assets/brand/ (see README).
const BRAND = import.meta.glob("./assets/brand/cloudflare-logo.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const CLOUDFLARE_LOGO = Object.values(BRAND)[0] ?? null;

export async function fetchFailoverStatus(): Promise<FailoverStatus | "forbidden" | "unavailable" | "absent"> {
  const api = portalApi as Partial<typeof portalApi>;
  if (typeof api.getFailoverStatus !== "function") return "absent";
  try { return await api.getFailoverStatus(); }
  catch (e) { return e instanceof LemtelError && e.key === "not_allowed" ? "forbidden" : "unavailable"; }
}

const L = (lang: Lang, fr: string, en: string) => (lang === "fr" ? fr : en);

function Node({ lang, name, role, serving, poolHealthy }: { lang: Lang; name: string; role: string; serving: boolean; poolHealthy: boolean | null }) {
  return (
    <div className={`lt-card p-4 text-center ${serving ? "ring-2" : ""}`} style={serving ? { boxShadow: "0 0 0 2px hsl(var(--lt-cyan))" } : undefined} data-testid={`lt-failover-node-${role}`}>
      <Server className="w-6 h-6 mx-auto" />
      <div className="font-semibold mt-2">{name}</div>
      <div className="mt-2 flex flex-wrap justify-center gap-1">
        <span className={`lt-chip ${serving ? "lt-chip-ok" : "lt-chip-cyan"}`}>{serving ? L(lang, "Sert le site", "Serving the site") : L(lang, "En attente", "Standing by")}</span>
        {poolHealthy !== null && <span className={`lt-chip ${poolHealthy ? "lt-chip-ok" : "lt-chip-warn"}`}>{L(lang, "Pool CF", "CF pool")} {poolHealthy ? "OK" : L(lang, "en échec", "failing")}</span>}
      </div>
    </div>
  );
}

export default function LemtelFailoverBridge({ lang }: { lang: Lang }) {
  const [s, setS] = useState<FailoverStatus | "forbidden" | "unavailable" | "absent" | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); setS(await fetchFailoverStatus()); setBusy(false); }, []);
  useEffect(() => { void load(); const t = setInterval(() => { void load(); }, 60_000); return () => clearInterval(t); }, [load]);
  if (s === "forbidden" || s === "absent") return null; // platform administrators only
  const data = typeof s === "object" && s ? s : null;
  const auto = data?.arbiter.automaticFailover ?? "unknown";
  const pool = (role: string) => data?.loadBalancer.pools.find((p) => p.role === role)?.healthy ?? null;
  const serving = data?.routing.servingRole ?? "unknown";
  const autoChip = auto === "on" ? ["lt-chip-ok", L(lang, "Bascule auto : ACTIVE", "Auto failover: ON")] : auto === "off" ? ["lt-chip-warn", L(lang, "Bascule auto : DÉSACTIVÉE", "Auto failover: OFF")] : ["lt-chip-warn", L(lang, "Bascule auto : inconnue", "Auto failover: unknown")];
  return (
    <section className="lt-card p-5 mb-5" aria-labelledby="lt-failover-title" data-testid="lt-failover-bridge">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div><div className="flex items-center gap-2">{auto === "on" ? <ShieldCheck className="w-5 h-5" /> : <ShieldOff className="w-5 h-5" />}<h2 id="lt-failover-title" className="font-semibold">{L(lang, "Bascule automatique et pont Cloudflare", "Automatic failover and Cloudflare bridge")}</h2><span className={`lt-chip ${autoChip[0]}`} data-testid="lt-failover-auto">{autoChip[1]}</span></div>
          <p className="text-xs lt-ink-2 mt-1">{L(lang, "État réel : arbitre Cloudflare, nœud qui sert réellement le site via le Load Balancer, santé des pools. Rien n’est simulé.", "Real state: Cloudflare arbiter, node actually serving the site through the Load Balancer, pool health. Nothing is simulated.")}</p></div>
        <button className="lt-btn lt-btn-ghost" onClick={() => void load()} disabled={busy}><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />{L(lang, "Actualiser la bascule", "Refresh failover")}</button>
      </div>
      {s === "unavailable" && <p className="lt-error mb-3" role="status">{L(lang, "Service d’état de bascule indisponible (non déployé ou injoignable).", "Failover status service unavailable (not deployed or unreachable).")}</p>}
      <div className="grid md:grid-cols-[1fr_1.1fr_1fr] gap-3 items-center">
        <Node lang={lang} name="DigitalOcean" role="do" serving={serving === "do_writer"} poolHealthy={pool("do_writer")} />
        <div className="text-center" data-testid="lt-failover-cloudflare">
          <div className="flex items-center gap-2"><div className="flex-1 h-0.5" style={{ background: "hsl(var(--lt-cyan) / .6)" }} />
            <div className="lt-card px-4 py-3" style={{ borderColor: "#f38020" }}>
              {CLOUDFLARE_LOGO ? <img src={CLOUDFLARE_LOGO} alt="Cloudflare" className="h-7 mx-auto" /> : <Cloud className="w-7 h-7 mx-auto" style={{ color: "#f38020" }} aria-hidden />}
              <div className="text-sm font-semibold mt-1">Cloudflare</div>
              <div className="text-xs lt-ink-2">{L(lang, "Load Balancer + arbitre", "Load Balancer + arbiter")}</div>
            </div><div className="flex-1 h-0.5" style={{ background: "hsl(var(--lt-cyan) / .6)" }} /></div>
          <div className="mt-2 flex flex-wrap justify-center gap-1 text-xs">
            <span className={`lt-chip ${data?.arbiter.reachable ? "lt-chip-ok" : "lt-chip-warn"}`}>{L(lang, "Arbitre", "Arbiter")} : {data?.arbiter.reachable ? (data.arbiter.state ?? "?") : L(lang, "injoignable", "unreachable")}</span>
            <span className={`lt-chip ${serving !== "unknown" ? "lt-chip-ok" : "lt-chip-warn"}`}>{L(lang, "Routage", "Routing")} : {serving === "do_writer" ? "→ DigitalOcean" : serving === "hostinger_writer" ? "→ Hostinger" : L(lang, "inconnu", "unknown")}</span>
            <span className={`lt-chip ${data?.loadBalancer.reachable ? "lt-chip-ok" : "lt-chip-warn"}`}>LB : {!data?.loadBalancer.configured ? L(lang, "jeton lecture non configuré", "read token not configured") : data.loadBalancer.reachable ? L(lang, "pools lus", "pools read") : L(lang, "injoignable", "unreachable")}</span>
          </div>
          {data?.arbiter.reason && data.arbiter.reason !== data.arbiter.state && <div className="text-xs lt-ink-2 mt-1">{data.arbiter.reason.replace(/_/g, " ")}</div>}
        </div>
        <Node lang={lang} name="Hostinger" role="hostinger" serving={serving === "hostinger_writer"} poolHealthy={pool("hostinger_standby")} />
      </div>
      {data && <p className="text-xs lt-ink-2 mt-3">{L(lang, "Vérifié le", "Checked on")} {new Date(data.checkedAt).toLocaleString(lang)}</p>}
    </section>
  );
}
