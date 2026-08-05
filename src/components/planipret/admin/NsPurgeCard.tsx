import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Purge des utilisateurs du système téléphonique (NetSapiens).
 * - Orphelins : abonnés NS qui n'existent plus au portail.
 * - Liste : suppression en masse par courriels (portail + NS).
 */
export function NsPurgeCard() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [emails, setEmails] = useState("");

  const call = async (action: string, payload: Record<string, unknown>, label: string) => {
    setBusy(label);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("pp-admin-user", { body: { action, payload } });
    setBusy(null);
    if (error) { setResult(`Erreur : ${error.message}`); return; }
    if (!data?.success) { setResult(`Erreur : ${data?.error ?? "inconnue"}`); return; }
    if (action === "purge_ns_orphans") {
      setResult(
        data.confirm
          ? `Supprimés du système téléphonique : ${data.deleted} (sur ${data.orphans_count} orphelins, ${data.ns_total} abonnés NS).`
          : `Orphelins détectés : ${data.orphans_count} / ${data.ns_total} abonnés NS. Exemples : ${(data.orphans ?? []).slice(0, 8).map((o: any) => o.extension).join(", ")}`,
      );
    } else {
      setResult(
        `Téléphonie : ${data.ns_found} supprimés · Profils : ${data.profiles_deleted} · Comptes : ${data.auth_deleted}`,
      );
    }
  };

  const parsedEmails = emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));

  return (
    <div className="pp-card p-4 space-y-3">
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--pp-text-primary)" }}>
          Purge du système téléphonique
        </div>
        <div style={{ fontSize: 11, color: "var(--pp-text-muted)" }} className="mt-0.5">
          Supprime les extensions et appareils NetSapiens des utilisateurs retirés du portail.
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => call("purge_ns_orphans", { confirm: false }, "scan")}
          disabled={!!busy}
          className="px-3 py-2 rounded-lg text-sm font-medium"
          style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)", opacity: busy ? 0.6 : 1 }}
        >
          {busy === "scan" ? "Analyse…" : "Analyser les orphelins"}
        </button>
        <button
          onClick={() => {
            if (confirm("Supprimer définitivement tous les abonnés NetSapiens absents du portail ?")) {
              void call("purge_ns_orphans", { confirm: true }, "purge");
            }
          }}
          disabled={!!busy}
          className="px-3 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: "#DC2626", opacity: busy ? 0.6 : 1 }}
        >
          {busy === "purge" ? "Suppression…" : "Purger les orphelins"}
        </button>
      </div>

      <div className="space-y-2">
        <textarea
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          rows={3}
          placeholder="Coller des courriels (un par ligne) pour une suppression en masse…"
          className="w-full rounded-lg text-sm px-3 py-2"
          style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-primary)" }}
        />
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{parsedEmails.length} courriel(s)</span>
          <button
            onClick={() => {
              if (parsedEmails.length && confirm(`Supprimer ${parsedEmails.length} utilisateur(s) du portail ET du système téléphonique ?`)) {
                void call("bulk_delete", { emails: parsedEmails }, "bulk");
              }
            }}
            disabled={!!busy || parsedEmails.length === 0}
            className="px-3 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: "#DC2626", opacity: busy || parsedEmails.length === 0 ? 0.5 : 1 }}
          >
            {busy === "bulk" ? "Suppression…" : "Supprimer la liste"}
          </button>
        </div>
      </div>

      {result && (
        <div style={{ fontSize: 12, color: "var(--pp-text-secondary)" }} className="whitespace-pre-wrap">
          {result}
        </div>
      )}
    </div>
  );
}

export default NsPurgeCard;
