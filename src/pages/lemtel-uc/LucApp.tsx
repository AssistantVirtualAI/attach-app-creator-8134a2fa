import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Building2, Contact, Gauge, LogOut, MessageSquare, Phone, Settings, Shield, Voicemail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LucProvider, useLuc } from "@/components/lemtel-uc/LucContext";
import { READ_ONLY } from "@/components/lemtel-uc/api";
import { ErrorNote, Panel } from "@/components/lemtel-uc/ui";
import "@/components/lemtel-uc/lemtel-uc.css";

function PreviewNotice() {
  return (
    <div role="note" className="luc-panel mb-4 text-xs" style={{ borderColor: "hsl(var(--luc-warn, 38 92% 50%))" }}>
      <strong>Non-production, read-only preview.</strong> Any data shown is non-production preview data. Nothing can be created, changed or deleted here; live administration remains in the existing Lemtel portal. Phone system, Edge and push are not connected. It uses the existing shared sign-in.
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error); setBusy(false);
  };
  const reset = async () => {
    if (!email) return setErr(new Error("Enter your email first."));
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) setErr(error); else setNote("Check your email for a reset link.");
  };
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="luc-panel w-full max-w-sm space-y-4">
        <div>
          <div className="luc-logo">Lemtel<span>UC</span></div>
          <p className="luc-muted text-sm">Preview — sign in with your existing account (shared sign-in). Your phone-system password is never needed here.</p>
        </div>
        <label className="block text-sm">Email<input className="luc-input mt-1" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="block text-sm">Password<input className="luc-input mt-1" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <ErrorNote error={err} />
        {note && <p className="text-sm luc-ok">{note}</p>}
        <button className="luc-btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <button type="button" className="luc-link text-sm" onClick={reset}>Forgot password?</button>
      </form>
    </div>
  );
}

function Onboarding() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <PreviewNotice />
      <Panel title="Welcome to Lemtel UC (preview)">
        <div className="space-y-3 text-sm">
          <p className="luc-muted">Your account is not linked to any preview organization.</p>
          <p className="luc-muted">{READ_ONLY}</p>
        </div>
      </Panel>
    </div>
  );
}

function Shell() {
  const { session, loading, tenants, tenantId, setTenantId, isTenantAdmin, isPlatformAdmin } = useLuc();
  const nav = useNavigate();
  if (loading) return <div className="grid min-h-screen place-items-center luc-muted">Loading…</div>;
  if (!session) return <Login />;
  if (!tenantId) return <Onboarding />;
  const links = [
    { to: "/lemtel-uc", icon: Gauge, label: "Dashboard", end: true },
    { to: "/lemtel-uc/calls", icon: Phone, label: "Calls" },
    { to: "/lemtel-uc/contacts", icon: Contact, label: "Contacts" },
    { to: "/lemtel-uc/messages", icon: MessageSquare, label: "Messages" },
    { to: "/lemtel-uc/voicemail", icon: Voicemail, label: "Voicemail" },
    { to: "/lemtel-uc/settings", icon: Settings, label: "Settings" },
    ...(isTenantAdmin ? [{ to: "/lemtel-uc/admin", icon: Shield, label: "Admin" }] : []),
    ...(isPlatformAdmin ? [{ to: "/lemtel-uc/platform", icon: Building2, label: "Platform" }] : []),
  ];
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="luc-side md:w-56">
        <div className="luc-logo px-3 py-4">Lemtel<span>UC</span></div>
        {tenants.length > 1 && (
          <select aria-label="Organization" className="luc-input mx-3 mb-3 w-[calc(100%-1.5rem)]" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `luc-nav ${isActive ? "luc-nav-active" : ""}`}>
              <l.icon size={16} /> <span>{l.label}</span>
            </NavLink>
          ))}
          <button className="luc-nav" onClick={async () => { await supabase.auth.signOut(); nav("/lemtel-uc"); }}><LogOut size={16} /> <span>Sign out</span></button>
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-4 md:p-8"><PreviewNotice /><Outlet /></main>
    </div>
  );
}

export default function LucApp() {
  return (
    <div className="lemtel-uc-scope">
      <LucProvider><Shell /></LucProvider>
    </div>
  );
}
