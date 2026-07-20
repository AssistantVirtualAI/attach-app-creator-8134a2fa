import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ExternalLink, CheckCircle2, AlertTriangle, Clock, XCircle, AlertCircle } from "lucide-react";

type StatusResp = {
  status: "connected" | "pending" | "not_configured" | "disconnected" | "error";
  configured: boolean;
  last_connected_at: string | null;
  expires_in: number | null;
  pending_count: number;
  redirect_uri: string;
  maestro_broker_id?: string | null;
  maestro_email?: string | null;
  last_error: { message: string; at: string | null; http_status?: number } | null;
};

export default function PAMaestroStatus() {
  const [data, setData] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke("maestro-oauth-status");
      if (fnErr) throw fnErr;
      setData(res as StatusResp);
    } catch (e: any) {
      setError(e?.message ?? "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const badge = () => {
    if (!data) return null;
    const map: Record<StatusResp["status"], { label: string; cls: string; Icon: any }> = {
      connected:      { label: "Connecté",       cls: "bg-emerald-600",  Icon: CheckCircle2 },
      pending:        { label: "En attente",     cls: "bg-amber-600",    Icon: Clock },
      not_configured: { label: "Non configuré",  cls: "bg-slate-600",    Icon: AlertTriangle },
      disconnected:   { label: "Déconnecté",     cls: "bg-red-600",      Icon: XCircle },
      error:          { label: "Erreur",         cls: "bg-red-700",      Icon: AlertCircle },
    };
    const m = map[data.status];
    const Icon = m.Icon;
    return <Badge className={`${m.cls} text-white gap-1.5`}><Icon className="h-3.5 w-3.5" />{m.label}</Badge>;
  };

  const retry = async () => {
    if (!data) return;
    setRetrying(true);
    // Clear last error so status refresh reflects a fresh attempt.
    try {
      await supabase.from("planipret_integration_secrets" as any)
        .delete().eq("provider", "maestro_oauth_error");
    } catch { /* ignore */ }
    if (data.authorize_url) {
      window.location.href = data.authorize_url;
      return;
    }
    setRetrying(false);
    window.location.href = "/planipret/admin/integrations";
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Maestro OAuth</h1>
          <p className="text-sm text-muted-foreground">État de la connexion broker Maestro</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Rafraîchir
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Statut</CardTitle>
          {badge()}
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-red-600">{error}</div>}

          {data?.last_error && (
            <div className="p-3 bg-red-500/10 border border-red-500/40 rounded space-y-1">
              <div className="flex items-center gap-2 text-red-700 font-medium">
                <AlertCircle className="h-4 w-4" />
                Dernière erreur d'autorisation
              </div>
              <div className="text-red-700 text-sm break-words">{data.last_error.message}</div>
              <div className="text-xs text-muted-foreground">
                {data.last_error.http_status ? `HTTP ${data.last_error.http_status} · ` : ""}
                {data.last_error.at ? new Date(data.last_error.at).toLocaleString() : ""}
              </div>
            </div>
          )}

          {data && (
            <>
              <Row label="Redirect URI" value={<code className="text-xs break-all">{data.redirect_uri}</code>} />
              <Row label="Endpoints configurés" value={data.configured ? "Oui" : "Non (secrets manquants côté serveur)"} />
              <Row label="Dernière connexion" value={data.last_connected_at ? new Date(data.last_connected_at).toLocaleString() : "—"} />
              <Row label="Codes en attente" value={String(data.pending_count)} />
              {data.expires_in != null && <Row label="Expiration token" value={`${data.expires_in}s`} />}

              <div className="pt-4 flex flex-wrap gap-2">
                <Button onClick={retry} disabled={retrying || (data.status === "not_configured" && !data.authorize_url)}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${retrying ? "animate-spin" : ""}`} />
                  {data.status === "connected" ? "Reconnecter" : "Réessayer la connexion"}
                </Button>
                {data.authorize_url && (
                  <Button variant="outline" asChild>
                    <a href={data.authorize_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" /> Ouvrir dans un nouvel onglet
                    </a>
                  </Button>
                )}
              </div>

              {data.status === "not_configured" && (
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  Les secrets <code>MAESTRO_OAUTH_AUTHORIZE_URL</code>, <code>MAESTRO_OAUTH_TOKEN_URL</code>,{" "}
                  <code>MAESTRO_OAUTH_CLIENT_ID</code> et <code>MAESTRO_OAUTH_CLIENT_SECRET</code> doivent être renseignés côté serveur.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
