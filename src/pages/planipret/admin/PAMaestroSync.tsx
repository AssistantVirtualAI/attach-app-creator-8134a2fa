import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, Activity, Server, Radio } from "lucide-react";

type Status = {
  ok: boolean;
  configured: boolean;
  base_url: string;
  ping: { configured: boolean; base_url: string; ok: boolean; status: number; ms?: number; error?: string };
  stats24h: { total: number; failed: number; success_rate: number | null };
  last_call_mirror: any;
  last_sms_mirror: any;
};

type LogRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  action: string | null;
  maestro_endpoint: string | null;
  response_status: number | null;
  duration_ms: number | null;
  success: boolean | null;
  request_body: any;
  response_body: any;
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400"}`}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {label}
    </span>
  );
}

function fmtAgo(iso?: string | null) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}j`;
}

export default function PAMaestroSync() {
  const [status, setStatus] = useState<Status | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, l] = await Promise.all([
        supabase.functions.invoke("pp-maestro-admin", { body: { action: "status" } }),
        supabase.functions.invoke("pp-maestro-admin", { body: { action: "sync-log", limit: 200, since_hours: 72, only_failures: onlyFailures } }),
      ]);
      if (s.error) throw new Error(s.error.message);
      if (l.error) throw new Error(l.error.message);
      setStatus(s.data as Status);
      setLogs(((l.data as any)?.entries ?? []) as LogRow[]);
    } catch (e: any) {
      setErr(e?.message ?? "erreur");
    } finally {
      setLoading(false);
    }
  }, [onlyFailures]);

  useEffect(() => { void load(); }, [load]);

  const byAction = useMemo(() => {
    const m: Record<string, { total: number; failed: number }> = {};
    for (const r of logs) {
      const k = r.action ?? "unknown";
      const b = m[k] ?? { total: 0, failed: 0 };
      b.total += 1;
      if (!r.success) b.failed += 1;
      m[k] = b;
    }
    return Object.entries(m).sort((a, b) => b[1].total - a[1].total);
  }, [logs]);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Synchronisation Maestro Télécom</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vue globale de tout ce qui est transféré vers Maestro (appels &amp; SMS mirrorés depuis NS-API).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={onlyFailures} onCheckedChange={setOnlyFailures} />
            Échecs seulement
          </label>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Actualiser
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-400">
          {err}
        </div>
      )}

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Server className="h-4 w-4" /> Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusPill ok={!!status?.configured} label={status?.configured ? "Configurée" : "Manquante"} />
            <p className="mt-2 text-xs text-muted-foreground break-all">{status?.base_url || "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Radio className="h-4 w-4" /> Auth &amp; Ping</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusPill ok={!!status?.ping?.ok} label={status?.ping?.ok ? `OK · ${status.ping.status}` : `Erreur · ${status?.ping?.status ?? 0}`} />
            <p className="mt-2 text-xs text-muted-foreground">
              {status?.ping?.ms ? `${status.ping.ms}ms` : ""}{" "}
              {status?.ping?.error ? <span className="text-rose-500">· {status.ping.error}</span> : null}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Activity className="h-4 w-4" /> 24h — Total transféré</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{status?.stats24h?.total ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {status?.stats24h?.failed ?? 0} échec(s) ·{" "}
              {status?.stats24h?.success_rate !== null ? `${status?.stats24h?.success_rate}% réussis` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Dernier miroir</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <div>Appel : <span className="text-muted-foreground">{fmtAgo(status?.last_call_mirror?.created_at)}</span> {status?.last_call_mirror ? <StatusPill ok={!!status.last_call_mirror.success} label={String(status.last_call_mirror.response_status ?? 0)} /> : null}</div>
            <div>SMS : <span className="text-muted-foreground">{fmtAgo(status?.last_sms_mirror?.created_at)}</span> {status?.last_sms_mirror ? <StatusPill ok={!!status.last_sms_mirror.success} label={String(status.last_sms_mirror.response_status ?? 0)} /> : null}</div>
          </CardContent>
        </Card>
      </div>

      {/* Aggregate by action */}
      <Card>
        <CardHeader><CardTitle className="text-base">Répartition par action (72h)</CardTitle></CardHeader>
        <CardContent>
          {byAction.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune activité récente.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {byAction.map(([k, v]) => (
                <Badge key={k} variant={v.failed > 0 ? "destructive" : "secondary"} className="font-mono">
                  {k} · {v.total}{v.failed > 0 ? ` (${v.failed} échec)` : ""}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent log */}
      <Card>
        <CardHeader><CardTitle className="text-base">Journal détaillé ({logs.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2">Quand</th>
                  <th className="text-left px-3 py-2">Action</th>
                  <th className="text-left px-3 py-2">Endpoint</th>
                  <th className="text-right px-3 py-2">HTTP</th>
                  <th className="text-right px-3 py-2">ms</th>
                  <th className="text-left px-3 py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((r) => (
                  <>
                    <tr
                      key={r.id}
                      className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{fmtAgo(r.created_at)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.action ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs truncate max-w-[380px]">{r.maestro_endpoint ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.response_status ?? 0}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{r.duration_ms ?? "—"}</td>
                      <td className="px-3 py-2"><StatusPill ok={!!r.success} label={r.success ? "OK" : "ÉCHEC"} /></td>
                    </tr>
                    {expanded === r.id && (
                      <tr className="bg-muted/20">
                        <td colSpan={6} className="px-3 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            <div>
                              <div className="font-semibold mb-1 text-muted-foreground">Requête</div>
                              <pre className="bg-background border border-border/40 rounded p-2 overflow-x-auto max-h-64">{JSON.stringify(r.request_body ?? {}, null, 2)}</pre>
                            </div>
                            <div>
                              <div className="font-semibold mb-1 text-muted-foreground">Réponse</div>
                              <pre className="bg-background border border-border/40 rounded p-2 overflow-x-auto max-h-64">{JSON.stringify(r.response_body ?? {}, null, 2)}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">Aucune entrée dans le journal.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
