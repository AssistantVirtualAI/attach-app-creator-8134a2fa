import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

const MOBILE_HANDOFF_KEY = "pp_portal_from_mobile";

export default function PortalReturnButton() {
  const { lang } = useMplanipretLang();
  const [visible, setVisible] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    try { setVisible(sessionStorage.getItem(MOBILE_HANDOFF_KEY) === "1"); } catch { /* unavailable storage */ }
  }, []);

  if (!visible) return null;

  const returnToApp = () => {
    setFallback(false);
    const isApple = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    window.location.href = isApple ? "planipret-portal-done://close" : "planipret://auth/portal/close";
    window.setTimeout(() => setFallback(true), 1200);
  };

  return (
    <div className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[70] md:hidden">
      <Button type="button" onClick={returnToApp} className="h-11 w-full shadow-lg">
        <ArrowLeft className="h-4 w-4" />
        {lang === "en" ? "Return to the app" : "Retour à l’application"}
      </Button>
      {fallback && (
        <p className="mt-1 rounded-md bg-background px-3 py-2 text-center text-xs text-muted-foreground shadow">
          {lang === "en" ? "If the app did not open, close this page." : "Si l’application ne s’ouvre pas, fermez cette page."}
        </p>
      )}
    </div>
  );
}