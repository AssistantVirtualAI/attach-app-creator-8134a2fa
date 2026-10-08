import React, { useMemo, useState } from 'react';
import { theme } from '../lib/theme';
import { setAuthToken } from '../lib/avaApi';
import { supabase } from '../lib/supabaseClient';
import { BACKEND_URL } from '../lib/backendOrigin';
import LemtelLogo from './LemtelLogo';
import BrandTagline from './BrandTagline';

type Creds = {
  portalUrl: string;
  backendOrigin?: string;
  email: string;
  extension: string;
  displayName?: string;
  sipDomain?: string;
  wssUrl?: string;
  userId?: string;
  accessToken?: string;
  refreshToken?: string;
  organizationId?: string;
};

type PendingSession = { userId: string; email: string; accessToken?: string; refreshToken?: string };
type Screen = 'login' | 'forgot' | 'first-password';

const passwordIsStrong = (value: string) => value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

function readableSignInError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/invalid login credentials|invalid_credentials/i.test(message)) return 'We could not sign you in. Check your email and password, or request a temporary password.';
  return message || 'We could not sign you in. Please try again.';
}

/**
 * Lemtel has one credential entrypoint: email plus password. Extensions, SIP domains
 * and telephony configuration are server-authoritative and never appear in this UI.
 */
