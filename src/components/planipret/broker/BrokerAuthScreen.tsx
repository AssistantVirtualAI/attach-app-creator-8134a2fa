import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Globe, Moon, Sun, ShieldCheck, PhoneCall, BarChart3, Mail, Loader2 } from "lucide-react";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { useMplanipretTheme } from "@/hooks/useMplanipretTheme";
import avaLogoAsset from "@/assets/ava-statistics-logo.png.asset.json";
import planipretLogoAsset from "@/assets/planipret-logo.png.asset.json";
import { startMicrosoftSignIn } from "@/lib/ms365AuthLogin";
import { Ms365PendingBanner } from "@/components/planipret/mobile/Ms365PendingBanner";
import portalAnalyticsImg from "@/assets/pp-portal-analytics.jpg";
import portalCallsImg from "@/assets/pp-portal-calls.jpg";
import portalUsersImg from "@/assets/pp-portal-users.jpg";
import portalCommissionsImg from "@/assets/pp-portal-commissions.jpg";

type Slide = { img: string; fr: { title: string; text: string }; en: { title: string; text: string } };

/** Showcase slides describing what each portal gives access to. */
const SLIDES: Record<"admin" | "broker", Slide[]> = {
  admin: [
    {
      img: portalAnalyticsImg,
      fr: { title: "Vue d'ensemble de la firme", text: "KPI en temps réel : volume d'appels, textos, temps de réponse et performance par courtier." },
      en: { title: "Firm-wide overview", text: "Live KPIs: call volume, texts, response time and per-broker performance." },
    },
    {
      img: portalCallsImg,
      fr: { title: "Appels, textos et enregistrements", text: "Historique complet, écoute et téléchargement des enregistrements, boîtes vocales et journaux CDR." },
      en: { title: "Calls, texts and recordings", text: "Full history, recording playback and download, voicemail and CDR logs." },
    },
    {
      img: portalCommissionsImg,
      fr: { title: "Commissions de tous les courtiers", text: "Dépôts, volume par prêteur, tendances annuelles et rapports PDF exportables." },
      en: { title: "Commissions across brokers", text: "Deposits, volume by lender, yearly trends and exportable PDF reports." },
    },
    {
      img: portalUsersImg,
      fr: { title: "Utilisateurs, postes et sécurité", text: "Création de postes et DID automatiques, rôles, journaux d'accès et conformité." },
      en: { title: "Users, extensions and security", text: "Extension and DID provisioning, roles, access logs and compliance." },
    },
  ],
  broker: [
    {
      img: portalCallsImg,
      fr: { title: "Vos appels et messages", text: "Appels manqués, textos et messagerie vocale de votre poste, au même endroit." },
      en: { title: "Your calls and messages", text: "Missed calls, texts and voicemail from your extension, in one place." },
    },
    {
      img: portalAnalyticsImg,
      fr: { title: "Vos statistiques", text: "Volume d'appels, heures de pointe et suivi de vos clients en temps réel." },
      en: { title: "Your statistics", text: "Call volume, peak hours and real-time client follow-up." },
    },
    {
      img: portalCommissionsImg,
      fr: { title: "Vos commissions", text: "Dépôts, volume par prêteur et évolution de vos revenus, avec analyse IA." },
      en: { title: "Your commissions", text: "Deposits, volume by lender and revenue trends, with AI insights." },
    },
    {
      img: portalUsersImg,
      fr: { title: "Tâches et clients Maestro", text: "Tâches synchronisées avec Maestro, fiches clients et suivis du pipeline." },
      en: { title: "Maestro tasks and clients", text: "Tasks synced with Maestro, client records and pipeline follow-ups." },
    },
  ],
};

