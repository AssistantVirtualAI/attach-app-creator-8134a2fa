import { Megaphone } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import PBMarketing from "@/pages/planipret/broker/PBMarketing";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

/** Vue administrateur : historique de toutes les campagnes marketing des courtiers. */
export default function PAMarketing() {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  return (
    <PAPage>
      <PAPageHeader
        icon={<Megaphone size={18} />}
        title={en ? "Marketing" : "Marketing"}
        subtitle={en
          ? "Every text and email campaign sent by brokers, with delivery and open results."
          : "Toutes les campagnes texto et courriel des courtiers, avec les résultats d'envoi et d'ouverture."}
      />
      <PBMarketing adminAll />
    </PAPage>
  );
}