export default function SetupWizard({ onComplete }: { onComplete: (creds: Creds) => void }) {
  const { colors } = theme;
  const [screen, setScreen] = useState<Screen>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<PendingSession | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoverySent, setRecoverySent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validFirstPassword = useMemo(() => passwordIsStrong(newPassword) && newPassword === confirmPassword, [newPassword, confirmPassword]);
  const goToForgot = () => {
    setRecoveryEmail(email.trim());
    setRecoverySent(false);
    setError('');
    setScreen('forgot');
  };
  const goToLogin = () => {
    setError('');
    setScreen('login');
  };

  const finalize = async (session: PendingSession) => {
    const { data: bootstrap, error: bootstrapError } = await supabase.functions.invoke('lemtel-session-bootstrap');
    const first = (bootstrap as any)?.organizations?.[0];
    if (bootstrapError || (bootstrap as any)?.error || !first?.organizationId) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error((bootstrap as any)?.error || bootstrapError?.message || 'Lemtel account setup is unavailable.');
    }
    const credentials: Creds = {
      portalUrl: BACKEND_URL,
      backendOrigin: BACKEND_URL,
      email: session.email,
      extension: '',
      displayName: (bootstrap as any)?.user?.displayName || session.email.split('@')[0],
      userId: session.userId,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      organizationId: first.organizationId,
    };
    if (session.accessToken) setAuthToken(session.accessToken);
    await window.electronAPI?.saveCredentials?.(credentials);
    onComplete(credentials);
  };

  const handleEmailConnect = async () => {
    if (!validEmail(email) || !password) return;
    setLoading(true); setError('');
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError || !authData.user || !authData.session) throw new Error(authError?.message || 'Sign-in rejected');
      const session: PendingSession = {
        userId: authData.user.id,
        email: authData.user.email || email.trim(),
        accessToken: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
      };
      if (authData.user.app_metadata?.lemtel_onboarding_required === true) {
        setPending(session);
        setNewPassword('');
        setConfirmPassword('');
        setScreen('first-password');
        return;
      }
      await finalize(session);
    } catch (cause: unknown) {
      setError(readableSignInError(cause));
    } finally { setLoading(false); }
  };

  const requestTemporaryPassword = async () => {
    if (!validEmail(recoveryEmail)) {
      setError('Enter the email address linked to your Lemtel account.');
      return;
    }
    setLoading(true); setError('');
    try {
      const { data, error: requestError } = await supabase.functions.invoke('lemtel-password-reset-request', { body: { email: recoveryEmail.trim() } });
      if (requestError || (data as any)?.ok !== true) throw new Error((data as any)?.error || requestError?.message || 'Password recovery is temporarily unavailable.');
      setRecoverySent(true);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Password recovery is temporarily unavailable.');
    } finally { setLoading(false); }
  };

  const completeFirstPassword = async () => {
    if (!pending || !validFirstPassword) return;
    setLoading(true); setError('');
    try {
      const { data, error: completionError } = await supabase.functions.invoke('lemtel-complete-first-password', { body: { newPassword } });
      // A prior click can finish the server-side password update before the UI
      // receives its response. A 409 in that exact state is recoverable: sign
      // in with the chosen password below rather than showing an Edge error.
      const completionStatus = Number((completionError as any)?.context?.status ?? 0);
      const alreadyCompleted = (data as any)?.error === 'first_password_change_not_required' || completionStatus === 409;
      if (!alreadyCompleted && (completionError || (data as any)?.ok !== true)) {
        throw new Error((data as any)?.error || completionError?.message || 'Password update failed');
      }
      // Updating a password through the server can revoke the temporary refresh
      // token. Sign in once with the just-selected password to obtain a fresh,
      // post-onboarding session instead of trying to refresh a revoked token.
      const { data: renewed, error: renewalError } = await supabase.auth.signInWithPassword({
        email: pending.email,
        password: newPassword,
      });
      if (renewalError || !renewed.user || !renewed.session) {
        throw new Error('Password updated, but the new secure session could not be opened. Please sign in with your new password.');
      }
      await finalize({
        ...pending,
        userId: renewed.user.id,
        email: renewed.user.email || pending.email,
        accessToken: renewed.session.access_token,
        refreshToken: renewed.session.refresh_token,
      });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Password update failed');
    } finally { setLoading(false); }
  };

  return (
    <main className="lemtel-auth-experience">
      <style>{`
        .lemtel-auth-experience {
          min-height: 100%; min-width: 0; box-sizing: border-box;
          background: linear-gradient(145deg, #061020 0%, #091a36 52%, #0a3150 100%);
          display: flex; flex-direction: column; color: #f4f8ff;
          position: relative; overflow: auto; isolation: isolate;
        }
        .lemtel-auth-workspace {
          flex: 1; width: min(100%, 1180px); min-width: 0; box-sizing: border-box;
          margin: 0 auto; padding: clamp(24px, 4vw, 44px) clamp(16px, 4vw, 48px) clamp(20px, 3vw, 30px);
          position: relative; z-index: 1; display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(min(100%, 440px), 0.85fr);
          align-items: center; gap: clamp(28px, 5vw, 68px);
        }
        .lemtel-auth-card {
          width: 100%; min-width: 0; max-width: 470px; box-sizing: border-box; justify-self: end;
          background: linear-gradient(165deg, rgba(21,42,75,0.98), rgba(7,17,39,0.96));
          border: 1px solid rgba(126,210,255,0.38); border-radius: 26px;
          padding: clamp(24px, 3.2vw, 40px);
          box-shadow: 0 34px 100px rgba(0,0,0,0.43), inset 0 1px 0 rgba(255,255,255,0.10);
          backdrop-filter: blur(18px);
        }
        .lemtel-auth-brand, .lemtel-auth-card, .lemtel-auth-card * { min-width: 0; }
        .lemtel-auth-copy, .lemtel-auth-error, .lemtel-auth-trust { overflow-wrap: anywhere; }
        .lemtel-auth-field > span { color: rgba(225,236,255,0.82) !important; }
        .lemtel-auth-card .lemtel-input { min-height: 50px; }
        .lemtel-auth-card .lemtel-btn-primary { min-height: 52px; height: auto !important; padding: 12px 16px; white-space: normal; line-height: 1.3; }
        .lemtel-auth-secondary { width: 100%; min-height: 44px; white-space: normal; line-height: 1.3; }
        .lemtel-auth-trust { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 13px; background: rgba(126,210,255,0.07); border: 1px solid rgba(126,210,255,0.16); color: rgba(230,241,255,0.78); font-size: 11px; line-height: 1.45; }
        .lemtel-auth-trust-mark { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: #75efc0; box-shadow: 0 0 14px rgba(117,239,192,0.72); }
        .lemtel-auth-display { font-size: clamp(32px, 4vw, 46px) !important; overflow-wrap: anywhere; }
        .lemtel-auth-panel-title { font-size: clamp(24px, 4vw, 28px) !important; overflow-wrap: anywhere; }
        @media (max-width: 930px) {
          .lemtel-auth-workspace { grid-template-columns: minmax(0, 1fr); max-width: 560px; padding-top: 32px; }
          .lemtel-auth-brand { display: none; }
          .lemtel-auth-card { justify-self: stretch; max-width: none; }
        }
        @media (max-width: 520px) {
          .lemtel-auth-workspace { padding: 18px 14px 16px; gap: 16px; }
          .lemtel-auth-card { border-radius: 20px; padding: 22px 18px; }
          .lemtel-auth-footer { padding: 12px 16px 16px !important; }
        }
        @media (max-height: 680px) and (min-width: 931px) {
          .lemtel-auth-workspace { align-items: start; }
          .lemtel-auth-brand { padding-top: 0; }
          .lemtel-auth-brand .lemtel-auth-value-row { margin-top: 18px !important; }
        }
      `}</style>
      <AmbientVisuals />
      <section className="lemtel-auth-workspace">
        <BrandPanel />
        <section className="lemtel-auth-card">
          {screen === 'login' && <LoginPanel email={email} password={password} loading={loading} error={error} onEmail={setEmail} onPassword={setPassword} onSubmit={handleEmailConnect} onForgot={goToForgot} />}
          {screen === 'forgot' && <RecoveryPanel email={recoveryEmail} sent={recoverySent} loading={loading} error={error} onEmail={setRecoveryEmail} onRequest={requestTemporaryPassword} onBack={goToLogin} />}
          {screen === 'first-password' && <FirstPasswordPanel newPassword={newPassword} confirmPassword={confirmPassword} valid={validFirstPassword} loading={loading} error={error} onNewPassword={setNewPassword} onConfirmPassword={setConfirmPassword} onSubmit={completeFirstPassword} />}
        </section>
      </section>
      <footer className="lemtel-auth-footer" style={{ padding: '16px 24px 22px', textAlign: 'center', fontSize: 11, color: 'rgba(232,238,251,0.68)', letterSpacing: 0.45, position: 'relative', zIndex: 1 }}>
        <span style={{ color: colors.gold, fontWeight: 800 }}>L</span> Lemtel Telecom · Private, intelligent communications
      </footer>
    </main>
  );
}

