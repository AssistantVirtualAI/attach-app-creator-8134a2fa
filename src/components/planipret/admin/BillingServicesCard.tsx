import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoneyPrecise } from "@/lib/planipret/pricing";

type Report = {
  period_start: string;
  plans: Array<{ plan: string; label: string; existing: number; added: number; total: number; unit_price: number; cost: number; revenue: number; margin: number }>;
  services: Array<{ kind: string; label: string; existing: number; added: number; total: number; added_names: string[]; monthly: number; activation: number }>;
  totals: { users: number; users_added: number; plan_cost: number; plan_revenue: number; plan_margin: number; services_monthly: number; activation_one_time: number; monthly_recurring: number; total_billed: number };
};

const th = "py-2 px-2 text-left font-semibold";
const td = "py-2 px-2 tabular-nums";

export default function BillingServicesCard() {
  const [rep, setRep] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase.functions.invoke("pp-billing-monthly", { body: { action: "preview" } });
    if (error || !data?.report) setErr("Impossible de charger la facturation. Réessayez.");
    else setRep(data.report);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const month = rep ? new Date(rep.period_start + "T12:00:00Z").toLocaleDateString("fr-CA", { month: "long", year: "numeric", timeZone: "UTC" }) : "";

  return (
    <div className="pp-card" style={{ padding: 20 }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 style={{ fontWeight: 600, fontSize: 14, color: "var(--pp-text-primary)" }}>Facturation du mois {month && `— ${month}`}</h2>
          <p style={{ fontSize: 11, color: "var(--pp-text-faint)" }} className="mt-0.5">
            Existants vs ajoutés par forfait; files d'attente et IVR NetSapiens : le premier est gratuit, chaque service additionnel 11,99 $/mois (100 $ d'activation une seule fois à l'ajout). Envoyé le 1er du mois.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="pp-btn-ghost flex items-center gap-1 text-xs" aria-label="Actualiser">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Sync NetSapiens
        </button>
      </div>
      {err && <p style={{ fontSize: 12, color: "var(--pp-danger, #E84C4C)" }}>{err}</p>}
      {rep && (
        <div className="space-y-4 overflow-x-auto" style={{ fontSize: 12, color: "var(--pp-text-secondary)" }}>
          <table className="w-full">
            <thead style={{ color: "var(--pp-text-faint)", borderBottom: "1px solid var(--pp-bg-border-2)" }}>
              <tr><th className={th}>Forfait</th><th className={th}>Existants</th><th className={th}>Ajoutés</th><th className={th}>Total</th><th className={th}>Prix</th><th className={th}>Coût</th><th className={th}>Facturé</th><th className={th}>Marge</th></tr>
            </thead>
            <tbody>
              {rep.plans.map((p) => (
                <tr key={p.plan} style={{ borderBottom: "1px solid var(--pp-bg-border-2)" }}>
                  <td className="py-2 px-2" style={{ color: "var(--pp-text-primary)" }}>{p.label}</td>
                  <td className={td}>{p.existing}</td><td className={td}>{p.added}</td><td className={td}>{p.total}</td>
                  <td className={td}>{fmtMoneyPrecise(p.unit_price)}</td><td className={td}>{fmtMoneyPrecise(p.cost)}</td>
                  <td className={td}>{fmtMoneyPrecise(p.revenue)}</td><td className={td}>{fmtMoneyPrecise(p.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full">
            <thead style={{ color: "var(--pp-text-faint)", borderBottom: "1px solid var(--pp-bg-border-2)" }}>
              <tr><th className={th}>Service</th><th className={th}>Existants</th><th className={th}>Ajoutés</th><th className={th}>Total</th><th className={th}>Mensuel</th><th className={th}>Activation</th></tr>
            </thead>
            <tbody>
              {rep.services.map((s) => (
                <tr key={s.kind} style={{ borderBottom: "1px solid var(--pp-bg-border-2)" }}>
                  <td className="py-2 px-2" style={{ color: "var(--pp-text-primary)" }}>
                    {s.label}{s.added_names.length > 0 && <span style={{ color: "var(--pp-text-faint)" }}> — nouveaux : {s.added_names.join(", ")}</span>}
                  </td>
                  <td className={td}>{s.existing}</td><td className={td}>{s.added}</td><td className={td}>{s.total}</td>
                  <td className={td}>{fmtMoneyPrecise(s.monthly)}</td><td className={td}>{fmtMoneyPrecise(s.activation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[["Récurrent mensuel", rep.totals.monthly_recurring], ["Activation (une fois)", rep.totals.activation_one_time], ["Total à facturer", rep.totals.total_billed]].map(([l, v]) => (
              <div key={l as string} className="rounded-lg p-3" style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)" }}>
                <p style={{ fontSize: 11, color: "var(--pp-text-faint)" }}>{l}</p>
                <p className="tabular-nums" style={{ fontSize: 18, fontWeight: 700, color: "var(--pp-text-primary)" }}>{fmtMoneyPrecise(v as number)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
