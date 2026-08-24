import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard, Phone, MessageSquare, Voicemail, Mic, TrendingUp, Settings, LogOut, Mail, ShieldAlert, Users, Sun, Moon, CheckSquare,
} from "lucide-react";
import BrokerAuthScreen from "@/components/planipret/broker/BrokerAuthScreen";
import { PlanipretLangSwitch } from "@/components/planipret/PlanipretLangSwitch";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { useMplanipretTheme } from "@/hooks/useMplanipretTheme";
import planipretLogo from "@/assets/planipret-logo.png.asset.json";
import { resolveBrokerAccess } from "@/lib/planipret/brokerAccess";
import BrokerOmniSearch from "@/components/planipret/broker/BrokerOmniSearch";
import Portal2FAGate from "@/components/planipret/Portal2FAGate";
import PortalDomainGate from "@/components/planipret/PortalDomainGate";
import HighReadabilityToggle from "@/components/planipret/broker/HighReadabilityToggle";

export type BrokerCtx = { userId: string; authUserId: string; profile: any };

const NAV = [
  { to: "/planipret/broker/overview",   Icon: LayoutDashboard, fr: "Vue d'ensemble", en: "Overview" },
  { to: "/planipret/broker/calls",      Icon: Phone,           fr: "Appels",         en: "Calls" },
  { to: "/planipret/broker/messages",   Icon: MessageSquare,   fr: "Textos",         en: "Messages" },
  { to: "/planipret/broker/voicemail",  Icon: Voicemail,       fr: "Messagerie",     en: "Voicemail" },
  { to: "/planipret/broker/recordings", Icon: Mic,             fr: "Enregistrements", en: "Recordings" },
  { to: "/planipret/broker/microsoft",  Icon: Mail,            fr: "Microsoft 365",  en: "Microsoft 365" },
  { to: "/planipret/broker/commissions", Icon: TrendingUp,     fr: "Commissions",    en: "Commissions" },
  { to: "/planipret/broker/maestro-clients", Icon: Users, fr: "Clients Maestro", en: "Maestro clients" },
  { to: "/planipret/broker/tasks", Icon: CheckSquare, fr: "Tâches", en: "Tasks" },
  
  { to: "/planipret/broker/settings",   Icon: Settings,        fr: "Réglages",       en: "Settings" },
];

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export default function PlanipretBrokerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { lang } = useMplanipretLang();
  const { theme, toggle: toggleTheme } = useMplanipretTheme();
  const [state, setState] = useState<"checking" | "anon" | "denied" | "ready">("checking");
  const [userId, setUserId] = useState<string>("");
  const [authUserId, setAuthUserId] = useState<string>("");
  const [profile, setProfile] = useState<any>(null);
  const [denyReason, setDenyReason] = useState<string>("");

  // The broker portal uses document scrolling. Clear any scroll lock left by
  // another route/modal so wheel and touch scrolling work on every page.
  useEffect(() => {
    const htmlOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    const bodyTouchAction = document.body.style.touchAction;
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    document.body.style.touchAction = "pan-y";
    return () => {
      document.documentElement.style.overflow = htmlOverflow;
      document.body.style.overflow = bodyOverflow;
      document.body.style.touchAction = bodyTouchAction;
    };
  }, []);

  const load = async () => {
    const access = await resolveBrokerAccess();
    if (access.state === "ready") {
      setUserId(access.userId);
      setAuthUserId(access.authUserId);
      setProfile(access.profile);
      setState("ready");
      return;
    }
    setUserId("");
    setAuthUserId("");
    setProfile(null);
    if (access.state === "denied") {
      setDenyReason(access.reason);
      setState("denied");
    } else {
      setState("anon");
    }
  };

  useEffect(() => { void load(); }, []);

  // Re-evaluate access on every auth transition so a signed-out or swapped
  // session can never keep rendering another broker's data.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { setUserId(""); setAuthUserId(""); setProfile(null); setState("anon"); return; }
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED") { void load(); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const logout = async () => {
    setState("anon");
    // Ends the Supabase + Microsoft 365 sessions, then returns to the portal.
    await signOutMicrosoft("/planipret/broker");
  };



  if (state === "checking") {
    return (
      <div className="planipret-scope planipret-admin-scope planipret-broker-scope min-h-screen flex items-center justify-center" data-pp-theme={theme}
        style={{ color: "var(--pp-text-muted)", fontFamily: "'Epilogue', sans-serif" }}>
        {lang === "en" ? "Loading…" : "Chargement…"}
      </div>
    );
  }

  if (state === "anon") {
    return (
      <div className="planipret-scope planipret-admin-scope planipret-broker-scope" data-pp-theme={theme}>
        <BrokerAuthScreen
          msRedirect={location.pathname.startsWith("/planipret/broker") ? location.pathname : "/planipret/broker/overview"}
          onLoggedIn={async () => { await load(); }}
        />
      </div>
    );
  }


  if (state === "denied") {
    return (
      <div className="planipret-scope planipret-admin-scope planipret-broker-scope min-h-screen flex items-center justify-center p-6" data-pp-theme={theme}>
        <div className="pp-card max-w-md text-center" style={{ padding: 24 }}>
          <ShieldAlert className="w-8 h-8 mx-auto mb-3" style={{ color: "#ef4444" }} />
          <h1 className="pp-heading" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            {lang === "en" ? "Access denied" : "Accès refusé"}
          </h1>
          <p style={{ fontSize: 13, color: "var(--pp-text-muted)", marginBottom: 16 }}>
            {denyReason === "lemtel"
              ? (lang === "en" ? "This account does not belong to Planiprêt." : "Ce compte n'appartient pas à Planiprêt.")
              : (lang === "en" ? "No broker profile is linked to this account." : "Aucun profil courtier n'est lié à ce compte.")}
          </p>
          <button onClick={logout} className="px-3 py-2 rounded-lg text-[13px] font-semibold text-white" style={{ background: "var(--pp-brand-accent-2)" }}>
            {lang === "en" ? "Sign out" : "Se déconnecter"}
          </button>
        </div>
      </div>
    );
  }


  const current = NAV.find((n) => location.pathname.startsWith(n.to));
  const title = current ? (lang === "en" ? current.en : current.fr) : (lang === "en" ? "Broker portal" : "Portail courtier");
  const dateLabel = new Date().toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <PortalDomainGate>
    <Portal2FAGate>
    <div className="planipret-scope planipret-admin-scope planipret-broker-scope min-h-screen flex" data-pp-theme={theme}
      style={{ background: "var(--pp-bg-base)", fontFamily: "'Epilogue', sans-serif" }}>
      {/* Sidebar (desktop) */}
      <aside className="pp-sidebar hidden md:flex flex-col fixed left-0 top-0 h-screen w-[248px] z-40">
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
          <div className="flex items-center gap-3">
            <img src={planipretLogo.url} alt="Planiprêt"
              style={{ width: 38, height: 38, borderRadius: 10, objectFit: "cover", background: "#fff", border: "1px solid var(--pp-bg-border)" }} />
            <div className="min-w-0">
              <div className="pp-sidebar-brand" style={{ fontSize: 15 }}>Planiprêt</div>
              <div className="pp-sidebar-sub" style={{ fontSize: 11 }}>{lang === "en" ? "Broker portal" : "Portail courtier"}</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          <div className="pp-nav-section">{lang === "en" ? "My activity" : "Mon activité"}</div>
          {NAV.map(({ to, Icon, fr, en }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `pp-nav-item ${isActive ? "is-active" : ""}`}>
              {({ isActive }) => (
                <>
                  <Icon className="w-[17px] h-[17px] flex-shrink-0"
                    style={{ color: isActive ? "var(--pp-brand-accent-2)" : "var(--pp-text-muted)" }} />
                  <span className="flex-1 truncate">{lang === "en" ? en : fr}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: 14, borderTop: "1px solid var(--pp-bg-border)", background: "#FAFBFD" }}>
          <div className="flex items-center gap-3">
            <div className="rounded-full flex items-center justify-center text-white flex-shrink-0"
              style={{ width: 36, height: 36, background: "linear-gradient(135deg, #1E3A5F, #3B6FA0)", fontFamily: "'Urbanist', sans-serif", fontWeight: 700, fontSize: 12 }}>
              {initials(profile?.full_name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--pp-text-primary)" }}>{profile?.full_name ?? profile?.email}</p>
              <p style={{ fontSize: 10.5, color: "var(--pp-text-muted)" }}>
                {lang === "en" ? "Broker" : "Courtier"}{profile?.extension ? ` · ${profile.extension}` : ""}
              </p>
            </div>
            <button onClick={logout} title={lang === "en" ? "Sign out" : "Déconnexion"}
              className="flex items-center justify-center rounded-lg"
              style={{ width: 30, height: 30, color: "var(--pp-text-muted)" }}>
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top nav */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40" style={{ background: "var(--pp-bg-surface)", borderBottom: "1px solid var(--pp-bg-border)" }}>
        <div className="flex items-center gap-2 px-3 py-2">
          <img src={planipretLogo.url} alt="" style={{ width: 26, height: 26, borderRadius: 7 }} />
          <span className="pp-heading flex-1 truncate" style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          <button onClick={toggleTheme} aria-label="Theme" style={{ color: "var(--pp-text-muted)" }}>
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <PlanipretLangSwitch />
          <button onClick={logout} style={{ color: "var(--pp-text-muted)" }}><LogOut className="w-4 h-4" /></button>
        </div>
        <div className="px-3 pb-2">
          <BrokerOmniSearch userId={userId} />
        </div>
        <div className="flex gap-1 px-2 pb-2 overflow-x-auto">
          {NAV.map(({ to, fr, en }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => `px-3 py-1.5 rounded-full text-[12px] whitespace-nowrap ${isActive ? "is-active" : ""}`}
              style={({ isActive }) => ({
                background: isActive ? "var(--pp-brand-accent-2)" : "var(--pp-bg-elevated)",
                color: isActive ? "#fff" : "var(--pp-text-secondary)",
                border: "1px solid var(--pp-bg-border)",
              })}>
              {lang === "en" ? en : fr}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="flex flex-1 min-w-0 min-h-screen flex-col md:ml-[248px] pt-[148px] md:pt-0">
        <header className="pp-app-header sticky top-0 hidden md:flex items-center justify-between gap-4 px-5 xl:px-7 z-30" style={{ height: 64 }}>
          <h1 className="pp-heading truncate" style={{ fontWeight: 700, fontSize: 18 }}>{title}</h1>
          <div className="flex items-center gap-3">
            <BrokerOmniSearch userId={userId} className="hidden md:block w-[280px] lg:w-[340px] xl:w-[400px]" />

            <HighReadabilityToggle />

            <button onClick={toggleTheme} title={theme === "dark" ? "Mode clair" : "Mode sombre"}
              aria-label="Theme"
              className="flex items-center justify-center rounded-lg"
              style={{ width: 30, height: 30, color: "var(--pp-text-muted)", border: "1px solid var(--pp-bg-border)", background: "var(--pp-bg-elevated)" }}>
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <PlanipretLangSwitch />
            <span className="capitalize hidden xl:inline" style={{ fontSize: 10.5, color: "var(--pp-text-muted)" }}>{dateLabel}</span>
          </div>
        </header>

        <main className="pa-main flex-1 min-w-0 p-4 md:p-7" style={{ overflowX: "clip", overflowY: "visible" }}>
          <Outlet context={{ userId, authUserId, profile } satisfies BrokerCtx} />
        </main>
      </div>
    </div>
    </Portal2FAGate>
    </PortalDomainGate>
  );
}
