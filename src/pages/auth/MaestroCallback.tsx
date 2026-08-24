import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";

// Module-level dedupe: prevents double-exchange when the deep link is
// delivered via both launchUrl and appUrlOpen (cold start).
const inflightCodes = new Set<string>();
const completedCodes = new Set<string>();
// Guard remounts (iOS re-fires appUrlOpen after Browser.close) so
// navigate({replace:true}) doesn't spam history.replaceState.
let navigatedAway = false;

export default function MaestroCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ran = useRef(false);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState<string>("Traitement de l'autorisation Maestro…");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [deepLink, setDeepLink] = useState<string | null>(null);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const errorDesc = params.get("error_description");

    if (error) {
      setStatus("error");
      setMessage(errorDesc || error);
      setDetails({ error, state: state ?? "—" });
      return;
    }
    if (!code) {
      if (!navigatedAway) { navigatedAway = true; navigate("/", { replace: true }); }
      return;
    }

    if (completedCodes.has(code) || inflightCodes.has(code)) {
      setStatus("ok");
      setMessage("Autorisation déjà traitée.");
      return;
    }
    inflightCodes.add(code);

    (async () => {
      try {
        const isNative = Capacitor.isNativePlatform();

        // Le flux a-t-il été démarré depuis l'application mobile ? Maestro
        // ne connaît que le callback https, donc on renvoie le code à l'app
        // via le deep link planipret:// au lieu d'afficher cette page.
        if (!isNative && state) {
          try {
            const { data: info } = await supabase.functions.invoke("maestro-oauth-state-info", {
              body: { state },
            });
            if ((info as any)?.platform === "mobile") {
              const deepLink = `planipret://auth/maestro/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
              setStatus("ok");
              setMessage("Retour à l'application Planiprêt…");
              setDeepLink(deepLink);
              inflightCodes.delete(code);
              window.location.href = deepLink;
              return;
            }
          } catch { /* on continue en mode web */ }
        }
        const redirect_uri = isNative
          ? "planipret://auth/maestro/callback"
          : `${window.location.origin}/auth/maestro/callback`;
        const { data, error: fnErr } = await supabase.functions.invoke("maestro-oauth-callback", {
          body: { code, state, redirect_uri },
        });
        if (fnErr || !(data as any)?.success) {
          setStatus("error");
          setMessage((data as any)?.error ?? fnErr?.message ?? "Échec de l'échange du code.");
          return;
        }
        completedCodes.add(code);
        try { window.dispatchEvent(new Event("maestro:connected")); } catch { /* ignore */ }
        try { localStorage.setItem("pp_maestro_just_connected", String(Date.now())); } catch { /* ignore */ }
        setStatus("ok");
        setMessage("Compte Maestro connecté avec succès. Redirection…");
        let returnTo = "/planipret/broker";
        try {
          const saved = localStorage.getItem("pp_maestro_return_to");
          if (saved && saved.startsWith("/") && !saved.startsWith("//") && !saved.includes("/auth/maestro/callback")) {
            returnTo = saved;
          }
          localStorage.removeItem("pp_maestro_return_to");
        } catch { /* ignore */ }
        window.setTimeout(() => { if (!navigatedAway) { navigatedAway = true; navigate(returnTo, { replace: true }); } }, 400);
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message ?? "Erreur inconnue");
      } finally {
        inflightCodes.delete(code);
      }
    })();
  }, [params, navigate]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b1220", color: "#e5e7eb", padding: 24 }}>
      <div style={{ maxWidth: 480, width: "100%", background: "#111a2e", border: "1px solid #1f2a44", borderRadius: 16, padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: status === "ok" ? "#059669" : status === "error" ? "#dc2626" : "#2563eb",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
          }}>
            {status === "ok" ? "✓" : status === "error" ? "!" : "…"}
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.6, letterSpacing: 1 }}>MAESTRO OAUTH</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Autorisation broker</div>
          </div>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.9 }}>{message}</p>
        {deepLink && (
          <a href={deepLink} style={{ display: "inline-block", marginTop: 16, padding: "10px 16px", borderRadius: 10, background: "#2563eb", color: "#fff", fontSize: 14, textDecoration: "none" }}>
            Ouvrir l'application Planiprêt
          </a>
        )}
        {status === "error" && Object.keys(details).length > 0 && (
          <pre style={{ marginTop: 16, padding: 12, background: "#0b1220", border: "1px solid #1f2a44", borderRadius: 8, fontSize: 11, overflow: "auto" }}>
            {JSON.stringify(details, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
