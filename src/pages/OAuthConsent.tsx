import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
};
const oauth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Demande d'autorisation invalide (authorization_id manquant).");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?redirect=" + encodeURIComponent(next);
        return;
      }
      try {
        const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) return setError(error.message);
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) { window.location.href = immediate; return; }
        setDetails(data);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Erreur inconnue");
      }
    })();
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const { data, error } = approve ? await oauth().approveAuthorization(authorizationId) : await oauth().denyAuthorization(authorizationId);
      if (error) { setBusy(false); return setError(error.message); }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) { setBusy(false); return setError("Aucune redirection retournée par le serveur d'autorisation."); }
      window.location.href = target;
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }

  const name = details?.client?.name ?? details?.client?.client_name ?? "une application";
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 space-y-4 text-card-foreground">
        {error ? (
          <p className="text-destructive">Impossible de charger cette demande : {error}</p>
        ) : !details ? (
          <p className="text-muted-foreground">Chargement…</p>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Connecter {name} à votre compte</h1>
            <p className="text-muted-foreground">{name} pourra utiliser vos outils Lemtel UC (contacts, appels, messagerie vocale, clavardage) en votre nom, selon vos permissions.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" disabled={busy} onClick={() => decide(false)}>Refuser</Button>
              <Button disabled={busy} onClick={() => decide(true)}>Autoriser</Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
