import { FormEvent, ReactNode, useEffect, useState } from "react";
import { Lock, ShieldCheck, Wifi, Fingerprint, Loader2 } from "lucide-react";
import { lemtelClient, requestTemporaryPassword, LemtelError, toLemtelErrorKey, LEMTEL_BACKEND_CONFIGURED } from "./lemtelHostedApi";
import { passwordStrength, type LemtelDict, type Lang } from "./lemtelI18n";
import { Field, LemtelMonogram } from "./LemtelUi";

export function needsPersonalPassword(user: any): boolean {
  const m = { ...(user?.app_metadata ?? {}), ...(user?.user_metadata ?? {}) };
  return m.must_change_password === true || m.temporary_password === true;
}

/** Set personal password, then establish a fresh session with it. Recovers silently from a double submit. */
export async function completePersonalPassword(email: string, pwd: string): Promise<void> {
  const c = lemtelClient();
  if (!c) throw new LemtelError("unavailable");
  const { error } = await c.auth.updateUser({ password: pwd, data: { must_change_password: false, temporary_password: false } });
  if (error) {
    const msg = String(error.message ?? "").toLowerCase();
    const alreadyDone = msg.includes("same") || msg.includes("different from the old") || msg.includes("already");
    if (!alreadyDone) throw new LemtelError(toLemtelErrorKey(error.message, (error as any).status));
  }
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: pwd });
  if (e2) throw new LemtelError(toLemtelErrorKey(e2.message, (e2 as any).status));
  const { data, error: e3 } = await c.auth.getUser();
  if (e3 || !data.user) throw new LemtelError("unavailable");
}

function AuthLayout({ t, lang, setLang, children }: { t: LemtelDict; lang: Lang; setLang: (l: Lang) => void; children: ReactNode }) {
  const tiles = lang === "fr"
    ? [{ i: Fingerprint, h: "Une identité", p: "Un courriel, un mot de passe, partout." }, { i: Wifi, h: "Connecté", p: "Bureau, iOS et Android synchronisés." }, { i: ShieldCheck, h: "Privé", p: "Réglages chargés seulement après connexion." }]
    : [{ i: Fingerprint, h: "One identity", p: "One email, one password, everywhere." }, { i: Wifi, h: "Connected", p: "Desktop, iOS and Android in sync." }, { i: ShieldCheck, h: "Private", p: "Settings load only after sign-in." }];
  return (
    <div className="lemtel-portal-scope min-h-screen lt-auth-bg grid lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden lg:flex flex-col justify-between p-12">
        <div className="flex items-center gap-3"><LemtelMonogram size={40} /><div><div className="font-semibold text-lg">{t.brand}</div><div className="lt-muted-on-navy text-sm">{t.tagline}</div></div></div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight mb-3">{lang === "fr" ? "Vos communications d'entreprise, réunies et protégées." : "Your business communications, together and protected."}</h1>
          <div className="grid gap-3 mt-8">
            {tiles.map(({ i: I, h, p }) => (
              <div key={h} className="lt-glass p-4 flex gap-3 items-start"><I className="w-5 h-5 mt-0.5" style={{ color: "hsl(var(--lt-cyan))" }} /><div><div className="font-semibold">{h}</div><div className="lt-muted-on-navy text-sm">{p}</div></div></div>
            ))}
          </div>
        </div>
        <p className="lt-muted-on-navy text-xs">{t.brand} · {t.tagline}</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="lt-card w-full max-w-[440px] p-8" style={{ color: "hsl(var(--lt-ink))" }}>
          <div className="flex items-center justify-between mb-6">
            <div className="lg:hidden"><LemtelMonogram /></div>
            <div className="ml-auto flex gap-1" role="group" aria-label="Language">
              {(["fr", "en"] as Lang[]).map((l) => <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={`lt-chip ${lang === l ? "lt-chip-cyan" : ""}`}>{l.toUpperCase()}</button>)}
            </div>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}

export function LemtelSignIn({ t, lang, setLang, onSignedIn }: { t: LemtelDict; lang: Lang; setLang: (l: Lang) => void; onSignedIn: () => void }) {
  const [view, setView] = useState<"signin" | "forgot" | "first">("signin");
  const [email, setEmail] = useState(""); const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const c = lemtelClient(); if (!c) { setErr(t.errors.unavailable); return; }
    setBusy(true);
    try {
      const { data, error } = await c.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pwd });
      if (error || !data.user) { setErr(t.errors[toLemtelErrorKey(error?.message, (error as any)?.status)]); return; }
      setPwd("");
      if (needsPersonalPassword(data.user)) setView("first"); else onSignedIn();
    } catch { setErr(t.errors.network); } finally { setBusy(false); }
  };

  return (
    <AuthLayout t={t} lang={lang} setLang={setLang}>
      {view === "signin" && (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <h2 className="text-2xl font-semibold">{t.signInTitle}</h2>
          {!LEMTEL_BACKEND_CONFIGURED && <p className="lt-notice px-3 py-2 text-sm">{t.readonlyBody}</p>}
          <Field label={t.email}>{(id) => <input id={id} type="email" autoComplete="username" className="lt-input" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
          <Field label={t.password}>{(id) => <input id={id} type="password" autoComplete="current-password" className="lt-input" value={pwd} onChange={(e) => setPwd(e.target.value)} required />}</Field>
          <button type="button" className="text-sm font-medium underline-offset-2 hover:underline" style={{ color: "hsl(189 90% 30%)" }} onClick={() => setView("forgot")}>{t.forgot}</button>
          {err && <p className="lt-error" role="alert">{err}</p>}
          <button type="submit" className="lt-btn lt-btn-gold w-full justify-center !py-3" disabled={busy || !email || !pwd || !LEMTEL_BACKEND_CONFIGURED}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}{t.signIn}
          </button>
        </form>
      )}
      {view === "forgot" && <ForgotPassword t={t} initialEmail={email} onBack={() => setView("signin")} />}
      {view === "first" && <FirstPassword t={t} email={email.trim().toLowerCase()} onDone={onSignedIn}
        onBack={async () => { await lemtelClient()?.auth.signOut(); setView("signin"); }} />}
    </AuthLayout>
  );
}

