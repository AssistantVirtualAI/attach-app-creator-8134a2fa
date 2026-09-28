import { Megaphone } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import MarketingHistory from "@/components/planipret/marketing/MarketingHistory";

export default function PAMarketing() {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  return (
    <PAPage>
      <PAPageHeader
        icon={<Megaphone className="w-5 h-5" />}
        title={en ? "Marketing — all sends" : "Marketing — tous les envois"}
        subtitle={en ? "Text and email campaigns sent by every broker." : "Campagnes texto et courriel envoyées par tous les courtiers."}
      />
      <MarketingHistory lang={lang} adminView />
    </PAPage>
  );
}
