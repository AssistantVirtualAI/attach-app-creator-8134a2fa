import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ShieldAlert, LogOut } from "lucide-react";

/**
 * Hard access lock for the Planiprêt portal.
 * Only accounts with an @planipret email (any planipret domain) may sign in,
 * plus platform super admins. Everyone else is signed out immediately.
 */
export function isPlanipretEmail(email?: string | null) {
  const e = String(email ?? "").trim().toLowerCase();
  const domain = e.split("@")[1] ?? "";
  return domain === "planipret.com" || domain === "planipret.ca" || domain.endsWith(".planipret.com") || domain.endsWith(".planipret.ca");
}

export default function PortalDomainGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "allow" | "blocked">("checking");
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) { setState("allow"); return; } // login screens handle anon state
      const addr = user.email ?? "";
      setEmail(addr);
      if (isPlanipretEmail(addr)) { setState("allow"); return; }
      const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: user.id });
      if (cancelled) return;
      if (isSuper === true) { setState("allow"); return; }
      setState("blocked");
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state === "allow") return <>{children}</>;

  if (state === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pp-bg-base)", color: "var(--pp-text-muted)" }}>
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pp-bg-base)", color: "var(--pp-text-primary)" }}>
      <div className="max-w-md w-full rounded-2xl p-6 text-center" style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)" }}>
        <ShieldAlert size={28} className="mx-auto mb-3" style={{ color: "var(--pp-danger, #ef4444)" }} />
        <h1 className="text-lg font-semibold mb-2">Accès refusé</h1>
        <p className="text-sm mb-4" style={{ color: "var(--pp-text-muted)" }}>
          Le portail Planiprêt est réservé aux comptes @planipret. {email ? `Le compte ${email} n'est pas autorisé.` : ""}
        </p>
        <button
          onClick={() => { window.location.href = "/planipret"; }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
          style={{ background: "var(--pp-accent, #0023e6)", color: "#fff" }}
        >
          <LogOut size={16} /> Retour à la connexion
        </button>
      </div>
    </div>
  );
}
