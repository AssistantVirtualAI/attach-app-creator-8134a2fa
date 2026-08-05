import { useOutletContext } from "react-router-dom";
import { TrendingUp } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import CommissionDashboard from "@/components/planipret/commissions/CommissionDashboard";
import type { BrokerCtx } from "./PlanipretBrokerLayout";

export default function PBCommissions() {
  const { userId, profile } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  return (
    <PAPage>
      <PAPageHeader
        icon={<TrendingUp className="w-5 h-5" />}
        title={lang === "en" ? "My commissions" : "Mes commissions"}
        subtitle={lang === "en" ? "Your personal performance and commission breakdown" : "Votre performance et la répartition de vos commissions"}
      />
      <CommissionDashboard
        lang={lang === "en" ? "en" : "fr"}
        scope="broker"
        brokerUserId={userId}
        brokerName={(profile as any)?.full_name}
      />
    </PAPage>
  );
}
