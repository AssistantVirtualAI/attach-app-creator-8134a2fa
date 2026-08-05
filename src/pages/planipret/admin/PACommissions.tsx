import { TrendingUp } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import CommissionDashboard from "@/components/planipret/commissions/CommissionDashboard";

export default function PACommissions() {
  const { lang } = useMplanipretLang();
  return (
    <PAPage>
      <PAPageHeader
        icon={<TrendingUp className="w-5 h-5" />}
        title={lang === "en" ? "Commission statistics" : "Statistiques de commissions"}
        subtitle={lang === "en"
          ? "Global view across all brokers — volume, deals, lenders and commissions"
          : "Vue globale sur tous les courtiers — volume, dossiers, prêteurs et commissions"}
      />
      <CommissionDashboard lang={lang === "en" ? "en" : "fr"} scope="admin" />
    </PAPage>
  );
}
