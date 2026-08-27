import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, AlertCircle, CheckCircle2, XCircle, Clock, Activity, Zap, Pause, Play, AlertTriangle } from "lucide-react";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { toast } from "sonner";

const DICT = {
  fr: {
    title: "Métriques Maestro",
    subtitle: "Erreurs et taux de retry par endpoint Maestro",
    refresh: "Actualiser",
    timeRange: "Période",
    filterByCall: "Filtrer par call_id",
    filterByDeal: "Filtrer par deal_id",
    clear: "Effacer",
    noData: "Aucune donnée pour cette période",
    loading: "Chargement…",
    endpoint: "Endpoint",
    errors: "Erreurs",
    successes: "Succès",
    total: "Total",
    errorRate: "Taux d'erreur",
    retryRate: "Taux de retry",
    lastError: "Dernière erreur",
    status: "Statut",
    paused: "En pause",
    active: "Actif",
    resume: "Reprendre",
    queue: "File d'attente",
    pending: "En attente",
    done: "Terminés",
    dead: "Échoués",
    processQueue: "Traiter la file",
    circuitBreaker: "Circuit breaker actif",
    correlationId: "Correlation ID",
    step: "Étape",
    httpStatus: "HTTP",
    recentErrors: "Erreurs récentes",
    breakdown: "Répartition par type d'erreur",
    maestro404: "maestro_404",
    maestroPut404: "maestro_put_404",
    maestro500: "maestro_500",
    retries: "Retries",
  },
  en: {
    title: "Maestro Metrics",
    subtitle: "Errors and retry rates per Maestro endpoint",
    refresh: "Refresh",
    timeRange: "Time range",
    filterByCall: "Filter by call_id",
    filterByDeal: "Filter by deal_id",
    clear: "Clear",
    noData: "No data for this period",
    loading: "Loading…",
    endpoint: "Endpoint",
    errors: "Errors",
    successes: "Successes",
    total: "Total",
    errorRate: "Error rate",
    retryRate: "Retry rate",
    lastError: "Last error",
    status: "Status",
    paused: "Paused",
    active: "Active",
    resume: "Resume",
    queue: "Job queue",
    pending: "Pending",
    done: "Done",
    dead: "Dead",
    processQueue: "Process queue",
    circuitBreaker: "Circuit breaker active",
    correlationId: "Correlation ID",
    step: "Step",
    httpStatus: "HTTP",
    recentErrors: "Recent errors",
    breakdown: "Error type breakdown",
    maestro404: "maestro_404",
    maestroPut404: "maestro_put_404",
    maestro500: "maestro_500",
    retries: "Retries",
  },
} as const;

interface LogRow {
  id: string;
  call_id: string | null;
  step: string;
  status: string;
  endpoint: string | null;
  http_status: number | null;
  error_message: string | null;
  correlation_id: string | null;
  created_at: string;
  payload: unknown;
}

interface MetricRow {
  endpoint: string;
  total: number;
  errors: number;
  successes: number;
  retries: number;
}

