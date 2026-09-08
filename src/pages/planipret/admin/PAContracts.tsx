import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RefreshCw, FileText, Phone, Sparkles, GraduationCap, CloudUpload, ChevronRight } from "lucide-react";

type TimelineItem = {
  at: string | null;
  kind: "maestro_request" | "call" | "transcript" | "summary" | "coaching" | "maestro_push";
  label: string;
  detail?: string | null;
  ok?: boolean;
};

type Contract = {
  contract_id: string;
  contract_number: string | null;
  broker_profile_id: string;
  broker_name: string | null;
  clients: { id: string; name: string; email: string | null; created: string | null }[];
  status: string;
  last_activity_at: string | null;
  calls_total: number;
  calls_synced: number;
  with_transcript: number;
  with_summary: number;
  with_coaching: number;
  timeline: TimelineItem[];
};

const ICONS: Record<TimelineItem["kind"], any> = {
  maestro_request: FileText,
  call: Phone,
  transcript: FileText,
  summary: Sparkles,
  coaching: GraduationCap,
  maestro_push: CloudUpload,
};

function fmt(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" });
}

export default function PAContracts() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [brokers, setBrokers] = useState<{ id: string; name: string | null }[]>([]);
  const [brokerFilter, setBrokerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("pp-maestro-contracts", {
      body: brokerFilter === "all" ? {} : { broker_profile_id: brokerFilter },
    });
    if (error || !data?.ok) {
      setError("Impossible de charger les contrats Maestro.");
      setContracts([]);
    } else {
      setContracts(data.contracts ?? []);
      if ((data.brokers ?? []).length) setBrokers(data.brokers.map((b: any) => ({ id: b.id, name: b.name })));
    }
    setLoading(false);
  }, [brokerFilter]);

  useEffect(() => { void load(); }, [load]);

  const statuses = useMemo(
    () => Array.from(new Set(contracts.map((c) => c.status))),
    [contracts],
  );

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return contracts.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (fromDate && (c.last_activity_at ?? "") < fromDate) return false;
      if (!s) return true;
      return (
        (c.contract_number ?? "").toLowerCase().includes(s) ||
        c.contract_id.includes(s) ||
        (c.broker_name ?? "").toLowerCase().includes(s) ||
        c.clients.some((cl) => cl.name.toLowerCase().includes(s))
      );
    });
  }, [contracts, statusFilter, fromDate, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Contrats Maestro</h1>
          <p className="text-sm text-muted-foreground">
            Dossiers par agent, avec l'historique complet : demande Maestro, appels remontés, résumé et coaching IA.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Rafraîchir
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 grid gap-3 md:grid-cols-4">
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={brokerFilter}
            onChange={(e) => setBrokerFilter(e.target.value)}
          >
            <option value="all">Tous les agents</option>
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>{b.name ?? b.id}</option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Tous les statuts</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <Input placeholder="Dossier, client ou agent" value={search} onChange={(e) => setSearch(e.target.value)} />
        </CardContent>
      </Card>

      {error && (
        <Card><CardContent className="pt-6 text-sm text-destructive flex items-center justify-between">
          {error}
          <Button size="sm" variant="outline" onClick={() => void load()}>Réessayer</Button>
        </CardContent></Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{rows.length} contrat(s)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {!loading && rows.length === 0 && <p className="text-sm text-muted-foreground">Aucun contrat trouvé.</p>}
          {rows.map((c) => {
            const isOpen = open === c.contract_id;
            return (
              <div key={c.contract_id} className="rounded-lg border">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  onClick={() => setOpen(isOpen ? null : c.contract_id)}
                >
                  <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {c.contract_number ?? `Contrat ${c.contract_id}`}
                      <span className="text-muted-foreground font-normal"> — {c.clients.map((x) => x.name).join(", ") || "client inconnu"}</span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {c.broker_name ?? "—"} · {c.calls_total} appel(s) · {c.calls_synced} dans Maestro · {c.with_summary} résumé(s) · {c.with_coaching} coaching(s) · {fmt(c.last_activity_at)}
                    </div>
                  </div>
                  <Badge variant={c.status === "complet" ? "default" : c.status === "aucun appel" ? "outline" : "secondary"}>
                    {c.status}
                  </Badge>
                </button>
                {isOpen && (
                  <div className="border-t px-4 py-3 space-y-3">
                    {c.timeline.length === 0 && <p className="text-sm text-muted-foreground">Aucune étape.</p>}
                    {c.timeline.map((t, i) => {
                      const Icon = ICONS[t.kind];
                      return (
                        <div key={i} className="flex gap-3">
                          <div className={`mt-0.5 h-7 w-7 shrink-0 rounded-full grid place-items-center ${t.ok === false ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{t.label}</div>
                            <div className="text-xs text-muted-foreground">{fmt(t.at)}</div>
                            {t.detail && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{t.detail}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
