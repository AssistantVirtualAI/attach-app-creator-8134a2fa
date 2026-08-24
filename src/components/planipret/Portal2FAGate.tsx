import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ShieldCheck, LogOut, LifeBuoy } from "lucide-react";

type Status = "checking" | "required" | "ok" | "error";

/**
 * Email two-factor gate for the Planiprêt portal.
 * Only email + password sessions of Planiprêt members are challenged;
 * Microsoft sign-ins are exempt (decided server-side).
 * Recovery: one-time backup codes, or an admin reset from the users page.
 */
export default function Portal2FAGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [mode, setMode] = useState<"email" | "backup">("email");
  const [emailMasked, setEmailMasked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [sendsLeft, setSendsLeft] = useState<number | null>(null);
  const startedRef = useRef(false);

  // Cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

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
      if (typeof res?.cooldown_seconds === "number") setCooldown(res.cooldown_seconds);
      if (typeof res?.sends_remaining === "number") setSendsLeft(res.sends_remaining);
      if (!res?.ok) {
        setError(res?.error || "Envoi impossible");
        if (res?.code === "rate_limited" || res?.code === "no_email" || res?.code === "email_failed") setMode("backup");
        return;
      }
      setEmailMasked(res.email_masked ?? null);
      toast.success("Code envoyé par courriel");
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
        setEmailMasked(res?.email_masked ?? null);
        if (typeof res?.cooldown_seconds === "number") setCooldown(res.cooldown_seconds);
        if (typeof res?.sends_remaining === "number") setSendsLeft(res.sends_remaining);
        if (res?.required) {
          setStatus("required");
          if (!res?.has_email) setMode("backup");
          if (!startedRef.current && res?.has_email) { startedRef.current = true; void sendCode(); }
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
        if (res?.code === "locked" || res?.code === "expired") setCode("");
      }
    } catch (e: any) {
      setError(e?.message || "Code incorrect");
    } finally {
      setBusy(false);
    }
  };

  const verifyBackup = async () => {
    const clean = backupCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length < 8) { setError("Entrez un code de secours valide (8 caractères)."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await call("verify_backup", { code: clean });
      if (res?.verified) {
        toast.success(`Code de secours accepté — ${res?.backup_codes_remaining ?? 0} restant(s)`);
        setStatus("ok");
      } else {
        setError(res?.error || "Code de secours invalide");
      }
    } catch (e: any) {
      setError(e?.message || "Code de secours invalide");
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

  const inputStyle = {
    background: "var(--pp-bg-deep)",
    border: "1px solid var(--pp-bg-border-2)",
    color: "var(--pp-text-primary)",
    letterSpacing: "0.4em",
    fontSize: 20,
    textAlign: "center" as const,
  };

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

        {mode === "email" ? (
          <>
            <p style={{ fontSize: 13, color: "var(--pp-text-muted)", marginBottom: 18 }}>
              {emailMasked
                ? `Nous avons envoyé un code à 6 chiffres à ${emailMasked}.`
                : "Nous vous envoyons un code à 6 chiffres par courriel."}
            </p>

            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => { if (e.key === "Enter") void verify(); }}
              inputMode="numeric"
              autoFocus
              placeholder="000000"
              className="w-full rounded-lg px-4 py-3 outline-none mb-3"
              style={inputStyle}
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
                disabled={busy || cooldown > 0 || sendsLeft === 0}
                style={{
                  fontSize: 12,
                  color: cooldown > 0 || sendsLeft === 0 ? "var(--pp-text-faint)" : "var(--pp-text-muted)",
                  textDecoration: "underline",
                  opacity: cooldown > 0 || sendsLeft === 0 ? 0.6 : 1,
                }}
              >
                {sendsLeft === 0
                  ? "Limite de renvois atteinte"
                  : cooldown > 0
                    ? `Renvoyer le code (${cooldown} s)`
                    : "Renvoyer le code"}
              </button>
              {sendsLeft !== null && sendsLeft > 0 && (
                <span style={{ fontSize: 11, color: "var(--pp-text-faint)" }}>{sendsLeft} renvoi(s) restant(s)</span>
              )}
            </div>

            <button
              onClick={() => setShowHelp((v) => !v)}
              className="flex items-center gap-1 mt-3"
              style={{ fontSize: 12, color: "var(--pp-text-muted)" }}
            >
              <MailQuestion size={13} /> Je n'ai pas reçu le courriel
            </button>

            {showHelp && (
              <div
                className="mt-3 rounded-xl p-4"
                style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)" }}
              >
                <p style={{ fontSize: 12, color: "var(--pp-text-muted)", marginBottom: 10 }}>
                  Le courriel peut prendre jusqu'à une minute. Vérifiez aussi vos dossiers
                  « Indésirables » et « Courrier pourriel ».
                </p>
                <p style={{ fontSize: 12, color: "var(--pp-text-primary)", marginBottom: 12 }}>
                  Adresse utilisée : <strong>{emailMasked ?? "inconnue"}</strong>
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void sendCode()}
                    disabled={busy || cooldown > 0 || sendsLeft === 0}
                    className="rounded-lg px-3 py-2"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      background: "var(--pp-brand-accent)",
                      color: "#fff",
                      opacity: busy || cooldown > 0 || sendsLeft === 0 ? 0.55 : 1,
                    }}
                  >
                    {cooldown > 0 ? `Renvoyer (${cooldown} s)` : "Renvoyer"}
                  </button>
                  <button
                    onClick={() => void refreshEmail()}
                    disabled={busy}
                    className="rounded-lg px-3 py-2"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      background: "transparent",
                      border: "1px solid var(--pp-bg-border-2)",
                      color: "var(--pp-text-primary)",
                    }}
                  >
                    Vérifier mon adresse e-mail
                  </button>
                </div>
                {sendsLeft === 0 && (
                  <p style={{ fontSize: 11, color: "#f87171", marginTop: 10 }}>
                    Limite de renvois atteinte (5 par heure). Utilisez un code de secours ou
                    réessayez plus tard.
                  </p>
                )}
                <p style={{ fontSize: 11, color: "var(--pp-text-faint)", marginTop: 10 }}>
                  Si l'adresse est erronée, contactez un administrateur Planiprêt pour la corriger,
                  ou utilisez un code de secours.
                </p>
              </div>
            )}
          </>

        ) : (
          <>
            <p style={{ fontSize: 13, color: "var(--pp-text-muted)", marginBottom: 18 }}>
              Pas accès à votre courriel ? Entrez un de vos codes de secours à usage unique
              (format <span style={{ fontFamily: "monospace" }}>ABCD-1234</span>). Sinon, demandez à un
              administrateur Planiprêt de réinitialiser votre 2FA.
            </p>
            <input
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value.toUpperCase().slice(0, 9))}
              onKeyDown={(e) => { if (e.key === "Enter") void verifyBackup(); }}
              autoFocus
              placeholder="ABCD-1234"
              className="w-full rounded-lg px-4 py-3 outline-none mb-3"
              style={{ ...inputStyle, letterSpacing: "0.2em", fontSize: 18 }}
            />
            {error && <p style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{error}</p>}
            <button
              onClick={() => void verifyBackup()}
              disabled={busy}
              className="w-full rounded-lg py-3 font-semibold flex items-center justify-center gap-2"
              style={{ background: "var(--pp-brand-accent)", color: "#fff", opacity: busy ? 0.7 : 1 }}
            >
              {busy && <Loader2 className="animate-spin" size={16} />} Utiliser ce code de secours
            </button>
          </>
        )}

        <div className="flex items-center justify-between mt-5 pt-4" style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
          <button
            onClick={() => { setError(null); setMode(mode === "email" ? "backup" : "email"); }}
            className="flex items-center gap-1"
            style={{ fontSize: 12, color: "var(--pp-text-muted)" }}
          >
            <LifeBuoy size={13} /> {mode === "email" ? "Je n'ai pas accès à mon courriel" : "Revenir au code par courriel"}
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