export default function PAMaestroMetrics() {
  const { lang } = useMplanipretLang();
  const t = DICT[lang];

  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [callFilter, setCallFilter] = useState("");
  const [dealFilter, setDealFilter] = useState("");
  const [hours, setHours] = useState(24);
  const [queueState, setQueueState] = useState<{ state: string; queue: { pending: number; done: number; dead: number }; paused_reason: string | null } | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - hours * 3600_000).toISOString();
      let q = supabase
        .from("planipret_pipeline_logs")
        .select("id, call_id, step, status, endpoint, http_status, error_message, correlation_id, created_at, payload")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000);

      if (callFilter.trim()) q = q.eq("call_id", callFilter.trim());
      if (dealFilter.trim()) {
        // deal_id is in payload; use ilike on payload text
        q = q.ilike("payload::text", `%${dealFilter.trim()}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      setLogs(data ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "fetch_failed");
    } finally {
      setLoading(false);
    }
  }, [hours, callFilter, dealFilter]);

  const fetchQueueState = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("pp-call-queue", {
        body: { action: "status" },
      });
      if (error) throw error;
      setQueueState(data as any);
    } catch {
      // queue function may not be deployed yet
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    fetchQueueState();
  }, [fetchLogs, fetchQueueState]);

  const metrics: MetricRow[] = useMemo(() => {
    const byEndpoint = new Map<string, { total: number; errors: number; successes: number; retries: number }>();
    for (const log of logs) {
      const ep = log.endpoint || log.step || "unknown";
      const m = byEndpoint.get(ep) ?? { total: 0, errors: 0, successes: 0, retries: 0 };
      m.total++;
      if (log.status === "error" || log.status === "skipped") m.errors++;
      if (log.status === "success") m.successes++;
      if (log.status === "skipped" && log.error_message?.includes("retry")) m.retries++;
      // Count 404/500/put_404 in error_message
      if (log.error_message && /404|500|put_404/.test(log.error_message)) m.retries++;
      byEndpoint.set(ep, m);
    }
    return Array.from(byEndpoint.entries()).map(([endpoint, m]) => ({ endpoint, ...m }));
  }, [logs]);

  const errorBreakdown = useMemo(() => {
    const counts = { maestro_404: 0, maestro_put_404: 0, maestro_500: 0, other: 0 };
    for (const log of logs) {
      if (log.status !== "error" && log.status !== "skipped") continue;
      const msg = log.error_message ?? "";
      if (msg.includes("maestro_put_404") || msg.includes("put_404")) counts.maestro_put_404++;
      else if (msg.includes("maestro_404") || msg === "maestro_404" || /404/.test(msg)) counts.maestro_404++;
      else if (msg.includes("maestro_500") || /500/.test(msg)) counts.maestro_500++;
      else counts.other++;
    }
    return counts;
  }, [logs]);

  const recentErrors = useMemo(() => logs.filter((l) => l.status === "error" || l.status === "skipped").slice(0, 20), [logs]);

  const handleProcessQueue = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("pp-call-queue", { body: { action: "process" } });
      if (error) throw error;
      toast.success(`Processed: ${(data as any)?.done ?? 0} done, ${(data as any)?.retried ?? 0} retried`);
      fetchQueueState();
    } catch (e: any) {
      toast.error(e?.message ?? "process_failed");
    }
  };

  const handleResume = async () => {
    try {
      const { error } = await supabase.functions.invoke("pp-call-queue", { body: { action: "resume" } });
      if (error) throw error;
      toast.success(lang === "fr" ? "File reprise" : "Queue resumed");
      fetchQueueState();
    } catch (e: any) {
      toast.error(e?.message ?? "resume_failed");
    }
  };

  const isPaused = queueState?.state === "paused";
  const totalErrors = metrics.reduce((sum, m) => sum + m.errors, 0);
  const totalReq = metrics.reduce((sum, m) => sum + m.total, 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            {t.title}
          </h1>
          <p className="text-muted-foreground text-sm">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="bg-card border rounded-md px-3 py-1.5 text-sm"
          >
            <option value={1}>1h</option>
            <option value={6}>6h</option>
            <option value={24}>24h</option>
            <option value={72}>3j</option>
            <option value={168}>7j</option>
          </select>
          <Button onClick={fetchLogs} disabled={loading} variant="outline" size="sm">
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            {t.refresh}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder={t.filterByCall}
          value={callFilter}
          onChange={(e) => setCallFilter(e.target.value)}
          className="w-56"
          onKeyDown={(e) => e.key === "Enter" && fetchLogs()}
        />
        <Input
          placeholder={t.filterByDeal}
          value={dealFilter}
          onChange={(e) => setDealFilter(e.target.value)}
          className="w-56"
          onKeyDown={(e) => e.key === "Enter" && fetchLogs()}
        />
        <Button variant="ghost" size="sm" onClick={() => { setCallFilter(""); setDealFilter(""); }}>
          {t.clear}
        </Button>
      </div>

      {/* Error type breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className={isPaused ? "border-destructive" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {isPaused ? <Pause className="w-4 h-4 text-destructive" /> : <CheckCircle2 className="w-4 h-4 text-green-500" />}
              {t.status}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isPaused ? t.paused : t.active}</div>
            {isPaused && (
              <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {queueState?.paused_reason ?? t.circuitBreaker}
              </p>
            )}
            {isPaused && (
              <Button onClick={handleResume} variant="outline" size="sm" className="mt-2">
                <Play className="w-3 h-3 mr-1" />
                {t.resume}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" />
              {t.maestro404}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{errorBreakdown.maestro_404}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              {t.maestroPut404}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{errorBreakdown.maestro_put_404}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-500" />
              {t.maestro500}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-500">{errorBreakdown.maestro_500}</div>
          </CardContent>
        </Card>
      </div>

      {/* Queue state */}
      {queueState && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                {t.queue}
              </CardTitle>
              <Button onClick={handleProcessQueue} variant="outline" size="sm">
                <RefreshCw className="w-3 h-3 mr-1" />
                {t.processQueue}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-xl font-bold">{queueState.queue.pending}</div>
                <div className="text-xs text-muted-foreground">{t.pending}</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-green-500">{queueState.queue.done}</div>
                <div className="text-xs text-muted-foreground">{t.done}</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-red-500">{queueState.queue.dead}</div>
                <div className="text-xs text-muted-foreground">{t.dead}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-endpoint metrics table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.endpoint}</CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.noData}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 px-3">{t.endpoint}</th>
                    <th className="py-2 px-3 text-right">{t.total}</th>
                    <th className="py-2 px-3 text-right text-red-500">{t.errors}</th>
                    <th className="py-2 px-3 text-right text-green-500">{t.successes}</th>
                    <th className="py-2 px-3 text-right">{t.errorRate}</th>
                    <th className="py-2 px-3 text-right">{t.retryRate}</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.endpoint} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-3 font-mono text-xs">{m.endpoint}</td>
                      <td className="py-2 px-3 text-right">{m.total}</td>
                      <td className="py-2 px-3 text-right text-red-500">{m.errors}</td>
                      <td className="py-2 px-3 text-right text-green-500">{m.successes}</td>
                      <td className="py-2 px-3 text-right">
                        {m.total > 0 ? ((m.errors / m.total) * 100).toFixed(1) : "0"}%
                      </td>
                      <td className="py-2 px-3 text-right">
                        {m.total > 0 ? ((m.retries / m.total) * 100).toFixed(1) : "0"}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent errors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {t.recentErrors}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentErrors.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.noData}</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {recentErrors.map((log) => (
                <div key={log.id} className="flex items-start gap-3 p-2 rounded-md border text-xs">
                  <Badge variant={log.http_status && log.http_status >= 500 ? "destructive" : "secondary"}>
                    {log.http_status ?? log.status}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono truncate">
                      {log.correlation_id ?? log.call_id?.slice(0, 8) ?? "—"} · {log.step}
                    </div>
                    <div className="text-muted-foreground truncate">
                      {log.endpoint} — {log.error_message}
                    </div>
                  </div>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