function AmbientVisuals() {
  return <>
    <div style={{ position: 'absolute', top: -180, right: -100, width: 570, height: 570, borderRadius: '50%', background: 'radial-gradient(circle, rgba(11,181,214,0.24), transparent 65%)', filter: 'blur(12px)', pointerEvents: 'none' }} />
    <div style={{ position: 'absolute', bottom: -230, left: -170, width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,215,0,0.15), transparent 68%)', filter: 'blur(20px)', pointerEvents: 'none' }} />
    <div style={{ position: 'absolute', inset: 0, opacity: 0.18, backgroundImage: 'linear-gradient(rgba(174,224,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(174,224,255,0.08) 1px, transparent 1px)', backgroundSize: '46px 46px', maskImage: 'linear-gradient(to bottom, black, transparent 78%)', pointerEvents: 'none' }} />
  </>;
}

function BrandPanel() {
  const { colors } = theme;
  return <section className="lemtel-auth-brand" style={{ maxWidth: 560, padding: '18px 4px' }}>
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 999, border: '1px solid rgba(34,211,238,0.38)', background: 'rgba(34,211,238,0.10)', color: '#b8f2ff', fontSize: 11, fontWeight: 800, letterSpacing: 1.05, textTransform: 'uppercase' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.green, boxShadow: '0 0 14px rgba(34,197,94,0.9)' }} /> Lemtel secure workspace
    </div>
    <div style={{ marginTop: 26 }}><LemtelLogo size="lg" glow shape="square" /></div>
    <h1 className="lemtel-auth-display" style={{ margin: '24px 0 12px', color: '#f4f8ff', lineHeight: 1.04, letterSpacing: -1.9 }}>Communication,<br /><span style={{ background: 'linear-gradient(100deg, #7ee7ff, #f6d15a)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>beautifully connected.</span></h1>
    <p className="lemtel-auth-copy" style={{ margin: 0, maxWidth: 500, color: 'rgba(232,238,251,0.82)', fontSize: 16, lineHeight: 1.68 }}>A focused, secure workspace for calls, contacts and team presence. One Lemtel identity keeps the experience simple while account settings stay protected in the background.</p>
    <div className="lemtel-auth-value-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 30 }}>
      <ValuePill title="One identity" detail="Email access" />
      <ValuePill title="Connected" detail="Team workspace" />
      <ValuePill title="Private" detail="Protected calling" />
    </div>
    <div style={{ marginTop: 26 }}><BrandTagline size="sm" /></div>
  </section>;
}

function ValuePill({ title, detail }: { title: string; detail: string }) {
  return <div style={{ minHeight: 74, padding: '13px 12px', borderRadius: 16, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)' }}><strong style={{ display: 'block', color: '#f4f8ff', fontSize: 12 }}>{title}</strong><span style={{ display: 'block', color: 'rgba(232,238,251,0.55)', fontSize: 10, marginTop: 5 }}>{detail}</span></div>;
}

function LoginPanel(props: { email: string; password: string; loading: boolean; error: string; onEmail: (value: string) => void; onPassword: (value: string) => void; onSubmit: () => void; onForgot: () => void }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <PanelIntro eyebrow="Lemtel secure sign-in" title="Welcome back." description="Sign in with the email address and password from Lemtel. Your communication settings load privately after access is confirmed." />
    <div className="lemtel-auth-trust"><span className="lemtel-auth-trust-mark" aria-hidden />Encrypted account verification · Email-only access</div>
    <Field label="Email address" value={props.email} onChange={props.onEmail} type="email" placeholder="you@company.com" autoFocus />
    <Field label="Password" value={props.password} onChange={props.onPassword} type="password" placeholder="••••••••" onEnter={props.onSubmit} />
    <button type="button" onClick={props.onForgot} style={{ alignSelf: 'flex-start', color: '#74e3fa', background: 'transparent', border: 0, padding: '0 0 2px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Forgot password?</button>
    {props.error && <ErrorBox message={props.error} />}
    <PrimaryButton onClick={props.onSubmit} disabled={props.loading || !validEmail(props.email) || !props.password}>{props.loading ? 'Signing in securely…' : 'Sign in to Lemtel'}</PrimaryButton>
    <div className="lemtel-auth-copy" style={{ textAlign: 'center', color: 'rgba(232,238,251,0.64)', fontSize: 10.5, lineHeight: 1.5 }}>No extension. No SIP domain. Just your Lemtel email and password.</div>
  </div>;
}

function RecoveryPanel(props: { email: string; sent: boolean; loading: boolean; error: string; onEmail: (value: string) => void; onRequest: () => void; onBack: () => void }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <PanelIntro eyebrow="Password recovery" title={props.sent ? 'Check your inbox.' : 'Recover your access.'} description={props.sent ? 'If the address belongs to an active Lemtel account, a temporary password has been sent. Use it to sign in, then choose a new personal password immediately.' : 'Enter your Lemtel email. We will send a temporary password for a secure one-time sign-in and mandatory password change.'} />
    {!props.sent && <Field label="Email address" value={props.email} onChange={props.onEmail} type="email" placeholder="you@company.com" autoFocus onEnter={props.onRequest} />}
    {props.error && <ErrorBox message={props.error} />}
    {props.sent && <div style={{ padding: '14px 16px', borderRadius: 15, background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.32)', color: '#c7f8d4', fontSize: 12, lineHeight: 1.55 }}>For security, this message is identical whether or not the email matches an account. If your email is eligible, use the new temporary password only in the Lemtel app.</div>}
    {!props.sent && <PrimaryButton onClick={props.onRequest} disabled={props.loading || !validEmail(props.email)}>{props.loading ? 'Sending securely…' : 'Email me a temporary password'}</PrimaryButton>}
    {props.sent && <PrimaryButton onClick={props.onRequest} disabled={props.loading}>{props.loading ? 'Sending securely…' : 'Send again'}</PrimaryButton>}
    <button className="lemtel-auth-secondary" type="button" onClick={props.onBack} style={secondaryButtonStyle}>Back to sign in</button>
  </div>;
}

function FirstPasswordPanel(props: { newPassword: string; confirmPassword: string; valid: boolean; loading: boolean; error: string; onNewPassword: (value: string) => void; onConfirmPassword: (value: string) => void; onSubmit: () => void }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <PanelIntro eyebrow="Almost there" title="Make it yours." description="Your temporary password is verified. Set a strong, personal password to continue into your Lemtel workspace." />
    <Field label="New password" value={props.newPassword} onChange={props.onNewPassword} type="password" placeholder="••••••••••••" autoFocus />
    <Field label="Confirm password" value={props.confirmPassword} onChange={props.onConfirmPassword} type="password" placeholder="••••••••••••" onEnter={props.onSubmit} />
    <div style={{ color: 'rgba(232,238,251,0.56)', fontSize: 11, lineHeight: 1.5 }}>Use at least 12 characters including uppercase, lowercase, a number and a symbol.</div>
    {props.error && <ErrorBox message={props.error} />}
    <PrimaryButton onClick={props.onSubmit} disabled={props.loading || !props.valid}>{props.loading ? 'Updating securely…' : 'Continue to Lemtel'}</PrimaryButton>
  </div>;
}

function PanelIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><div style={{ color: '#74e3fa', textTransform: 'uppercase', letterSpacing: 1.4, fontSize: 10, fontWeight: 800 }}>{eyebrow}</div><h2 className="lemtel-auth-panel-title" style={{ margin: '8px 0 8px', color: '#f4f8ff', letterSpacing: -0.55 }}>{title}</h2><p className="lemtel-auth-copy" style={{ margin: 0, color: 'rgba(232,238,251,0.76)', fontSize: 13, lineHeight: 1.62 }}>{description}</p></div>;
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return <button className="lemtel-btn-primary" type="button" onClick={onClick} disabled={disabled} style={{ height: 52, borderRadius: 15, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 800, letterSpacing: 0.15, boxShadow: disabled ? 'none' : '0 10px 28px rgba(255,215,0,0.16)' }}>{children}</button>;
}

const secondaryButtonStyle: React.CSSProperties = { height: 44, borderRadius: 13, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#e8eefb', fontSize: 12, fontWeight: 700, cursor: 'pointer' };

function ErrorBox({ message }: { message: string }) {
  return <div className="lemtel-auth-error" role="alert" style={{ fontSize: 12, color: '#fecaca', padding: '11px 13px', borderRadius: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(248,113,113,0.28)', lineHeight: 1.45 }}>{message}</div>;
}

function Field({ label, value, onChange, type = 'text', placeholder, autoFocus, onEnter }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; autoFocus?: boolean; onEnter?: () => void }) {
  return <label className="lemtel-auth-field" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><span style={{ fontSize: 10, color: 'rgba(232,238,251,0.68)', textTransform: 'uppercase', letterSpacing: 1.55, fontWeight: 800 }}>{label}</span><input className="lemtel-input" type={type} value={value} placeholder={placeholder} autoFocus={autoFocus} autoCapitalize="none" autoCorrect="off" onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && onEnter) onEnter(); }} /></label>;
}
