import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, ShieldAlert, History, PlayCircle, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

type ReleaseResult = {
  e164: string;
  previous_extension: string | null;
  previous_broker_name?: string | null;
  reason?: string;
  released: boolean | null;
  error?: string | null;
};

type ReleaseResponse = {
  success: boolean;
  job_id?: string;
  dry_run: boolean;
  candidates: number;
  released: number;
  failed?: number;
  summary: string;
  results: ReleaseResult[];
};

const DOMAIN = "planipret.ca";

export default function DidReclaimPanel() {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<ReleaseResponse | null>(null);
  const [outcome, setOutcome] = useState<ReleaseResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState<"preview" | "apply" | null>(null);

  const audit = useQuery({
    queryKey: ["pp-did-release-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planipret_did_release_audit")
        .select(
          "id, created_at, phone_number_e164, phone_number, previous_extension, previous_broker_name, reason, dry_run, success, error_message, job_id, triggered_by_email",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const call = async (dryRun: boolean) => {
    const { data, error } = await supabase.functions.invoke("pp-did-assign", {
      body: { action: "release_orphans", domain: DOMAIN, dry_run: dryRun, limit: 500 },
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || "Erreur inattendue");
    return data as ReleaseResponse;
  };

  const runPreview = async () => {
    setRunning("preview");
    setOutcome(null);
    try {
      const res = await call(true);
      setPreview(res);
      if (!res.candidates) toast.success("Aucun numéro orphelin détecté.");
      else setConfirmOpen(true);
    } catch (e: any) {
      toast.error(e?.message || "Échec de la simulation.");
    } finally {
      setRunning(null);
    }
  };

  const runApply = async () => {
    setRunning("apply");
    try {
      const res = await call(false);
      setOutcome(res);
      setPreview(null);
      toast.success(res.summary);
      qc.invalidateQueries({ queryKey: ["pp-did-release-audit"] });
      qc.invalidateQueries({ queryKey: ["pa-phone-numbers"] });
    } catch (e: any) {
      toast.error(e?.message || "Échec de la libération.");
    } finally {
      setRunning(null);
      setConfirmOpen(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="w-4 h-4" /> Libération des DID orphelins
          </CardTitle>
          <CardDescription>
            Détecte les numéros routés vers un poste inexistant ou sans courtier actif, puis les remet en « disponible ».
            Chaque libération est journalisée.
          </CardDescription>
        </div>
        <Button className="gap-2" onClick={runPreview} disabled={running !== null}>
          {running === "preview" ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
          Lancer la libération
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {outcome && (
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="default">{outcome.released} libéré(s)</Badge>
              <Badge variant="secondary">{outcome.candidates} candidat(s)</Badge>
              {!!outcome.failed && <Badge variant="destructive">{outcome.failed} échec(s)</Badge>}
              {outcome.job_id && (
                <span className="text-xs text-muted-foreground">Job {outcome.job_id.slice(0, 8)}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{outcome.summary}</p>
            <ScrollArea className="max-h-48">
              <ul className="text-xs space-y-1">
                {outcome.results.map((r) => (
                  <li key={r.e164} className="flex items-center gap-2">
                    {r.released ? (
                      <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-destructive shrink-0" />
                    )}
                    <span className="font-mono">{r.e164}</span>
                    <span className="text-muted-foreground">
                      {r.previous_extension ? `poste ${r.previous_extension}` : "sans routage"}
                      {r.error ? ` — ${r.error}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-medium">
            <History className="w-4 h-4" /> Journal d'audit (100 dernières entrées)
          </div>
          {audit.isLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
            </div>
          ) : !audit.data?.length ? (
            <p className="text-sm text-muted-foreground">Aucune libération enregistrée pour le moment.</p>
          ) : (
            <ScrollArea className="max-h-72 rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="text-left">
                    <th className="p-2">Date</th>
                    <th className="p-2">DID</th>
                    <th className="p-2">Ancien courtier</th>
                    <th className="p-2">Raison</th>
                    <th className="p-2">Job</th>
                    <th className="p-2">Résultat</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.map((row: any) => (
                    <tr key={row.id} className="border-t">
                      <td className="p-2 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString("fr-CA", { timeZone: "America/Toronto" })}
                      </td>
                      <td className="p-2 font-mono">{row.phone_number_e164 || row.phone_number}</td>
                      <td className="p-2">
                        {row.previous_broker_name || "—"}
                        {row.previous_extension ? ` (${row.previous_extension})` : ""}
                      </td>
                      <td className="p-2">{row.reason}</td>
                      <td className="p-2 font-mono">{String(row.job_id).slice(0, 8)}</td>
                      <td className="p-2">
                        {row.dry_run ? (
                          <Badge variant="outline">Simulation</Badge>
                        ) : row.success ? (
                          <Badge variant="default">Succès</Badge>
                        ) : (
                          <Badge variant="destructive">{row.error_message || "Échec"}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la libération des DID orphelins</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {preview?.candidates ?? 0} numéro(s) seront retirés de leur poste actuel et remis en « disponible »
                  dans le PBX et le portail. Cette action est journalisée.
                </p>
                <ScrollArea className="max-h-40 rounded border p-2">
                  <ul className="text-xs space-y-1">
                    {(preview?.results ?? []).slice(0, 200).map((r) => (
                      <li key={r.e164}>
                        <span className="font-mono">{r.e164}</span>{" "}
                        <span className="text-muted-foreground">
                          — {r.previous_extension ? `poste ${r.previous_extension}` : "sans routage"} · {r.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running === "apply"}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                runApply();
              }}
              disabled={running === "apply"}
            >
              {running === "apply" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Libérer {preview?.candidates ?? 0} numéro(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
