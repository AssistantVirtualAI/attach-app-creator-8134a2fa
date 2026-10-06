import { useEffect, useMemo, useState } from "react";
import { UserMinus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { toast } from "sonner";

type Row = {
  id: string; batch_label: string; first_name: string | null; last_name: string | null;
  email: string | null; extension: string | null; callerid_number: string | null;
  status: string; error: string | null; executed_at: string | null;
  profile_found: boolean | null; ns_found: boolean | null;
};

const STATUS_LABEL: Record<string, string> = { pending: "En attente", done: "Supprimé", failed: "Échec" };

export default function PAUserRemovals() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "done" | "failed">("all");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const load = async () => {
    const { data } = await supabase.from("planipret_user_removals" as any)
      .select("id,batch_label,first_name,last_name,email,extension,callerid_number,status,error,executed_at,profile_found,ns_found")
      .order("extension", { ascending: true }).limit(1000);
    setRows((data as any) ?? []);
  };
  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter((r) => r.status === "pending").length,
    done: rows.filter((r) => r.status === "done").length,
    failed: rows.filter((r) => r.status === "failed").length,
  }), [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const execute = async () => {
    const todo = rows.filter((r) => r.status === "pending" || r.status === "failed").map((r) => r.id);
    if (todo.length === 0) return;
    const ok = window.confirm(`Supprimer définitivement ${todo.length} comptes du portail, de l'app et du système téléphonique ? Cette action est irréversible. Les numéros (DID) ne sont pas supprimés.`);
    if (!ok) return;
    setRunning(true); setProgress(0);
    try {
      for (let i = 0; i < todo.length; i += 25) {
        const { data, error } = await supabase.functions.invoke("pp-admin-user", {
          body: { action: "removal_execute", payload: { ids: todo.slice(i, i + 25) } },
        });
        if (error || data?.success === false) throw new Error(data?.error || error?.message || "Échec");
        setProgress(Math.min(todo.length, i + 25));
        await load();
      }
      toast.success("Retrait terminé");
    } catch (e: any) {
      toast.error(e?.message ?? "Échec du retrait");
    } finally {
      setRunning(false); await load();
    }
  };

  const cell = { padding: "8px 10px", borderBottom: "1px solid var(--pp-bg-border-2)", fontSize: 13 } as const;

  return (
    <PAPage>
      <PAPageHeader
        icon={<UserMinus className="w-5 h-5" />}
        title="Retraits planifiés"
        subtitle={`${counts.all} comptes · ${counts.pending} en attente · ${counts.done} supprimés · ${counts.failed} échecs`}
        actions={
          <button onClick={execute} disabled={running || counts.pending + counts.failed === 0}
            className="px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ background: "var(--pp-danger, #dc2626)", color: "#fff", opacity: running ? 0.6 : 1 }}>
            {running ? `Suppression… ${progress}/${counts.pending + counts.failed + progress}` : `Exécuter le retrait (${counts.pending + counts.failed})`}
          </button>
        }
      />
      <div className="flex gap-2 mb-3">
        {(["all", "pending", "done", "failed"] as const).map((k) => (
          <button key={k} onClick={() => setFilter(k)} className="px-3 py-1.5 rounded-lg text-sm"
            style={{ background: filter === k ? "var(--pp-bg-border-2)" : "var(--pp-bg-elevated)", color: "var(--pp-text-primary)" }}>
            {k === "all" ? "Tous" : STATUS_LABEL[k]} ({counts[k]})
          </button>
        ))}
      </div>
      <div className="rounded-lg overflow-auto" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)" }}>
        <table className="w-full" style={{ color: "var(--pp-text-primary)" }}>
          <thead><tr style={{ color: "var(--pp-text-muted)", textAlign: "left" }}>
            <th style={cell}>Nom</th><th style={cell}>Courriel</th><th style={cell}>Ext.</th><th style={cell}>Numéro</th>
            <th style={cell}>Statut</th><th style={cell}>Exécuté le</th><th style={cell}>Détail</th>
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td style={cell}>{[r.first_name, r.last_name].filter(Boolean).join(" ")}</td>
                <td style={cell}>{r.email}</td>
                <td style={cell}>{r.extension}</td>
                <td style={cell}>{r.callerid_number}</td>
                <td style={cell}>{STATUS_LABEL[r.status] ?? r.status}</td>
                <td style={cell}>{r.executed_at ? new Date(r.executed_at).toLocaleString("fr-CA") : "—"}</td>
                <td style={cell}>{r.error ?? (r.status === "done" ? `${r.profile_found ? "portail" : "pas de compte portail"} · ${r.ns_found ? "téléphonie" : "absent téléphonie"}` : "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PAPage>
  );
}
