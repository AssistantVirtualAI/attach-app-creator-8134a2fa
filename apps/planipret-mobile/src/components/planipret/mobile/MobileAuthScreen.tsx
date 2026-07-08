import { FormEvent, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Globe, Moon, Sun } from "lucide-react";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { useMplanipretTheme } from "@/hooks/useMplanipretTheme";

/** Inline logo badges — no network dependency, guaranteed to render on iOS WebView. */
const AvaBadge = ({ size = 56 }: { size?: number }) => (
  <div
    aria-label="AVA Statistic"
    style={{
      width: size, height: size, borderRadius: 16,
      background: "linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%)",
      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize: size * 0.42, letterSpacing: "0.02em",
      fontFamily: "'Urbanist','Epilogue','Inter',system-ui,sans-serif",
      boxShadow: "0 6px 18px rgba(124,58,237,0.35)",
    }}
  >AVA</div>
);
const PlanipretBadge = ({ size = 56 }: { size?: number }) => (
  <div
    aria-label="Planiprêt"
    style={{
      width: size, height: size, borderRadius: 16,
      background: "linear-gradient(135deg,#1A4A8A 0%,#0A1425 100%)",
      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize: size * 0.55,
      fontFamily: "'Urbanist','Epilogue','Inter',system-ui,sans-serif",
      boxShadow: "0 6px 18px rgba(26,74,138,0.4)",
    }}
  >P</div>
);

/**
 * Auth screen for /mplanipret — uses the shared mobile design tokens
 * (.pp-* utilities inside .planipret-mobile-scope) so typography, colors
 * and spacing match every other screen (MHome, MCalls, etc.).
 */
