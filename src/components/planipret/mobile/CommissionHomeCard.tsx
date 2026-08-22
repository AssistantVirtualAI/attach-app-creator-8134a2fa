// Carte commissions de l'accueil mobile — total du mois courant, visible
// uniquement pour les courtiers et administrateurs.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Wallet, ChevronRight } from "lucide-react";

const cad = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n || 0);

export default function CommissionHomeCard({ profile, lang }: { profile: any; lang?: string }) {
  const fr = lang !== "en";
  const navigate = useNavigate();
  const role = String(profile?.role ?? "");
  const allowed = role === "broker" || role === "admin";
  const [state, setState] = useState<{ total: number; count: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Toronto" }));
    const p = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    (async () => {
      const { data, error } = await supabase.functions.invoke("planipret-commission-reports", {
        body: {
          action: "summary",
          filters: {
            date_from: p(new Date(now.getFullYear(), now.getMonth(), 1)),
            date_to: p(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
            commission_type: "base",
          },
        },
      });
      if (cancelled) return;
      if (error || data?.error || !data?.summary) { setFailed(true); return; }
      setState({ total: data.summary.total_commission, count: data.summary.deposit_count });
    })();
    return () => { cancelled = true; };
  }, [allowed]);

  if (!allowed || failed) return null;

  return (
    <button onClick={() => navigate("/mplanipret/commissions")}
      className="w-full rounded-2xl px-4 py-3.5 flex items-center justify-between text-left"
      style={{ background: "var(--pp-bg-surface, #0A1628)", border: "1px solid var(--pp-bg-border, rgba(155,127,232,0.22))" }}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(155,127,232,0.14)", color: "var(--pp-brand-accent, #9B7FE8)" }}>
          <Wallet className="w-4 h-4" />
        </div>
        <div>
          <div className="text-[13px] font-bold" style={{ color: "var(--pp-text-primary, #E8EDF5)" }}>
            {fr ? "Commissions du mois" : "Commissions this month"}
          </div>
          <div className="text-[12px]" style={{ color: "var(--pp-text-secondary, #B4C6D8)" }}>
            {state ? `${cad(state.total)} · ${state.count} ${fr ? "dépôt(s)" : "deposit(s)"}` : (fr ? "Chargement…" : "Loading…")}
          </div>
        </div>
      </div>
      <ChevronRight className="w-4 h-4" style={{ color: "var(--pp-text-secondary, #B4C6D8)" }} />
    </button>
  );
}