export function ForgotPassword({ t, initialEmail, onBack }: { t: LemtelDict; initialEmail?: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [cool, setCool] = useState(0);
  useEffect(() => { if (cool <= 0) return; const id = setTimeout(() => setCool(cool - 1), 1000); return () => clearTimeout(id); }, [cool]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await requestTemporaryPassword(email); setDone(true); setCool(60); }
    catch (x) { setErr(t.errors[x instanceof LemtelError ? x.key : "generic"]); if (x instanceof LemtelError && x.key === "throttled") setCool(60); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h2 className="text-2xl font-semibold">{t.forgotTitle}</h2>
      <p className="lt-ink-2 text-sm">{t.forgotBody}</p>
      <Field label={t.email}>{(id) => <input id={id} type="email" autoComplete="username" className="lt-input" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      {done && <p role="status" className="lt-chip lt-chip-ok !rounded-xl !px-3 !py-2 !text-sm !font-medium">{t.forgotDone}</p>}
      {err && <p className="lt-error" role="alert">{err}</p>}
      <button type="submit" className="lt-btn lt-btn-gold w-full justify-center !py-3" disabled={busy || !email || cool > 0}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}{cool > 0 ? t.cooldown(cool) : t.forgotSend}
      </button>
      <button type="button" className="lt-btn lt-btn-ghost w-full justify-center" onClick={onBack}>{t.backToSignIn}</button>
    </form>
  );
}

export function FirstPassword({ t, email, onDone, onBack }: { t: LemtelDict; email: string; onDone: () => void; onBack: () => void }) {
  const [a, setA] = useState(""); const [b, setB] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const s = passwordStrength(a);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (a !== b) { setErr(t.mismatch); return; }
    setBusy(true);
    try { await completePersonalPassword(email, a); setA(""); setB(""); onDone(); }
    catch (x) { setErr(t.errors[x instanceof LemtelError ? x.key : "generic"]); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="lt-chip lt-chip-cyan">{t.makeItYours}</p>
      <h2 className="text-2xl font-semibold">{t.createPwd}</h2>
      <Field label={t.newPwd} hint={t.strengthHint}>{(id, d) => <input id={id} aria-describedby={d} type="password" autoComplete="new-password" className="lt-input" value={a} onChange={(e) => setA(e.target.value)} />}</Field>
      <div aria-live="polite">
        <div className="flex gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i < s ? `hsl(var(${s >= 3 ? "--lt-green" : "--lt-gold"}))` : "hsl(var(--lt-border))" }} />)}</div>
        <p className="text-xs mt-1 lt-ink-2">{t.strength[s]}</p>
      </div>
      <Field label={t.confirmPwd} error={b && a !== b ? t.mismatch : undefined}>{(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!b && a !== b} type="password" autoComplete="new-password" className="lt-input" value={b} onChange={(e) => setB(e.target.value)} />}</Field>
      {err && <p className="lt-error" role="alert">{err}</p>}
      <button type="submit" className="lt-btn lt-btn-gold w-full justify-center !py-3" disabled={busy || s < 3 || a !== b}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t.continue}
      </button>
      <button type="button" className="lt-btn lt-btn-ghost w-full justify-center" onClick={onBack}>{t.otherAccount}</button>
    </form>
  );
}
