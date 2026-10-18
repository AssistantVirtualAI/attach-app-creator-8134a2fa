import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Check, Fingerprint, KeyRound, Loader2, Lock, ShieldCheck, Sparkles, Wifi } from "lucide-react";
import { LEMTEL_BACKEND_CONFIGURED, LemtelError, lemtelClient, portalApi, toLemtelErrorKey } from "./lemtelHostedApi";
import { passwordStrength, type Lang, type LemtelDict } from "./lemtelI18n";
import { Field, LemtelMonogram } from "./LemtelUi";
import { completePersonalPassword, needsPersonalPassword } from "./lemtelAuthAuthority";

function AuthLayout({ t, lang, setLang, children }: { t: LemtelDict; lang: Lang; setLang: (lang: Lang) => void; children: ReactNode }) {
  const highlights = [Fingerprint, Wifi, ShieldCheck].map((icon, index) => ({ icon, ...t.auth.highlights[index] }));
  return <main className="lemtel-portal-scope min-h-screen lt-auth-bg" lang={lang}>
    <div className="lt-auth-orbit" aria-hidden="true" />
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1.16fr)_minmax(29rem,.84fr)]">
      <section className="lt-auth-hero hidden lg:flex" aria-label={t.brand}>
        <div className="lt-auth-hero-grid" aria-hidden="true" />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center justify-between gap-6">
            <div className="lt-auth-brand">
              <LemtelMonogram size={44} />
              <div><p className="lt-auth-brand-eyebrow">{t.auth.workspace}</p><p className="lt-auth-brand-name">{t.brand}</p></div>
            </div>
            <span className="lt-auth-connection"><span className="lt-auth-connection-dot" aria-hidden="true" />{t.auth.connectionBadge}</span>
          </div>
          <div className="max-w-[37rem] py-12">
            <p className="lt-auth-kicker"><Sparkles className="h-4 w-4" aria-hidden="true" />{t.tagline}</p>
            <h1 className="lt-auth-hero-title">{t.auth.heroTitle}</h1>
            <p className="lt-auth-hero-body">{t.auth.heroBody}</p>
            <div className="lt-auth-highlights">
              {highlights.map(({ icon: Icon, title, body }) => <div key={title} className="lt-auth-highlight"><span className="lt-auth-highlight-icon"><Icon className="h-5 w-5" aria-hidden="true" /></span><div><p className="font-semibold">{title}</p><p>{body}</p></div></div>)}
            </div>
          </div>
          <div className="lt-auth-hero-footer"><span><Check className="h-3.5 w-3.5" aria-hidden="true" />{t.auth.sessionScoped}</span><span>{t.auth.powered}</span></div>
        </div>
      </section>
      <section className="relative flex min-h-screen items-center justify-center p-5 sm:p-8 lg:p-10">
        <div className="lt-auth-mobile-brand lg:hidden"><LemtelMonogram size={42} /><div><p className="lt-auth-brand-eyebrow">{t.auth.workspace}</p><p className="lt-auth-brand-name">{t.brand}</p></div></div>
        <div className="lt-auth-card w-full max-w-[29rem]">
          <div className="lt-auth-card-topline">
            <div className="lt-auth-card-badge"><KeyRound className="h-4 w-4" aria-hidden="true" /><span>{t.auth.signInEyebrow}</span></div>
            <div className="flex gap-1" role="group" aria-label={t.auth.language}>{(["fr", "en"] as Lang[]).map((candidate) => <button key={candidate} type="button" onClick={() => setLang(candidate)} aria-pressed={lang === candidate} className={`lt-auth-language ${lang === candidate ? "is-active" : ""}`}>{candidate.toUpperCase()}</button>)}</div>
          </div>
          <div className="lt-auth-card-content">{children}</div>
          <footer className="lt-auth-card-footer"><ShieldCheck className="h-4 w-4" aria-hidden="true" /><span>{t.auth.sessionScoped}</span><span aria-hidden="true">·</span><span>{t.auth.powered}</span></footer>
        </div>
      </section>
    </div>
  </main>;
}

