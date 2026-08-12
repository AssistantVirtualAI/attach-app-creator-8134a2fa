import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const KEY = (scope: string) => `pp-maestro-commissions-sync:${scope}`;

function relative(iso: string | null, isFr: boolean) {
  if (!iso) return null;
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return isFr ? "à l'instant" : "just now";
  if (min < 60) return isFr ? `il y a ${min} min` : `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return isFr ? `il y a ${h} h` : `${h} h ago`;
  return new Date(iso).toLocaleDateString(isFr ? "fr-CA" : "en-CA");
}

/** Triggers the Maestro commission sync ("all" for admin, "self" for a broker). */
export default function MaestroSyncButton({
  lang,
  scope,
  onDone,
}: {
  lang: "fr" | "en";
  scope: "admin" | "broker";
  onDone?: () => void;
}) {
  const isFr = lang !== "en";
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(() => {
    try { return localStorage.getItem(KEY(scope)); } catch { return null; }
  });

  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("pp-maestro-commissions-sync", {
        body: { mode: scope === "admin" ? "all" : "self" },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      if (error) throw error;
      const res = data as any;
      if (!res?.success) {
        setMsg(
          res?.code === "no_endpoint"
            ? (isFr ? "Endpoint Maestro pas encore disponible — données inchangées." : "Maestro endpoint not available yet — data unchanged.")
            : (res?.error ?? (isFr ? "Synchronisation impossible." : "Sync failed.")),
        );
        return;
      }
      const at = res.synced_at ?? new Date().toISOString();
      setSyncedAt(at);
      try { localStorage.setItem(KEY(scope), at); } catch { /* ignore */ }
      setMsg(isFr
        ? `${res.written ?? 0} ligne(s) · ${res.brokers ?? 1} courtier(s)`
        : `${res.written ?? 0} row(s) · ${res.brokers ?? 1} broker(s)`);
      onDone?.();
    } catch (e: any) {
      setMsg(e?.message ?? (isFr ? "Erreur" : "Error"));
    } finally {
      setBusy(false);
    }
  };

  const rel = relative(syncedAt, isFr);

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        title={isFr ? "Synchroniser les commissions depuis Maestro" : "Sync commissions from Maestro"}
        className="pp-toolbar-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
        style={{
          fontSize: 12, fontWeight: 700, opacity: busy ? 0.6 : 1,
          background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)",
        }}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {isFr ? "Synchroniser Maestro" : "Sync Maestro"}
      </button>
      {(rel || msg) && (
        <span className="truncate" style={{ fontSize: 11, color: "var(--pp-text-muted)", maxWidth: 260 }}>
          {msg ?? (isFr ? `Synchronisé ${rel}` : `Synced ${rel}`)}
        </span>
      )}
    </div>
  );
}
