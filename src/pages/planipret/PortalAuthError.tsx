import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ShieldAlert, RefreshCw, ArrowRight } from "lucide-react";
import { resolvePortalRedirect } from "@/lib/planipret/portalAccess";
import { startMicrosoftSignIn } from "@/lib/ms365AuthLogin";
import planipretLogo from "@/assets/planipret-logo.png.asset.json";

const REASONS: Record<string, string> = {
  "not-microsoft": "Cette session n'a pas été ouverte avec Microsoft 365.",
  domain: "Ce compte Microsoft n'est pas un compte @planipret.",
  "no-portal": "Nous n'avons pas pu déterminer votre portail (administrateur ou courtier).",
  cancelled: "La connexion Microsoft a été annulée.",
};

export default function PortalAuthError() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(true);
  const reasonKey = params.get("reason") ?? "no-portal";
  const detail = params.get("detail");
  const message = REASONS[reasonKey] ?? "Une erreur est survenue pendant la connexion Microsoft.";

  // Fallback: if a valid Microsoft session actually exists, silently route the
  // user to the portal their claims point to instead of showing the error.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const target = await resolvePortalRedirect("");
      if (cancelled) return;
      if (target) { navigate(target, { replace: true }); return; }
      setBusy(false);
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  if (busy) {
    return (
      <div className="planipret-scope min-h-screen flex items-center justify-center text-sm"
        style={{ color: "var(--pp-text-muted)", fontFamily: "'Epilogue', sans-serif" }}>
        Vérification de votre session Microsoft…
      </div>
    );
  }

  return (
    <div className="planipret-scope planipret-admin-scope min-h-screen flex items-center justify-center p-6"
      style={{ fontFamily: "'Epilogue', sans-serif" }}>
      <div className="pp-card w-full max-w-md text-center" style={{ padding: 28 }}>
        <img src={planipretLogo.url} alt="Planiprêt" className="h-8 mx-auto mb-5 object-contain" />
        <ShieldAlert className="w-9 h-9 mx-auto mb-3" style={{ color: "#ef4444" }} />
        <h1 className="pp-heading" style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
          Connexion impossible
        </h1>
        <p style={{ fontSize: 14, color: "var(--pp-text-muted)", marginBottom: 6 }}>{message}</p>
        {detail && (
          <p style={{ fontSize: 12, color: "var(--pp-text-muted)", opacity: 0.8, marginBottom: 12 }}>{detail}</p>
        )}
        <p style={{ fontSize: 13, color: "var(--pp-text-muted)", marginBottom: 20 }}>
          Réessayez avec votre compte professionnel Planiprêt, ou choisissez votre portail ci-dessous.
        </p>

        <button
          className="pp-btn-primary w-full mb-3 inline-flex items-center justify-center gap-2"
          onClick={() => { void startMicrosoftSignIn("/planipret/admin/overview", { prompt: "select_account" }); }}
        >
          <RefreshCw className="w-4 h-4" /> Réessayer avec Microsoft
        </button>

        <div className="flex gap-2">
          <button className="pp-btn-secondary flex-1 inline-flex items-center justify-center gap-1 text-sm"
            onClick={() => navigate("/planipret/admin", { replace: true })}>
            Portail admin <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button className="pp-btn-secondary flex-1 inline-flex items-center justify-center gap-1 text-sm"
            onClick={() => navigate("/planipret/broker", { replace: true })}>
            Portail courtier <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
