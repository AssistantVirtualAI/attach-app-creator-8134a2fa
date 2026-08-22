import { useEffect, useState } from "react";
import { TrendingUp, Lock } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import RegisterCommissions from "@/components/planipret/commissions/RegisterCommissions";
import MaestroCommissionsLive from "@/components/planipret/commissions/MaestroCommissionsLive";
import { supabase } from "@/integrations/supabase/client";

/** Only these emails can open the commissions page. */
const COMMISSIONS_ALLOWED_EMAILS = ["mhassoun@assistantvirtualai.com"];

export default function PACommissions() {
  const { lang } = useMplanipretLang();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const email = (user?.email ?? "").toLowerCase();
      if (!cancelled) setAllowed(COMMISSIONS_ALLOWED_EMAILS.includes(email));
    })();
    return () => { cancelled = true; };
  }, []);

  if (allowed === null) {
    return (
      <PAPage>
        <div className="py-16 text-center text-sm text-muted-foreground">…</div>
      </PAPage>
    );
  }

  if (!allowed) {
    return (
      <PAPage>
        <div className="py-20 flex flex-col items-center gap-3 text-center">
          <Lock className="w-8 h-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">
            {lang === "en" ? "Restricted page" : "Page restreinte"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-md">
            {lang === "en"
              ? "Commission statistics are not available for your account."
              : "Les statistiques de commissions ne sont pas accessibles pour votre compte."}
          </p>
        </div>
      </PAPage>
    );
  }

  return (
    <PAPage>
      <PAPageHeader
        icon={<TrendingUp className="w-5 h-5" />}
        title={lang === "en" ? "Commission statistics" : "Statistiques de commissions"}
        subtitle={lang === "en"
          ? "Global view across all brokers — volume, deals, lenders and commissions"
          : "Vue globale sur tous les courtiers — volume, dossiers, prêteurs et commissions"}
      />

      <MaestroCommissionsLive lang={lang === "en" ? "en" : "fr"} scope="admin" />
      <RegisterCommissions lang={lang === "en" ? "en" : "fr"} scope="admin" />
    </PAPage>
  );
}
