import { useEffect, useState } from "react";
import { TrendingUp, Lock } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import CommissionDashboard from "@/components/planipret/commissions/CommissionDashboard";
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

      <div className="flex flex-wrap gap-1.5 mb-3">
        {([
          ["register", lang === "en" ? "Register 2022+" : "Registre 2022+"],
          ["maestro", "Maestro"],
          ["internal", lang === "en" ? "Internal data" : "Données internes"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSource(key)}
            className="px-3 py-1.5 rounded-lg"
            style={{
              fontSize: 12.5, fontWeight: 700,
              background: source === key ? "var(--pp-brand-accent-2)" : "var(--pp-bg-elevated)",
              color: source === key ? "#fff" : "var(--pp-text-secondary)",
              border: "1px solid var(--pp-bg-border)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {source === "register" ? (
        <RegisterCommissions lang={lang === "en" ? "en" : "fr"} scope="admin" />
      ) : (
        <CommissionDashboard lang={lang === "en" ? "en" : "fr"} scope="admin" source={source} />
      )}
    </PAPage>
  );
}

