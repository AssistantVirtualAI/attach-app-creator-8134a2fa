/**
 * Atterrissage du pont « app mobile → portail AVA Statistic ».
 *
 * Conservé pour les anciennes versions de l'app qui ouvrent encore
 * /planipret/portal-handoff : on consomme le lien magique puis on redirige
 * vers la page demandée. Les nouvelles versions ouvrent directement
 * /planipret/broker ou /planipret/admin, où le garde consomme le jeton.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { consumePortalHandoff } from "@/lib/planipret/portalHandoff";
import { Loader2, ShieldAlert } from "lucide-react";

export default function PortalHandoff() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const queryParams = new URLSearchParams(window.location.search);
      const fragmentParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const requestedTarget = queryParams.get("to") ?? fragmentParams.get("to") ?? "/planipret/broker";
      const to = /^\/planipret\/(admin|broker)(\/|$)/.test(requestedTarget)
        ? requestedTarget
        : "/planipret/broker";

      const result = await consumePortalHandoff();

      if (result === "ok") {
        // Full navigation avoids a blank stale shell when iOS resumes the
        // external browser after the one-time session exchange.
        window.location.replace(to);
        return;
      }

      if (result === "none") {
        // Déjà connecté dans ce navigateur : on entre directement.
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) {
          try { sessionStorage.setItem("pp_portal_just_signed_in", String(Date.now())); } catch { /* ignore */ }
          window.location.replace(to);
          return;
        }
        setError("Lien incomplet ou expiré. Relancez l'ouverture depuis l'application mobile.");
        return;
      }

      setError("Connexion au portail impossible (lien invalide). Relancez l'ouverture depuis l'application mobile.");
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
      <div className="max-w-sm w-full text-center space-y-4">
        {error ? (
          <>
            <ShieldAlert className="w-8 h-8 mx-auto text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              onClick={() => navigate("/planipret/broker", { replace: true })}
              className="text-sm underline"
            >
              Ouvrir le portail manuellement
            </button>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Ouverture de votre portail sécurisé…</p>
          </>
        )}
      </div>
    </div>
  );
}