/** Auto-rotating showcase of what the portal gives access to. */
function PortalShowcase({ variant, lang }: { variant: "admin" | "broker"; lang: string }) {
  const slides = SLIDES[variant];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % slides.length), 5200);
    return () => window.clearInterval(id);
  }, [slides.length]);
  const fr = lang !== "en";

  return (
    <div className="w-full">
      <div
        className="relative w-full overflow-hidden rounded-2xl"
        style={{ aspectRatio: "4 / 3", border: "1px solid var(--pp-bg-border-2)", background: "var(--pp-bg-surface)" }}
      >
        {slides.map((s, i) => (
          <img
            key={s.fr.title}
            src={s.img}
            alt={fr ? s.fr.title : s.en.title}
            loading={i === 0 ? "eager" : "lazy"}
            width={1024}
            height={768}
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
            style={{ opacity: i === index ? 1 : 0 }}
          />
        ))}
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 35%, rgba(3,7,18,0.92))" }} />
        <div className="absolute bottom-0 left-0 right-0 p-5">
          <p style={{ fontFamily: "Urbanist,sans-serif", fontWeight: 800, fontSize: 18, color: "#fff" }}>
            {fr ? slides[index].fr.title : slides[index].en.title}
          </p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", marginTop: 4, lineHeight: 1.45 }}>
            {fr ? slides[index].fr.text : slides[index].en.text}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 mt-4">
        {slides.map((s, i) => (
          <button
            key={s.en.title}
            onClick={() => setIndex(i)}
            aria-label={fr ? s.fr.title : s.en.title}
            className="rounded-full transition-all"
            style={{
              width: i === index ? 22 : 8,
              height: 8,
              background: i === index ? "var(--pp-brand-accent)" : "var(--pp-bg-border-2)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Turns a raw Microsoft/OAuth failure into a message a broker can act on.
 * `access_denied` covers both an explicit cancel and a refused consent.
 */
export function describeMsAuthError(raw: string | null | undefined, lang: "fr" | "en"): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  const fr = lang === "fr";
  if (v.includes("access_denied") || v.includes("cancel") || v.includes("annul")) {
    return fr
      ? "Connexion Microsoft annulée. Aucun accès n'a été accordé — réessayez pour continuer."
      : "Microsoft sign-in was cancelled. No access was granted — try again to continue.";
  }
  if (v.includes("domain") || v.includes("planipret")) {
    return fr
      ? "Ce compte Microsoft n'est pas un compte @planipret. Utilisez votre compte professionnel Planiprêt."
      : "This Microsoft account is not a @planipret account. Use your Planiprêt work account.";
  }
  if (v.includes("consent") || v.includes("aadsts65004")) {
    return fr
      ? "Autorisation refusée dans Microsoft 365. Acceptez les permissions demandées pour accéder au portail."
      : "Permission was declined in Microsoft 365. Accept the requested permissions to access the portal.";
  }
  if (v.includes("timeout") || v.includes("network") || v.includes("fetch")) {
    return fr
      ? "Microsoft n'a pas répondu à temps. Vérifiez votre connexion et réessayez."
      : "Microsoft did not respond in time. Check your connection and try again.";
  }
  if (v.includes("not configured") || v.includes("n'est pas configuré")) {
    return fr
      ? "La connexion Microsoft n'est pas configurée. Contactez un administrateur Planiprêt."
      : "Microsoft sign-in is not configured. Contact a Planiprêt administrator.";
  }
  if (v.includes("session")) {
    return fr
      ? "La session Microsoft n'a pas pu être finalisée. Reconnectez-vous."
      : "The Microsoft session could not be completed. Please sign in again.";
  }
  return fr
    ? `Échec de la connexion Microsoft : ${raw}`
    : `Microsoft sign-in failed: ${raw}`;
}

/** Desktop-first auth screen for the Planiprêt portals — Microsoft 365 only. */
export default function BrokerAuthScreen({
  onLoggedIn,
  msRedirect = "/planipret/broker/overview",
  title,
  subtitle,
  initialError,
  variant = "broker",
}: {
  onLoggedIn?: () => Promise<void> | void;
  msRedirect?: string;
  title?: string;
  subtitle?: string;
  /** Message shown immediately (e.g. blocked non-@planipret account). */
  initialError?: string | null;
  /** Which portal the screen introduces — drives the showcase content. */
  variant?: "admin" | "broker";
}) {
  const { t, lang, toggle: toggleLang } = useMplanipretLang();
  const { theme, toggle: toggleTheme } = useMplanipretTheme();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(initialError ?? null);

  useEffect(() => {
    if (initialError) setFormError(initialError);
  }, [initialError]);

  // Surface failures handed back by the Microsoft callback (?ms_error=...).
  useEffect(() => {
    const url = new URL(window.location.href);
    const raw =
      url.searchParams.get("ms_error") ||
      url.searchParams.get("error_description") ||
      url.searchParams.get("error");
    if (!raw) return;
    const message = describeMsAuthError(raw, lang === "en" ? "en" : "fr");
    if (message) {
      setFormError(message);
      toast.error(message);
    }
    ["ms_error", "error", "error_description"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInWithMicrosoft = async () => {
    setLoading(true);
    setFormError(null);
    try {
      await startMicrosoftSignIn(msRedirect, { prompt: "login" });
    } catch (error: any) {
      const message = describeMsAuthError(error?.message, lang === "en" ? "en" : "fr") || t("auth.msUnavailable");
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };



  const highlights =
    variant === "admin"
      ? [
          { icon: BarChart3, fr: "Statistiques, rapports et commissions de tous les courtiers", en: "Stats, reports and commissions for every broker" },
          { icon: PhoneCall, fr: "Appels, textos, enregistrements et postes téléphoniques", en: "Calls, texts, recordings and phone extensions" },
          { icon: ShieldCheck, fr: "Utilisateurs, rôles, journaux d'accès et conformité", en: "Users, roles, access logs and compliance" },
        ]
      : [
          { icon: PhoneCall, fr: "Appels, textos et messagerie vocale centralisés", en: "Calls, texts and voicemail in one place" },
          { icon: BarChart3, fr: "Statistiques et commissions en temps réel", en: "Real-time stats and commissions" },
          { icon: Mail, fr: "Microsoft 365 : courriels, Teams et calendrier", en: "Microsoft 365: email, Teams and calendar" },
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
            {variant === "admin"
              ? lang === "fr" ? "Portail administrateur" : "Admin portal"
              : lang === "fr" ? "Portail courtier" : "Broker portal"}
          </p>
          <h2
            style={{
              fontFamily: "Urbanist,sans-serif",
              fontWeight: 800,
              fontSize: 32,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: "var(--pp-text-primary)",
              marginTop: 10,
              marginBottom: 18,
            }}
          >
            {variant === "admin"
              ? lang === "fr" ? "Pilotez toute la firme, en un seul portail." : "Run the whole firm from one portal."
              : lang === "fr" ? "Toute votre activité, au même endroit." : "All your activity, in one place."}
          </h2>
          <PortalShowcase variant={variant} lang={lang} />
          <div className="mt-7 grid grid-cols-1 gap-3">
            {highlights.map(({ icon: Icon, fr, en }) => (
              <div key={en} className="flex items-center gap-3">
                <span
                  className="flex items-center justify-center rounded-xl shrink-0"
                  style={{
                    width: 34,
                    height: 34,
                    background: "var(--pp-bg-elevated)",
                    border: "1px solid var(--pp-bg-border-2)",
                    color: "var(--pp-brand-accent)",
                  }}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span style={{ fontSize: 13.5, color: "var(--pp-text-secondary)" }}>{lang === "fr" ? fr : en}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-2" style={{ color: "var(--pp-text-muted)", fontSize: 12 }}>
          <ShieldCheck className="w-4 h-4" />
          {variant === "admin"
            ? lang === "fr" ? "Connexion chiffrée · Journal d'accès et conformité" : "Encrypted sign-in · Access log and compliance"
            : lang === "fr" ? "Connexion chiffrée · Données isolées par courtier" : "Encrypted sign-in · Per-broker data isolation"}
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
              {title ?? (lang === "fr" ? "Connexion courtier" : "Broker sign-in")}
            </h1>
            {/* Mobile/tablet showcase — same content as the desktop brand panel. */}
            <div className="lg:hidden mt-5 mb-1">
              <PortalShowcase variant={variant} lang={lang} />
            </div>

            <p style={{ fontSize: 13.5, color: "var(--pp-text-secondary)", marginTop: 6 }}>
              {subtitle ??
                (lang === "fr"
                  ? "Accédez à vos appels, clients et statistiques Planiprêt."
                  : "Access your Planiprêt calls, clients and statistics.")}
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

              {loading && (
                <div className="flex items-center justify-center gap-2 mt-4" style={{ color: "var(--pp-text-muted)", fontSize: 12.5 }}>
                  <Loader2 className="w-4 h-4 animate-spin" /> {t("auth.signingIn")}
                </div>
              )}

              {formError && (
                <div
                  className="mt-4"
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

              <p className="mt-4 text-center" style={{ fontSize: 12, color: "var(--pp-text-muted)" }}>
                {lang === "fr"
                  ? "La connexion se fait uniquement avec votre compte Microsoft 365 @planipret."
                  : "Sign-in is only available with your Microsoft 365 @planipret account."}
              </p>

            </div>

            <p style={{ fontSize: 11.5, color: "var(--pp-text-muted)", textAlign: "center", marginTop: 18 }}>
              {variant === "admin"
                ? lang === "fr"
                  ? "Accès réservé aux administrateurs Planiprêt · Propulsé par AVA Statistic"
                  : "Reserved for Planiprêt administrators · Powered by AVA Statistic"
                : lang === "fr"
                  ? "Accès réservé aux courtiers Planiprêt · Propulsé par AVA Statistic"
                  : "Reserved for Planiprêt brokers · Powered by AVA Statistic"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