export default function MobileAuthScreen({ onLoggedIn }: { onLoggedIn: () => Promise<void> | void }) {
  const { t, lang, toggle: toggleLang } = useMplanipretLang();
  const { theme, toggle: toggleTheme } = useMplanipretTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLegal, setShowLegal] = useState<null | "tos" | "privacy">(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error(t("auth.missing")); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) { toast.error(error.message || t("auth.failed")); return; }
    toast.success(t("auth.success"));
    void import("@/lib/native/requestPermissionsAfterLogin").then(m => m.requestPermissionsAfterLogin());
    await onLoggedIn();
  };

  const forgot = async () => {
    if (!email) { toast.error(t("auth.email")); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success(lang === "fr" ? "Courriel envoyé" : "Email sent");
  };

  const signInWithMicrosoft = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: `${window.location.origin}/mplanipret`,
        scopes: "email openid profile offline_access User.Read Mail.ReadWrite Calendars.ReadWrite",
      },
    });
    setLoading(false);
    if (error) {
      const msg = /unsupported|not enabled|provider/i.test(error.message)
        ? t("auth.msUnavailable")
        : error.message;
      toast.error(msg);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--pp-bg-elevated)",
    border: "1px solid var(--pp-bg-border)",
    color: "var(--pp-text-primary)",
    fontSize: 14,
    fontFamily: "'Epilogue','Inter',system-ui,sans-serif",
  };

  return (
    <div
      className="w-full flex flex-col"
      style={{
        minHeight: "100vh",
        // @ts-expect-error webkit fallback for iOS
        ["minHeight" as any]: "-webkit-fill-available",
        background: "var(--pp-bg-base, #0A1425)",
        color: "var(--pp-text-primary, #E2E8F0)",
        fontFamily: "'Epilogue','Inter',system-ui,sans-serif",
      }}
    >
      {/* Top control row: lang + theme */}
      <div
        className="flex items-center justify-end gap-2 px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 56px)" }}
      >
        <button
          onClick={toggleLang}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-full pp-eyebrow"
          style={{
            background: "var(--pp-bg-elevated)",
            border: "1px solid var(--pp-bg-border)",
            color: "var(--pp-text-secondary)",
            letterSpacing: "0.08em",
          }}
          aria-label={t("header.lang")}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>{lang.toUpperCase()}</span>
        </button>
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center rounded-full"
          style={{
            width: 30, height: 30,
            background: "var(--pp-bg-elevated)",
            border: "1px solid var(--pp-bg-border)",
            color: "var(--pp-text-secondary)",
          }}
          aria-label={t("header.theme")}
        >
          {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>
      </div>

      {/* Logos + heading */}
      <div className="flex flex-col items-center mt-8 mb-6 px-6">
        <div className="flex items-center gap-3">
          <AvaBadge />
          <span className="pp-heading" style={{ fontWeight: 700, fontSize: 20, color: "var(--pp-text-faint)" }}>×</span>
          <PlanipretBadge />
        </div>
        <h1 className="pp-heading" style={{ fontWeight: 700, fontSize: 22, marginTop: 18 }}>
          {t("auth.welcomeTitle")}
        </h1>
        <p style={{ fontSize: 13, color: "var(--pp-text-secondary)", marginTop: 6, textAlign: "center" }}>
          {t("auth.welcomeSubtitle")}
        </p>
      </div>

      {/* Microsoft SSO (primary) */}
      <div className="px-6 mb-3">
        <button
          type="button"
          onClick={signInWithMicrosoft}
          disabled={loading}
          className="pp-btn-secondary w-full flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ padding: "12px 16px" }}
        >
          <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden>
            <rect x="1" y="1" width="10" height="10" fill="#F25022" />
            <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
            <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
            <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
          </svg>
          {t("auth.signInMs")}
        </button>
        <div className="flex items-center gap-2 my-3" style={{ color: "var(--pp-text-faint)", fontSize: 11 }}>
          <div className="flex-1 h-px" style={{ background: "var(--pp-bg-border)" }} />
          <span className="pp-eyebrow" style={{ letterSpacing: "0.14em" }}>{t("auth.or")}</span>
          <div className="flex-1 h-px" style={{ background: "var(--pp-bg-border)" }} />
        </div>
      </div>

      {/* Email/password */}
      <form onSubmit={submit} className="px-6 space-y-3">
        <div>
          <label className="pp-eyebrow">{t("auth.email")}</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            placeholder={t("auth.emailPh")}
            className="w-full rounded-xl px-4 py-3 outline-none mt-1"
            style={inputStyle}
          />
        </div>
        <div>
          <label className="pp-eyebrow">{t("auth.password")}</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            placeholder={t("auth.passwordPh")}
            className="w-full rounded-xl px-4 py-3 outline-none mt-1"
            style={inputStyle}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="pp-btn-primary w-full disabled:opacity-60"
          style={{ padding: "12px 16px", fontSize: 14 }}
        >
          {loading ? t("auth.signingIn") : t("auth.signIn")}
        </button>
        <button
          type="button"
          onClick={forgot}
          className="w-full text-center py-1"
          style={{ color: "var(--pp-brand-accent)", fontSize: 12, fontWeight: 600 }}
        >
          {t("auth.forgot")}
        </button>
      </form>

      <p style={{ fontSize: 11.5, color: "var(--pp-text-muted)", textAlign: "center", marginTop: 14, padding: "0 24px" }}>
        {t("auth.separate")}
      </p>

      {/* Legal */}
      <p style={{ fontSize: 11, color: "var(--pp-text-faint)", textAlign: "center", marginTop: "auto", padding: "16px 24px 4px" }}>
        {t("legal.agree")}{" "}
        <button onClick={() => setShowLegal("tos")} style={{ color: "var(--pp-brand-accent)", textDecoration: "underline" }}>{t("legal.tos")}</button>{" "}
        {t("legal.and")}{" "}
        <button onClick={() => setShowLegal("privacy")} style={{ color: "var(--pp-brand-accent)", textDecoration: "underline" }}>{t("legal.privacy")}</button>.
      </p>

      {/* Footer */}
      <div className="h-[28px] flex items-center justify-center gap-2 pp-mobile-footer">
        <span className="pp-eyebrow" style={{ fontSize: 9, letterSpacing: "0.14em" }}>{t("footer.poweredBy")}</span>
        <img src={avaLogo.url} alt="AVA" className="w-3.5 h-3.5 rounded object-cover" />
        <span className="pp-eyebrow" style={{ fontSize: 9, color: "var(--pp-brand-accent)", letterSpacing: "0.12em" }}>AVA</span>
        <span style={{ fontSize: 8.5, color: "var(--pp-text-faint)", letterSpacing: "0.1em" }}>· {t("footer.developedBy")}</span>
      </div>

      {showLegal && (
        <div
          className="absolute inset-0 z-40 flex items-end"
          onClick={() => setShowLegal(null)}
          style={{ background: "rgba(0,0,0,0.45)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full p-5 max-h-[70%] overflow-y-auto pp-card"
            style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          >
            <h3 className="pp-heading" style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
              {showLegal === "tos" ? t("legal.tos") : t("legal.privacy")}
            </h3>
            <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--pp-text-secondary)" }}>
              {showLegal === "tos"
                ? (lang === "fr"
                    ? "L'application Planiprêt vous permet de gérer vos appels, messages et leads en toute sécurité. En utilisant l'application, vous acceptez de respecter les conditions d'utilisation d'AVA Statistic. Aucune utilisation frauduleuse n'est tolérée. Vos données restent confidentielles et sont protégées par chiffrement."
                    : "The Planiprêt app lets you securely manage your calls, messages and leads. By using the app you agree to abide by AVA Statistic's terms of use. Fraudulent use is not tolerated. Your data remains confidential and is protected by encryption.")
                : (lang === "fr"
                    ? "Nous collectons uniquement les données nécessaires au fonctionnement de l'application : profil courtier, journal d'appels, messages, transcriptions et préférences. Aucune donnée n'est vendue. Vous pouvez demander la suppression de votre compte à support@avastatistic.ca."
                    : "We collect only the data required to operate the app: broker profile, call logs, messages, transcripts and preferences. No data is ever sold. You can request account deletion at support@avastatistic.ca.")}
            </p>
            <button onClick={() => setShowLegal(null)} className="mt-4 pp-btn-primary inline-block">{t("common.close")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
