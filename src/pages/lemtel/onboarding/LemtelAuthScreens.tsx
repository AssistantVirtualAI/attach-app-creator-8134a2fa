import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Fingerprint, Loader2, Lock, ShieldCheck, Wifi } from "lucide-react";
import { LEMTEL_BACKEND_CONFIGURED, LemtelError, lemtelClient, portalApi, toLemtelErrorKey } from "./lemtelHostedApi";
import { passwordStrength, type Lang, type LemtelDict } from "./lemtelI18n";
import { Field, LemtelMonogram } from "./LemtelUi";
import { completePersonalPassword, needsPersonalPassword } from "./lemtelAuthAuthority";

function AuthLayout({ t, lang, setLang, children }: { t: LemtelDict; lang: Lang; setLang: (lang: Lang) => void; children: ReactNode }) {
  const tiles = lang === "fr"
    ? [{ icon: Fingerprint, heading: "Une identité", body: "Un courriel et un mot de passe, partout." }, { icon: Wifi, heading: "Connecté", body: "Bureau, iOS et Android, une expérience cohérente." }, { icon: ShieldCheck, heading: "Privé", body: "Les réglages restent protégés côté serveur." }]
    : [{ icon: Fingerprint, heading: "One identity", body: "One email and password, everywhere." }, { icon: Wifi, heading: "Connected", body: "Desktop, iOS and Android, one consistent experience." }, { icon: ShieldCheck, heading: "Private", body: "Settings remain protected server-side." }];
  return <div className="lemtel-portal-scope min-h-screen lt-auth-bg grid lg:grid-cols-[1.1fr_1fr]">
    <section className="hidden lg:flex flex-col justify-between p-12"><div className="flex items-center gap-3"><LemtelMonogram size={40} /><div><div className="font-semibold text-lg">{t.brand}</div><div className="lt-muted-on-navy text-sm">{t.tagline}</div></div></div><div className="max-w-md"><h1 className="text-3xl font-semibold leading-tight mb-3">{lang === "fr" ? "Vos communications d'entreprise, réunies et protégées." : "Your business communications, together and protected."}</h1><div className="grid gap-3 mt-8">{tiles.map(({ icon: Icon, heading, body }) => <div key={heading} className="lt-glass p-4 flex gap-3 items-start"><Icon className="w-5 h-5 mt-0.5" style={{ color: "hsl(var(--lt-cyan))" }} /><div><div className="font-semibold">{heading}</div><div className="lt-muted-on-navy text-sm">{body}</div></div></div>)}</div></div><p className="lt-muted-on-navy text-xs">{t.brand} · {t.tagline}</p></section>
    <section className="flex items-center justify-center p-6"><div className="lt-card w-full max-w-[440px] p-8" style={{ color: "hsl(var(--lt-ink))" }}><div className="flex items-center justify-between mb-6"><div className="lg:hidden"><LemtelMonogram /></div><div className="ml-auto flex gap-1" role="group" aria-label="Language">{(["fr", "en"] as Lang[]).map((candidate) => <button key={candidate} onClick={() => setLang(candidate)} aria-pressed={lang === candidate} className={`lt-chip ${lang === candidate ? "lt-chip-cyan" : ""}`}>{candidate.toUpperCase()}</button>)}</div></div>{children}</div></section>
  </div>;
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
    {view === "signin" && <form onSubmit={signIn} className="space-y-4" noValidate><h2 className="text-2xl font-semibold">{t.signInTitle}</h2>{!LEMTEL_BACKEND_CONFIGURED && <p className="lt-notice px-3 py-2 text-sm">{t.readonlyBody}</p>}<Field label={t.email}>{(id) => <input id={id} type="email" autoComplete="username" className="lt-input" value={email} onChange={(event) => setEmail(event.target.value)} required />}</Field><Field label={t.password}>{(id) => <input id={id} type="password" autoComplete="current-password" className="lt-input" value={password} onChange={(event) => setPassword(event.target.value)} required />}</Field><button type="button" className="text-sm font-medium underline-offset-2 hover:underline" style={{ color: "hsl(189 90% 30%)" }} onClick={() => setView("forgot")}>{t.forgot}</button>{error && <p className="lt-error" role="alert">{error}</p>}<button type="submit" className="lt-btn lt-btn-gold w-full justify-center !py-3" disabled={busy || !email || !password || !LEMTEL_BACKEND_CONFIGURED}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}{t.signIn}</button></form>}
    {view === "forgot" && <ForgotPassword t={t} initialEmail={email} onBack={() => setView("signin")} />}
    {view === "first" && <FirstPassword t={t} email={email.trim().toLowerCase()} onDone={onSignedIn} onBack={async () => { await lemtelClient()?.auth.signOut(); setView("signin"); }} />}
  </AuthLayout>;
}

