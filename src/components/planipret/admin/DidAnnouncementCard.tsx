import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Megaphone, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

type Item = {
  phone_number: string;
  extension: string;
  queue: string;
  destination_user: string | null;
  dial_rule_application: string | null;
  announcement: "on" | "off";
  ok?: boolean;
};

/**
 * Annonce d'enregistrement routée par DID : le numéro du courtier pointe vers
 * sa file personnelle (avis en média d'attente). Les appels sortants ne
 * traversent jamais la file, donc aucun avis côté courtier.
 */
export default function DidAnnouncementCard() {
  const [loading, setLoading] = useState<string | null>(null);
  const [ext, setExt] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = async (action: "status" | "enable" | "disable" | "repair_queues" | "diagnose" | "autoheal") => {
    setLoading(action);
    try {
      const body: Record<string, string> = { action };
      if (ext.trim()) body.extension = ext.trim();
      const { data, error } = await supabase.functions.invoke("pp-ns-did-announcement", { body });
      if (error) throw error;
      const res = data as any;
      if (res?.success === false && res?.error) throw new Error(res.error);
      setItems(res.items ?? res.results ?? []);
      setNote(res.note ?? null);
      toast.success(action === "status" ? "État lu" : "Routage DID mis à jour");
    } catch (e: any) {
      toast.error(e?.message ?? "Échec du routage DID");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary" />
          <div>
            <p className="text-sm font-medium">Annonce par DID (entrants seulement)</p>
            <p className="text-xs text-muted-foreground">
              Route le DID du courtier vers sa file personnelle qui joue l'avis d'enregistrement.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={ext}
            onChange={(e) => setExt(e.target.value)}
            placeholder="Extension (vide = tous)"
            className="h-8 w-44 rounded-md border border-border bg-background px-2 text-xs"
          />
          <button
            onClick={() => run("status")}
            disabled={!!loading}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs"
          >
            {loading === "status" && <Loader2 className="h-3 w-3 animate-spin" />}
            État
          </button>
          <button
            onClick={() => run("enable")}
            disabled={!!loading}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs text-primary-foreground"
          >
            {loading === "enable" && <Loader2 className="h-3 w-3 animate-spin" />}
            Activer
          </button>
          <button
            onClick={() => run("repair_queues")}
            disabled={!!loading}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs"
          >
            {loading === "repair_queues" && <Loader2 className="h-3 w-3 animate-spin" />}
            Réparer les files
          </button>
          <button
            onClick={() => run("disable")}
            disabled={!!loading}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs"
          >
            {loading === "disable" && <Loader2 className="h-3 w-3 animate-spin" />}
            Désactiver
          </button>

        </div>
      </div>

      {note && <p className="mt-3 text-xs text-muted-foreground">{note}</p>}

      {items && (
        <div className="mt-3 space-y-1">
          {items.length === 0 && (
            <p className="text-xs text-muted-foreground">Aucun DID assigné trouvé.</p>
          )}
          {items.map((i) => {
            const on = i.announcement === "on" || i.destination_user === i.queue;
            return (
              <div
                key={i.phone_number}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-xs"
              >
                <span className="font-mono">{i.phone_number}</span>
                <span className="text-muted-foreground">ext {i.extension} → {i.destination_user ?? "—"}</span>
                <span className="flex items-center gap-1">
                  {on ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> avis actif
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3.5 w-3.5 text-muted-foreground" /> direct
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