export function LemtelSignIn({ t, lang, setLang, onSignedIn }: { t: LemtelDict; lang: Lang; setLang: (lang: Lang) => void; onSignedIn: () => void }) {
  const [view, setView] = useState<"signin" | "forgot" | "first">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    const client = lemtelClient();
    if (!client) { setError(t.errors.unavailable); return; }
    setBusy(true);
    try {
      const { data, error: authError } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (authError || !data.user) { setError(t.errors[toLemtelErrorKey(authError?.message, (authError as { status?: number } | null)?.status)]); return; }
      setPassword("");
      if (needsPersonalPassword(data.user)) setView("first"); else onSignedIn();
    } catch { setError(t.errors.network); } finally { setBusy(false); }
  };

  return <AuthLayout t={t} lang={lang} setLang={setLang}>
    {view === "signin" && <form onSubmit={signIn} className="space-y-5" noValidate>
      <header className="lt-auth-form-header"><h2 className="lt-auth-form-title">{t.signInTitle}</h2><p>{t.auth.signInIntro}</p></header>
      {!LEMTEL_BACKEND_CONFIGURED && <p className="lt-notice px-3 py-2 text-sm">{t.readonlyBody}</p>}
      <Field label={t.email}>{(id) => <input id={id} type="email" autoComplete="username" className="lt-input" value={email} onChange={(event) => setEmail(event.target.value)} required />}</Field>
      <Field label={t.password}>{(id) => <input id={id} type="password" autoComplete="current-password" className="lt-input" value={password} onChange={(event) => setPassword(event.target.value)} required />}</Field>
      <div className="flex justify-end"><button type="button" className="lt-auth-link" onClick={() => setView("forgot")}>{t.forgot}</button></div>
      {error && <p className="lt-error" role="alert">{error}</p>}
      <button type="submit" className="lt-btn lt-btn-gold w-full justify-center !py-3" disabled={busy || !email || !password || !LEMTEL_BACKEND_CONFIGURED}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}{t.signIn}</button>
    </form>}
    {view === "forgot" && <ForgotPassword t={t} initialEmail={email} onBack={() => setView("signin")} />}
    {view === "first" && <FirstPassword t={t} email={email.trim().toLowerCase()} onDone={onSignedIn} onBack={async () => { await lemtelClient()?.auth.signOut(); setView("signin"); }} />}
  </AuthLayout>;
}

function ForgotPassword({ t, initialEmail, onBack }: { t: LemtelDict; initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [error, setError] = useState<string | null>(null); const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (cooldown <= 0) return; const id = window.setTimeout(() => setCooldown((value) => value - 1), 1000); return () => clearTimeout(id); }, [cooldown]);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(null); setBusy(true); try { await portalApi.requestTemporaryPassword(email); setDone(true); setCooldown(60); } catch (cause) { const key = cause instanceof LemtelError ? cause.key : "generic"; setError(t.errors[key]); if (key === "throttled") setCooldown(60); } finally { setBusy(false); } };
  return <form onSubmit={submit} className="space-y-5" noValidate><header className="lt-auth-form-header"><h2 className="lt-auth-form-title">{t.forgotTitle}</h2><p>{t.forgotBody}</p></header><Field label={t.email}>{(id) => <input id={id} type="email" autoComplete="username" className="lt-input" value={email} onChange={(event) => setEmail(event.target.value)} required />}</Field>{done && <p role="status" className="lt-chip lt-chip-ok !rounded-xl !px-3 !py-2 !text-sm !font-medium">{t.forgotDone}</p>}{error && <p className="lt-error" role="alert">{error}</p>}<button type="submit" className="lt-btn lt-btn-gold w-full justify-center !py-3" disabled={busy || !email || cooldown > 0}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{cooldown > 0 ? t.cooldown(cooldown) : t.forgotSend}</button><button type="button" className="lt-btn lt-btn-ghost w-full justify-center" onClick={onBack}>{t.backToSignIn}</button></form>;
}

function FirstPassword({ t, email, onDone, onBack }: { t: LemtelDict; email: string; onDone: () => void; onBack: () => void }) {
  const [first, setFirst] = useState(""); const [second, setSecond] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const strength = passwordStrength(first);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(null); if (first !== second) { setError(t.mismatch); return; } setBusy(true); try { await completePersonalPassword(email, first); setFirst(""); setSecond(""); onDone(); } catch (cause) { setError(t.errors[cause instanceof LemtelError ? cause.key : "generic"]); } finally { setBusy(false); } };
  return <form onSubmit={submit} className="space-y-5" noValidate><header className="lt-auth-form-header"><p className="lt-auth-form-kicker">{t.makeItYours}</p><h2 className="lt-auth-form-title">{t.createPwd}</h2></header><Field label={t.newPwd} hint={t.strengthHint}>{(id, describedBy) => <input id={id} aria-describedby={describedBy} type="password" autoComplete="new-password" className="lt-input" value={first} onChange={(event) => setFirst(event.target.value)} />}</Field><div aria-live="polite"><div className="flex gap-1">{[0, 1, 2, 3].map((index) => <span key={index} className="h-1.5 flex-1 rounded-full" style={{ background: index < strength ? `hsl(var(${strength === 4 ? "--lt-green" : "--lt-gold"}))` : "hsl(var(--lt-border))" }} />)}</div><p className="text-xs mt-1 lt-ink-2">{t.strength[strength]}</p></div><Field label={t.confirmPwd} error={second && first !== second ? t.mismatch : undefined}>{(id, describedBy) => <input id={id} aria-describedby={describedBy} aria-invalid={Boolean(second && first !== second)} type="password" autoComplete="new-password" className="lt-input" value={second} onChange={(event) => setSecond(event.target.value)} />}</Field>{error && <p className="lt-error" role="alert">{error}</p>}<button type="submit" className="lt-btn lt-btn-gold w-full justify-center !py-3" disabled={busy || strength !== 4 || first !== second}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t.continue}</button><button type="button" className="lt-btn lt-btn-ghost w-full justify-center" onClick={onBack}>{t.otherAccount}</button></form>;
}
