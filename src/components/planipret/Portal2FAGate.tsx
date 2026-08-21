import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ShieldCheck, LogOut } from "lucide-react";

type Status = "checking" | "required" | "ok" | "error";

/**
 * SMS two-factor gate for the Planiprêt portal.
 * Only email + password sessions of Planiprêt members are challenged;
 * Microsoft sign-ins are exempt (decided server-side).
 */
export default function Portal2FAGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [code, setCode] = useState("");
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const { data, error: fnErr } = await supabase.functions.invoke("pp-portal-2fa", {
      body: { action, ...payload },
    });
    if (fnErr && !data) throw new Error(fnErr.message || "Erreur de vérification");
    return data as any;
  }, []);

  const sendCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await call("start");
      if (res?.required === false) { setStatus("ok"); return; }
      if (!res?.ok) { setError(res?.error || "Envoi impossible"); return; }
      setPhoneMasked(res.phone_masked ?? null);
      toast.success("Code envoyé par texto");
    } catch (e: any) {
      setError(e?.message || "Envoi impossible");
    } finally {
      setBusy(false);
    }
  }, [call]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await call("status");
        if (cancelled) return;
        setPhoneMasked(res?.phone_masked ?? null);
        if (res?.required) {
          setStatus("required");
          if (!startedRef.current) { startedRef.current = true; void sendCode(); }
        } else {
          setStatus("ok");
        }
      } catch {
        if (!cancelled) setStatus("ok"); // never lock users out on a transient error
      }
    })();
    return () => { cancelled = true; };
  }, [call, sendCode]);

  const verify = async () => {
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6) { setError("Entrez les 6 chiffres du code."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await call("verify", { code: clean });
      if (res?.verified) {
        toast.success("Vérification réussie");
        setStatus("ok");
      } else {
        setError(res?.error || "Code incorrect");
      }
    } catch (e: any) {
      setError(e?.message || "Code incorrect");
    } finally {
      setBusy(false);
    }
  };

  if (status === "ok") return <>{children}</>;

  if (status === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pp-bg-base)", color: "var(--pp-text-muted)" }}>
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "var(--pp-bg-base)", fontFamily: "'Epilogue', sans-serif" }}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl p-8"
        style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)" }}
      >
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck size={22} color="var(--pp-brand-accent)" />
          <h1 style={{ fontWeight: 800, fontSize: 18, color: "var(--pp-text-primary)" }}>
            Vérification en deux étapes
          </h1>
        </div>
        <p style={{ fontSize: 13, color: "var(--pp-text-muted)", marginBottom: 18 }}>
          {phoneMasked
            ? `Nous avons envoyé un code à 6 chiffres au ${phoneMasked}.`
            : "Nous vous envoyons un code à 6 chiffres par texto."}
        </p>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => { if (e.key === "Enter") void verify(); }}
          inputMode="numeric"
          autoFocus
          placeholder="000000"
          className="w-full rounded-lg px-4 py-3 outline-none mb-3"
          style={{
            background: "var(--pp-bg-deep)",
            border: "1px solid var(--pp-bg-border-2)",
            color: "var(--pp-text-primary)",
            letterSpacing: "0.4em",
            fontSize: 20,
            textAlign: "center",
          }}
        />

        {error && <p style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{error}</p>}

        <button
          onClick={() => void verify()}
          disabled={busy}
          className="w-full rounded-lg py-3 font-semibold flex items-center justify-center gap-2"
          style={{ background: "var(--pp-brand-accent)", color: "#fff", opacity: busy ? 0.7 : 1 }}
        >
          {busy && <Loader2 className="animate-spin" size={16} />} Vérifier et continuer
        </button>

        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => void sendCode()}
            disabled={busy}
            style={{ fontSize: 12, color: "var(--pp-text-muted)", textDecoration: "underline" }}
          >
            Renvoyer le code
          </button>
          <button
            onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }}
            className="flex items-center gap-1"
            style={{ fontSize: 12, color: "var(--pp-text-muted)" }}
          >
            <LogOut size={13} /> Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