function ForgotPassword({ t, initialEmail, onBack }: { t: LemtelDict; initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [error, setError] = useState<string | null>(null); const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (cooldown <= 0) return; const id = window.setTimeout(() => setCooldown((value) => value - 1), 1000); return () => clearTimeout(id); }, [cooldown]);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(null); setBusy(true); try { await portalApi.requestTemporaryPassword(email); setDone(true); setCooldown(60); } catch (cause) { const key = cause instanceof LemtelError ? cause.key : "generic"; setError(t.errors[key]); if (key === "throttled") setCooldown(60); } finally { setBusy(false); } };
  return <form onSubmit={submit} className="space-y-4" noValidate><h2 className="text-2xl font-semibold">{t.forgotTitle}</h2><p className="lt-ink-2 text-sm">{t.forgotBody}</p><Field label={t.email}>{(id) => <input id={id} type="email" autoComplete="username" className="lt-input" value={email} onChange={(event) => setEmail(event.target.value)} required />}</Field>{done && <p role="status" className="lt-chip lt-chip-ok !rounded-xl !px-3 !py-2 !text-sm !font-medium">{t.forgotDone}</p>}{error && <p className="lt-error" role="alert">{error}</p>}<button type="submit" className="lt-btn lt-btn-gold w-full justify-center !py-3" disabled={busy || !email || cooldown > 0}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{cooldown > 0 ? t.cooldown(cooldown) : t.forgotSend}</button><button type="button" className="lt-btn lt-btn-ghost w-full justify-center" onClick={onBack}>{t.backToSignIn}</button></form>;
}

function FirstPassword({ t, email, onDone, onBack }: { t: LemtelDict; email: string; onDone: () => void; onBack: () => void }) {
  const [first, setFirst] = useState(""); const [second, setSecond] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const strength = passwordStrength(first);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(null); if (first !== second) { setError(t.mismatch); return; } setBusy(true); try { await completePersonalPassword(email, first); setFirst(""); setSecond(""); onDone(); } catch (cause) { setError(t.errors[cause instanceof LemtelError ? cause.key : "generic"]); } finally { setBusy(false); } };
  return <form onSubmit={submit} className="space-y-4" noValidate><p className="lt-chip lt-chip-cyan">{t.makeItYours}</p><h2 className="text-2xl font-semibold">{t.createPwd}</h2><Field label={t.newPwd} hint={t.strengthHint}>{(id, describedBy) => <input id={id} aria-describedby={describedBy} type="password" autoComplete="new-password" className="lt-input" value={first} onChange={(event) => setFirst(event.target.value)} />}</Field><div aria-live="polite"><div className="flex gap-1">{[0, 1, 2, 3].map((index) => <span key={index} className="h-1.5 flex-1 rounded-full" style={{ background: index < strength ? `hsl(var(${strength === 4 ? "--lt-green" : "--lt-gold"}))` : "hsl(var(--lt-border))" }} />)}</div><p className="text-xs mt-1 lt-ink-2">{t.strength[strength]}</p></div><Field label={t.confirmPwd} error={second && first !== second ? t.mismatch : undefined}>{(id, describedBy) => <input id={id} aria-describedby={describedBy} aria-invalid={Boolean(second && first !== second)} type="password" autoComplete="new-password" className="lt-input" value={second} onChange={(event) => setSecond(event.target.value)} />}</Field>{error && <p className="lt-error" role="alert">{error}</p>}<button type="submit" className="lt-btn lt-btn-gold w-full justify-center !py-3" disabled={busy || strength !== 4 || first !== second}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t.continue}</button><button type="button" className="lt-btn lt-btn-ghost w-full justify-center" onClick={onBack}>{t.otherAccount}</button></form>;
}
