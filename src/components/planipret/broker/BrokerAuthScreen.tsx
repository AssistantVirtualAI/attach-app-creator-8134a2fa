import { useState } from "react";
import { toast } from "sonner";
import { Globe, Moon, Sun, ShieldCheck, PhoneCall, BarChart3, Mail, Loader2 } from "lucide-react";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { useMplanipretTheme } from "@/hooks/useMplanipretTheme";
import avaLogoAsset from "@/assets/ava-statistics-logo.png.asset.json";
import planipretLogoAsset from "@/assets/planipret-logo.png.asset.json";
import { startMicrosoftSignIn } from "@/lib/ms365AuthLogin";
import { Ms365PendingBanner } from "@/components/planipret/mobile/Ms365PendingBanner";

/** Desktop-first auth screen for the Planiprêt portals — Microsoft 365 only. */
export default function BrokerAuthScreen({
  onLoggedIn,
  msRedirect = "/planipret/broker/overview",
  title,
  subtitle,
}: {
  onLoggedIn?: () => Promise<void> | void;
  msRedirect?: string;
  title?: string;
  subtitle?: string;
}) {
  const { t, lang, toggle: toggleLang } = useMplanipretLang();
  const { theme, toggle: toggleTheme } = useMplanipretTheme();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);


  const signInWithMicrosoft = async () => {
    setLoading(true);
    try {
      await startMicrosoftSignIn(msRedirect, { loginHint: email.trim() || undefined, prompt: "login" });
    } catch (error: any) {
      toast.error(error?.message || t("auth.msUnavailable"));
    } finally {
      setLoading(false);
    }
  };

  const highlights = [
    {
      icon: PhoneCall,
      fr: "Appels, textos et messagerie vocale centralisés",
      en: "Calls, texts and voicemail in one place",
    },
    {
      icon: BarChart3,
      fr: "Statistiques et commissions en temps réel",
      en: "Real-time stats and commissions",
    },
    {
      icon: Mail,
      fr: "Microsoft 365 : courriels, Teams et calendrier",
      en: "Microsoft 365: email, Teams and calendar",
    },
  ];

  const inputStyle = {
    background: "var(--pp-bg-surface)",
    border: "1px solid var(--pp-bg-border-2)",
    color: "var(--pp-text-primary)",
    fontSize: 14,
  } as const;

  return (
    <div
      className="min-h-screen w-full flex"
      style={{ background: "var(--pp-bg-base)", fontFamily: "'Epilogue', sans-serif" }}
    >
      {/* Left brand panel (desktop only) */}
      <div
        className="hidden lg:flex flex-col justify-between w-[46%] relative overflow-hidden p-12"
        style={{
          background:
            "radial-gradient(1000px 600px at 10% 0%, rgba(46,155,220,0.22), transparent 60%), linear-gradient(160deg, var(--pp-bg-deep), var(--pp-bg-surface))",
          borderRight: "1px solid var(--pp-bg-border)",
        }}
      >
        <div
          className="absolute -bottom-24 -left-24 rounded-full pointer-events-none"
          style={{ width: 420, height: 420, background: "rgba(26,74,138,0.25)", filter: "blur(90px)" }}
        />
        <div className="relative z-10 flex items-center gap-3">
          <img src={avaLogoAsset.url} alt="AVA Statistic" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 10 }} />
          <span style={{ fontFamily: "Urbanist,sans-serif", fontWeight: 800, color: "var(--pp-text-faint)" }}>×</span>
          <img src={planipretLogoAsset.url} alt="Planiprêt" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 10 }} />
        </div>

        <div className="relative z-10">
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontWeight: 700,
              color: "var(--pp-brand-accent)",
            }}
          >
            {lang === "fr" ? "Portail courtier" : "Broker portal"}
          </p>
          <h2
            style={{
              fontFamily: "Urbanist,sans-serif",
              fontWeight: 800,
              fontSize: 38,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: "var(--pp-text-primary)",
              marginTop: 12,
            }}
          >
            {lang === "fr" ? "Toute votre activité, au même endroit." : "All your activity, in one place."}
          </h2>
          <div className="mt-8 space-y-4">
            {highlights.map(({ icon: Icon, fr, en }) => (
              <div key={en} className="flex items-center gap-3">
                <span
                  className="flex items-center justify-center rounded-xl shrink-0"
                  style={{
                    width: 38,
                    height: 38,
                    background: "var(--pp-bg-elevated)",
                    border: "1px solid var(--pp-bg-border-2)",
                    color: "var(--pp-brand-accent)",
                  }}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span style={{ fontSize: 14, color: "var(--pp-text-secondary)" }}>{lang === "fr" ? fr : en}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-2" style={{ color: "var(--pp-text-muted)", fontSize: 12 }}>
          <ShieldCheck className="w-4 h-4" />
          {lang === "fr" ? "Connexion chiffrée · Données isolées par courtier" : "Encrypted sign-in · Per-broker data isolation"}
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-end gap-2 px-6 py-5">
          <button
            onClick={toggleLang}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors"
            style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}
            aria-label={t("header.lang")}
          >
            <Globe className="w-3.5 h-3.5" />
            {lang.toUpperCase()}
          </button>
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center rounded-full"
            style={{ width: 32, height: 32, background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}
            aria-label={t("header.theme")}
          >
            {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 pb-10">
          <div className="w-full max-w-[420px]">
            {/* Mobile logos */}
            <div className="lg:hidden flex items-center justify-center gap-3 mb-6">
              <img src={avaLogoAsset.url} alt="AVA" style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 10 }} />
              <span style={{ fontFamily: "Urbanist,sans-serif", fontWeight: 800, color: "var(--pp-text-faint)" }}>×</span>
              <img src={planipretLogoAsset.url} alt="Planiprêt" style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 10 }} />
            </div>

            <h1
              style={{
                fontFamily: "Urbanist,sans-serif",
                fontWeight: 700,
                fontSize: 26,
                letterSpacing: "-0.02em",
                color: "var(--pp-text-primary)",
              }}
            >
              {lang === "fr" ? "Connexion courtier" : "Broker sign-in"}
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--pp-text-secondary)", marginTop: 6 }}>
              {lang === "fr"
                ? "Accédez à vos appels, clients et statistiques Planiprêt."
                : "Access your Planiprêt calls, clients and statistics."}
            </p>

            <div
              className="mt-7 rounded-2xl"
              style={{
                background: "var(--pp-bg-elevated)",
                border: "1px solid var(--pp-bg-border-2)",
                boxShadow: "0 24px 48px -24px rgba(0,0,0,0.45)",
                padding: 24,
              }}
            >
              <Ms365PendingBanner onRetry={signInWithMicrosoft} />

              <button
                type="button"
                onClick={signInWithMicrosoft}
                disabled={loading}
                className="w-full rounded-xl py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity hover:opacity-90"
                style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-primary)", fontSize: 14 }}
              >
                <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden>
                  <rect x="1" y="1" width="10" height="10" fill="#F25022" />
                  <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
                  <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
                  <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
                </svg>
                {t("auth.signInMs")}
              </button>

              <div className="flex items-center gap-3 my-4" style={{ color: "var(--pp-text-faint)", fontSize: 11 }}>
                <div className="flex-1 h-px" style={{ background: "var(--pp-bg-border)" }} />
                <span className="uppercase tracking-[0.14em]">{t("auth.or")}</span>
                <div className="flex-1 h-px" style={{ background: "var(--pp-bg-border)" }} />
              </div>

              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--pp-text-muted)",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    {t("auth.email")}
                  </label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="email"
                    placeholder={t("auth.emailPh")}
                    className="w-full rounded-xl px-4 py-3 outline-none focus:ring-2"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--pp-text-muted)",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    {t("auth.password")}
                  </label>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    autoComplete="current-password"
                    placeholder={t("auth.passwordPh")}
                    className="w-full rounded-xl px-4 py-3 outline-none focus:ring-2"
                    style={inputStyle}
                  />
                </div>

                {formError && (
                  <div
                    style={{
                      background: "rgba(220,38,38,0.12)",
                      border: "1px solid rgba(220,38,38,0.4)",
                      color: "#F87171",
                      borderRadius: 12,
                      padding: "10px 12px",
                      fontSize: 12.5,
                    }}
                  >
                    {formError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl py-3 font-bold text-white disabled:opacity-60 flex items-center justify-center gap-2 transition-transform hover:-translate-y-[1px]"
                  style={{
                    background: "linear-gradient(135deg, #1A4A8A, #2E9BDC)",
                    boxShadow: "0 10px 28px -8px rgba(46,155,220,0.55)",
                    fontSize: 14,
                  }}
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? t("auth.signingIn") : t("auth.signIn")}
                </button>

                <button
                  type="button"
                  onClick={forgot}
                  className="w-full text-center py-1 text-[12.5px] font-semibold hover:underline"
                  style={{ color: "var(--pp-brand-accent)" }}
                >
                  {t("auth.forgot")}
                </button>
              </form>
            </div>

            <p style={{ fontSize: 11.5, color: "var(--pp-text-muted)", textAlign: "center", marginTop: 18 }}>
              {lang === "fr"
                ? "Accès réservé aux courtiers Planiprêt · Propulsé par AVA Statistic"
                : "Reserved for Planiprêt brokers · Powered by AVA Statistic"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
