import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import BrokerAuthScreen from "@/components/planipret/broker/BrokerAuthScreen";
import { logPortalLogin } from "@/lib/planipret/portalAudit";
import { portalHome, resolvePortalAccess, type PortalKind } from "@/lib/planipret/portalAccess";

const DENY_MESSAGES: Record<string, string> = {
  "not-microsoft": "Ce portail accepte uniquement les connexions Microsoft 365 Planiprêt.",
  domain: "Ce compte Microsoft n'est pas un compte @planipret. Utilisez votre compte professionnel Planiprêt.",
  "wrong-portal": "Votre compte n'a pas accès à ce portail.",
};

/**
 * Strict middleware for /planipret/admin and /planipret/broker.
 * Refuses any access without a valid Microsoft 365 session, logs every
 * attempt (success or failure) and redirects users to the portal matching
 * their Microsoft claims.
 */
export default function PlanipretPortalGuard({ portal, children }: { portal: PortalKind; children: React.ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<"checking" | "anon" | "denied" | "ready">("checking");
  const [reason, setReason] = useState<string>("");
  const [redirect, setRedirect] = useState<string | null>(null);

  /** Vrai pendant ~20 s après un callback Microsoft réussi. */
  const justSignedIn = () => {
    try {
      const ts = Number(sessionStorage.getItem("pp_portal_just_signed_in") ?? 0);
      return Number.isFinite(ts) && Date.now() - ts < 20000;
    } catch { return false; }
  };

  const evaluate = async (attempt = 0) => {
    const access = await resolvePortalAccess();
    if (access.state === "anon") {
      // Premier rendu juste après le callback : la session n'est pas encore
      // hydratée. On patiente au lieu de renvoyer vers l'écran d'auth
      // (source des boucles de redirection).
      if (attempt < 8 && justSignedIn()) {
        setState("checking");
        await new Promise((r) => setTimeout(r, 300));
        return evaluate(attempt + 1);
      }
      setState("anon");
      setReason("");
      return;
    }
    try { sessionStorage.removeItem("pp_portal_just_signed_in"); } catch { /* ignore */ }

    if (access.state === "denied") {
      logPortalLogin({ portal, outcome: "failure", reason: access.reason, path: location.pathname });
      // A non-Microsoft session must never keep a portal page mounted.
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      setReason(access.reason);
      setState("denied");
      return;
    }
    // Un admin peut consulter les deux portails : seul un courtier est renvoyé
    // vers son propre portail s'il tente d'ouvrir l'admin.
    if (access.portal !== portal && !(access.isAdmin && portal === "broker")) {
      logPortalLogin({ portal, outcome: "failure", email: access.email, reason: "wrong-portal", path: location.pathname });
      setRedirect(portalHome(access.portal));
      return;
    }

    logPortalLogin({ portal, outcome: "success", email: access.email, path: location.pathname });
    setState("ready");
  };

  useEffect(() => { void evaluate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [portal]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { setState("anon"); return; }
      if (event === "SIGNED_IN" || event === "USER_UPDATED") void evaluate();
    });
    return () => sub.subscription.unsubscribe();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [portal]);

  if (redirect) return <Navigate to={redirect} replace />;

  if (state === "checking") {
    return (
      <div className="planipret-scope planipret-admin-scope min-h-screen flex items-center justify-center"
        style={{ color: "var(--pp-text-muted)", fontFamily: "'Epilogue', sans-serif" }}>
        Vérification de la session Microsoft…
      </div>
    );
  }

  if (state === "anon" || state === "denied") {
    const base = portal === "admin" ? "/planipret/admin" : "/planipret/broker";
    return (
      <div className="planipret-scope planipret-admin-scope planipret-broker-scope">
        <BrokerAuthScreen
          variant={portal}
          msRedirect={location.pathname.startsWith(base) ? location.pathname : `${base}/overview`}
          initialError={state === "denied" ? (DENY_MESSAGES[reason] ?? "Accès refusé.") : null}
          title={portal === "admin" ? "Connexion administrateur" : undefined}
          subtitle={portal === "admin" ? "Accédez aux appels, commissions, utilisateurs et rapports Planiprêt." : undefined}
        />
      </div>
    );
  }

  return <>{children}</>;
}
