import React, { useMemo, useState } from 'react';
import { setAuthToken } from '../lib/avaApi';
import { supabase } from '../lib/supabaseClient';
import { BACKEND_URL } from '../lib/backendOrigin';
import { edgeFailure, lemtelAuthErrorMessage } from '../lib/lemtelAuthErrors';
import LemtelLogo from './LemtelLogo';
import avaPoweredBy from '../assets/ava-powered-by.png';

type Creds = {
  portalUrl: string;
  backendOrigin?: string;
  email: string;
  displayName?: string;
  userId?: string;
  accessToken?: string;
  refreshToken?: string;
  organizationId?: string;
};

type PendingSession = { userId: string; email: string; accessToken?: string; refreshToken?: string };
type Screen = 'login' | 'forgot' | 'first-password';
type IconName = 'call' | 'contacts' | 'notes' | 'shield' | 'arrow' | 'lock' | 'spark';

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
    // The authoritative Lemtel bootstrap endpoint is intentionally GET-only.
    // supabase.functions.invoke defaults to POST unless the method is explicit.
    const { data: bootstrap, error: bootstrapError } = await supabase.functions.invoke('lemtel-session-bootstrap', { method: 'GET' });
    const first = (bootstrap as any)?.organizations?.[0];
    if (bootstrapError || (bootstrap as any)?.error || !first?.organizationId) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error(lemtelAuthErrorMessage('bootstrap', edgeFailure(bootstrapError, bootstrap)));
    }
    const credentials: Creds = {
      portalUrl: BACKEND_URL,
      backendOrigin: BACKEND_URL,
      email: session.email,
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
      if (requestError || (data as any)?.ok !== true) {
        throw new Error(lemtelAuthErrorMessage('password-recovery', edgeFailure(requestError, data)));
      }
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
        throw new Error(lemtelAuthErrorMessage('first-password', edgeFailure(completionError, data)));
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

  const panel = screen === 'login'
    ? <LoginPanel email={email} password={password} loading={loading} error={error} onEmail={setEmail} onPassword={setPassword} onSubmit={handleEmailConnect} onForgot={goToForgot} />
    : screen === 'forgot'
      ? <RecoveryPanel email={recoveryEmail} sent={recoverySent} loading={loading} error={error} onEmail={setRecoveryEmail} onRequest={requestTemporaryPassword} onBack={goToLogin} />
      : <FirstPasswordPanel newPassword={newPassword} confirmPassword={confirmPassword} valid={validFirstPassword} loading={loading} error={error} onNewPassword={setNewPassword} onConfirmPassword={setConfirmPassword} onSubmit={completeFirstPassword} />;

  return <AccessConsole screen={screen}>{panel}</AccessConsole>;
}

function AccessConsole({ screen, children }: { screen: Screen; children: React.ReactNode }) {
  const title = screen === 'login' ? 'Access your desk.' : screen === 'forgot' ? 'Recover your desk.' : 'Make it yours.';
  const helper = screen === 'login'
    ? 'Your Lemtel identity opens your private calling workspace.'
    : screen === 'forgot'
      ? 'A protected recovery path, without exposing whether an account exists.'
      : 'A personal password protects the workspace you were invited to.';

  return (
    <main className="lemtel-access-console">
      <style>{accessConsoleStyles}</style>
      <aside className="lemtel-access-rail" aria-label="Lemtel identity">
        <div className="lemtel-access-mark" aria-label="Lemtel"><LemtelLogo size="sm" glow={false} /></div>
        <div className="lemtel-access-rail-line" />
        <div className="lemtel-access-rail-pulse" title="Secure workspace online"><span /></div>
        <div className="lemtel-access-rail-bottom">©</div>
      </aside>

      <section className="lemtel-access-stage">
        <header className="lemtel-access-topbar">
          <div className="lemtel-access-product"><span>Lemtel</span><small>Private communications desk</small></div>
          <div className="lemtel-access-network"><span className="lemtel-access-network-dot" /> Secure network <span className="lemtel-access-network-separator">•</span> Desktop client</div>
        </header>

        <div className="lemtel-access-layout">
          <section className="lemtel-access-intro">
            <div className="lemtel-access-kicker"><Icon name="spark" size={14} /> YOUR CALLING DESK</div>
            <h1>{title}</h1>
            <p>{helper}</p>
            <div className="lemtel-access-steps" aria-label="Access progress">
              <ProgressStep active={screen === 'login'} number="01" label="Authenticate" detail="Email identity" />
              <ProgressStep active={screen === 'first-password'} number="02" label="Protect" detail="Personal password" />
              <ProgressStep active={false} number="03" label="Connect" detail="Workspace ready" />
            </div>
          </section>

          <section className="lemtel-access-vault" aria-label="Lemtel secure access">
            <div className="lemtel-access-vault-cap"><span><Icon name="lock" size={13} /> VERIFIED ACCESS</span><span>LEMTEL ID</span></div>
            <div className="lemtel-access-vault-body">{children}</div>
            <div className="lemtel-access-vault-foot"><Icon name="shield" size={14} /> Account checks are protected end-to-end.</div>
          </section>

          <aside className="lemtel-access-desk-preview" aria-label="Your Lemtel desk preview">
            <div className="lemtel-access-preview-head"><span>WHEN YOU’RE IN</span><span className="lemtel-access-ready"><i /> READY</span></div>
            <div className="lemtel-access-presence-card">
              <div className="lemtel-access-presence-orb"><span /></div>
              <div><strong>Your desk is private.</strong><p>Calling, contacts and notes stay organized in one place.</p></div>
            </div>
            <PreviewModule icon="call" title="Calls" value="One-click control" tone="blue" />
            <PreviewModule icon="contacts" title="People" value="Shared presence" tone="violet" />
            <PreviewModule icon="notes" title="Lemtel Assist" value="Call notes, on demand" tone="mint" />
            <div className="lemtel-access-preview-footer"><Icon name="shield" size={13} /> No extension or SIP domain required</div>
          </aside>
        </div>

        <footer className="lemtel-access-footer">
          <div className="lemtel-access-footer-product"><span>L</span> Lemtel Telecom <i /> Intelligent communications, privately connected.</div>
          <a className="lemtel-access-powered" href="https://assistantvirtualai.com" target="_blank" rel="noreferrer" aria-label="Powered by AVA — assistantvirtualai.com"><span>Powered by</span><img src={avaPoweredBy} alt="AVA" /></a>
        </footer>
      </section>
    </main>
  );
}

function ProgressStep({ active, number, label, detail }: { active: boolean; number: string; label: string; detail: string }) {
  return <div className={`lemtel-access-step ${active ? 'is-active' : ''}`}><span>{number}</span><div><strong>{label}</strong><small>{detail}</small></div></div>;
}

function PreviewModule({ icon, title, value, tone }: { icon: IconName; title: string; value: string; tone: 'blue' | 'violet' | 'mint' }) {
  return <div className="lemtel-access-preview-module"><span className={`lemtel-access-preview-icon ${tone}`}><Icon name={icon} size={17} /></span><div><strong>{title}</strong><small>{value}</small></div><Icon name="arrow" size={14} /></div>;
}

function LoginPanel(props: { email: string; password: string; loading: boolean; error: string; onEmail: (value: string) => void; onPassword: (value: string) => void; onSubmit: () => void; onForgot: () => void }) {
  return <form className="lemtel-access-form" onSubmit={(event) => { event.preventDefault(); props.onSubmit(); }}>
    <PanelHeading eyebrow="SIGN IN" title="Welcome back." description="Use the email address and password issued for your Lemtel account." />
    <AuthField label="Email address" value={props.email} onChange={props.onEmail} type="email" placeholder="you@company.com" autoFocus />
    <AuthField label="Password" value={props.password} onChange={props.onPassword} type="password" placeholder="Enter your password" />
    <button className="lemtel-access-link" type="button" onClick={props.onForgot}>Forgot password? <Icon name="arrow" size={13} /></button>
    {props.error && <ErrorBox message={props.error} />}
    <PrimaryButton type="submit" disabled={props.loading || !validEmail(props.email) || !props.password}>{props.loading ? 'Securing your desk…' : 'Enter Lemtel'}</PrimaryButton>
    <div className="lemtel-access-form-note"><Icon name="shield" size={13} /> Email-only access. Telephony settings load only after verification.</div>
  </form>;
}

function RecoveryPanel(props: { email: string; sent: boolean; loading: boolean; error: string; onEmail: (value: string) => void; onRequest: () => void; onBack: () => void }) {
  return <form className="lemtel-access-form" onSubmit={(event) => { event.preventDefault(); props.onRequest(); }}>
    <PanelHeading eyebrow="ACCOUNT RECOVERY" title={props.sent ? 'Check your inbox.' : 'Reclaim access.'} description={props.sent ? 'If this address is eligible, a temporary password is on its way. Use it in Lemtel, then create a personal password immediately.' : 'Enter your Lemtel email and we will send a temporary password for a protected one-time sign-in.'} />
    {!props.sent && <AuthField label="Email address" value={props.email} onChange={props.onEmail} type="email" placeholder="you@company.com" autoFocus />}
    {props.sent && <div className="lemtel-access-success"><span><Icon name="shield" size={17} /></span><p>For privacy, this confirmation is the same whether or not the address belongs to an account.</p></div>}
    {props.error && <ErrorBox message={props.error} />}
    <PrimaryButton type="submit" disabled={props.loading || (!props.sent && !validEmail(props.email))}>{props.loading ? 'Sending securely…' : props.sent ? 'Send another temporary password' : 'Send temporary password'}</PrimaryButton>
    <button className="lemtel-access-secondary" type="button" onClick={props.onBack}>Back to sign in</button>
  </form>;
}

function FirstPasswordPanel(props: { newPassword: string; confirmPassword: string; valid: boolean; loading: boolean; error: string; onNewPassword: (value: string) => void; onConfirmPassword: (value: string) => void; onSubmit: () => void }) {
  return <form className="lemtel-access-form" onSubmit={(event) => { event.preventDefault(); props.onSubmit(); }}>
    <PanelHeading eyebrow="SECURE YOUR ACCESS" title="Make it yours." description="Your temporary password is verified. Choose a strong personal password to unlock your workspace." />
    <AuthField label="New password" value={props.newPassword} onChange={props.onNewPassword} type="password" placeholder="Create a strong password" autoFocus />
    <AuthField label="Confirm password" value={props.confirmPassword} onChange={props.onConfirmPassword} type="password" placeholder="Repeat your password" />
    <div className="lemtel-access-rule"><span>12+</span> Include uppercase, lowercase, a number and a symbol.</div>
    {props.error && <ErrorBox message={props.error} />}
    <PrimaryButton type="submit" disabled={props.loading || !props.valid}>{props.loading ? 'Protecting your desk…' : 'Continue to Lemtel'}</PrimaryButton>
  </form>;
}

function PanelHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="lemtel-access-heading"><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>;
}

function PrimaryButton({ children, disabled, type }: { children: React.ReactNode; disabled: boolean; type: 'button' | 'submit' }) {
  return <button className="lemtel-access-primary" type={type} disabled={disabled}>{children}<Icon name="arrow" size={16} /></button>;
}

function ErrorBox({ message }: { message: string }) {
  return <div className="lemtel-access-error" role="alert"><Icon name="shield" size={15} /> <span>{message}</span></div>;
}

function AuthField({ label, value, onChange, type = 'text', placeholder, autoFocus }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; autoFocus?: boolean }) {
  return <label className="lemtel-access-field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} autoFocus={autoFocus} autoCapitalize="none" autoCorrect="off" onChange={(event) => onChange(event.target.value)} /></label>;
}

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (name === 'call') return <svg {...common}><path d="M5 4h3l1.5 4-2 1.4a15.2 15.2 0 0 0 7 7l1.4-2L20 16v3c0 1.1-.9 2-2 2C10.3 21 3 13.7 3 6c0-1.1.9-2 2-2Z" /></svg>;
  if (name === 'contacts') return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.8 19c.8-3 2.5-4.5 5.2-4.5s4.4 1.5 5.2 4.5M17 7h4M19 5v4M17 15h4" /></svg>;
  if (name === 'notes') return <svg {...common}><path d="M5 4.5h14v15H5zM8 9h8M8 13h8M8 17h5" /></svg>;
  if (name === 'shield') return <svg {...common}><path d="M12 3 19 6v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6l7-3Z" /><path d="m9.2 12 1.8 1.8 3.9-4" /></svg>;
  if (name === 'lock') return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></svg>;
  if (name === 'spark') return <svg {...common}><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2ZM19 17l.6 2.4L22 20l-2.4.6L19 23l-.6-2.4L16 20l2.4-.6L19 17Z" /></svg>;
  return <svg {...common}><path d="M5 12h14M14 6l6 6-6 6" /></svg>;
}

const accessConsoleStyles = `
  .lemtel-access-console { --ink:#edf3ff; --muted:#96a6be; --line:rgba(165,190,225,.15); --blue:#5a8dff; --mint:#71e6bd; min-height:100%; color:var(--ink); display:flex; background:#08111f; font-family:'DM Sans',system-ui,sans-serif; overflow:auto; }
  .lemtel-access-console * { box-sizing:border-box; }
  .lemtel-access-console button, .lemtel-access-console input { font:inherit; }
  .lemtel-access-rail { width:88px; flex:0 0 88px; min-height:100%; background:#0c1728; border-right:1px solid var(--line); display:flex; flex-direction:column; align-items:center; padding:28px 0 20px; position:relative; }
  .lemtel-access-mark { width:42px; height:42px; display:grid; place-items:center; border-radius:13px; background:linear-gradient(145deg,#6797ff,#3162d6); box-shadow:0 12px 26px rgba(32,77,180,.38),inset 0 1px 0 rgba(255,255,255,.32); overflow:hidden; }
  .lemtel-access-mark img { width:34px !important; height:34px !important; border-radius:10px !important; filter:none !important; }
  .lemtel-access-rail-line { width:1px; flex:1; margin:28px 0 18px; background:linear-gradient(180deg,rgba(129,160,215,.36),rgba(129,160,215,.03)); }
  .lemtel-access-rail-pulse { width:28px; height:28px; display:grid; place-items:center; border-radius:50%; border:1px solid rgba(113,230,189,.32); background:rgba(113,230,189,.08); }
  .lemtel-access-rail-pulse span { width:7px; height:7px; border-radius:50%; background:var(--mint); box-shadow:0 0 0 5px rgba(113,230,189,.10),0 0 14px rgba(113,230,189,.85); }
  .lemtel-access-rail-bottom { margin-top:22px; color:#61718b; font-size:12px; }
  .lemtel-access-stage { min-width:0; flex:1; min-height:100%; display:flex; flex-direction:column; position:relative; overflow:hidden; background:radial-gradient(620px 430px at 57% 38%,rgba(48,86,150,.22),transparent 68%),radial-gradient(550px 430px at 94% 100%,rgba(32,158,196,.12),transparent 72%),#08111f; }
  .lemtel-access-stage:before { content:''; position:absolute; inset:0; pointer-events:none; opacity:.32; background-image:linear-gradient(rgba(170,194,230,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(170,194,230,.055) 1px,transparent 1px); background-size:54px 54px; mask-image:linear-gradient(120deg,black,transparent 72%); }
  .lemtel-access-topbar { min-height:84px; flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:0 clamp(26px,4vw,64px); border-bottom:1px solid var(--line); position:relative; z-index:1; }
  .lemtel-access-product { display:flex; align-items:baseline; gap:13px; min-width:0; }
  .lemtel-access-product span { color:#f6f9ff; font:700 19px/1 'Space Grotesk',sans-serif; letter-spacing:-.5px; }
  .lemtel-access-product small { color:#7f91ad; font-size:11px; letter-spacing:.3px; overflow-wrap:anywhere; }
  .lemtel-access-network { display:flex; align-items:center; gap:8px; color:#a6b5cc; font-size:11px; letter-spacing:.35px; white-space:nowrap; }
  .lemtel-access-network-dot { width:7px; height:7px; border-radius:50%; background:#71e6bd; box-shadow:0 0 12px rgba(113,230,189,.78); }
  .lemtel-access-network-separator { color:#53637d; }
  .lemtel-access-layout { width:min(100%,1370px); flex:1; min-height:0; margin:0 auto; padding:clamp(32px,5vw,76px) clamp(26px,5vw,78px) clamp(22px,3vw,44px); display:grid; grid-template-columns:minmax(230px,.8fr) minmax(340px,440px) minmax(220px,.72fr); gap:clamp(28px,4.2vw,74px); align-items:center; position:relative; z-index:1; }
  .lemtel-access-intro { min-width:0; }
  .lemtel-access-kicker { display:inline-flex; gap:8px; align-items:center; color:#8db0ff; font-size:10px; font-weight:800; letter-spacing:1.35px; }
  .lemtel-access-intro h1 { margin:20px 0 15px; max-width:400px; color:#f4f7ff; font:700 clamp(36px,4vw,64px)/.98 'Space Grotesk',sans-serif; letter-spacing:-2.8px; }
  .lemtel-access-intro>p { max-width:350px; margin:0; color:#b3c0d3; font-size:15px; line-height:1.65; }
  .lemtel-access-steps { margin-top:42px; display:flex; flex-direction:column; gap:15px; }
  .lemtel-access-step { display:flex; align-items:center; gap:12px; min-height:50px; padding:9px 12px; border-left:1px solid rgba(143,165,199,.26); color:#7f90a9; transition:background .18s ease,border-color .18s ease,color .18s ease; }
  .lemtel-access-step>span { font:700 10px/1 'Space Grotesk',sans-serif; letter-spacing:1px; color:#7788a2; }
  .lemtel-access-step strong,.lemtel-access-step small { display:block; }
  .lemtel-access-step strong { font-size:12px; letter-spacing:.05px; }
  .lemtel-access-step small { margin-top:3px; color:#60728e; font-size:10px; }
  .lemtel-access-step.is-active { padding-left:16px; border-left:2px solid #74a2ff; color:#f2f6ff; background:linear-gradient(90deg,rgba(83,132,241,.12),transparent); }
  .lemtel-access-step.is-active>span { color:#9bb8ff; }
  .lemtel-access-step.is-active small { color:#aabadd; }
  .lemtel-access-vault { min-width:0; border:1px solid rgba(188,208,236,.18); background:#f5f7fb; color:#17243a; border-radius:24px; box-shadow:0 28px 80px rgba(0,0,0,.34),0 2px 0 rgba(255,255,255,.5) inset; overflow:hidden; }
  .lemtel-access-vault-cap { min-height:50px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 24px; border-bottom:1px solid #dbe3ee; color:#5a6a81; font-size:9px; font-weight:800; letter-spacing:1.1px; }
  .lemtel-access-vault-cap span:first-child { display:inline-flex; align-items:center; gap:7px; color:#3f63af; }
  .lemtel-access-vault-body { padding:clamp(26px,3vw,36px); }
  .lemtel-access-vault-foot { display:flex; align-items:center; gap:8px; padding:14px 24px; background:#edf2f8; border-top:1px solid #dbe3ee; color:#607087; font-size:10.5px; line-height:1.4; }
  .lemtel-access-form { display:flex; flex-direction:column; gap:17px; }
  .lemtel-access-heading span { color:#547bd0; font-size:10px; font-weight:800; letter-spacing:1.35px; }
  .lemtel-access-heading h2 { margin:8px 0 8px; color:#13233b; font:700 29px/1.05 'Space Grotesk',sans-serif; letter-spacing:-1px; }
  .lemtel-access-heading p { margin:0; color:#607087; font-size:13px; line-height:1.58; }
  .lemtel-access-field { display:flex; flex-direction:column; gap:7px; }
  .lemtel-access-field>span { color:#40536e; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1.05px; }
  .lemtel-access-field input { width:100%; height:48px; padding:0 14px; border:1px solid #cbd5e2; border-radius:11px; outline:0; background:#fff; color:#17243a; font-size:14px; transition:border-color .16s ease,box-shadow .16s ease; }
  .lemtel-access-field input::placeholder { color:#96a4b8; }
  .lemtel-access-field input:focus { border-color:#638cf0; box-shadow:0 0 0 4px rgba(92,137,243,.15); }
  .lemtel-access-link { display:inline-flex; align-items:center; gap:5px; align-self:flex-start; padding:0; border:0; background:transparent; color:#446ecb; font-size:12px; font-weight:800; cursor:pointer; }
  .lemtel-access-link:hover { color:#173e94; }
  .lemtel-access-primary { min-height:50px; display:flex; align-items:center; justify-content:center; gap:9px; border:0; border-radius:11px; padding:12px 16px; background:linear-gradient(135deg,#4478eb,#2451bd); color:white; box-shadow:0 12px 22px rgba(46,91,204,.27); font-size:13px; font-weight:800; cursor:pointer; transition:transform .16s ease,box-shadow .16s ease,filter .16s ease; }
  .lemtel-access-primary:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 16px 26px rgba(46,91,204,.36); filter:brightness(1.04); }
  .lemtel-access-primary:active:not(:disabled) { transform:translateY(0); }
  .lemtel-access-primary:disabled { cursor:not-allowed; opacity:.52; box-shadow:none; }
  .lemtel-access-form-note { display:flex; align-items:flex-start; gap:7px; color:#718197; font-size:10.5px; line-height:1.5; }
  .lemtel-access-secondary { min-height:44px; border:1px solid #cbd5e2; border-radius:11px; background:#fff; color:#30435d; font-size:12px; font-weight:800; cursor:pointer; }
  .lemtel-access-secondary:hover { background:#eef3f9; }
  .lemtel-access-rule { display:flex; align-items:center; gap:8px; color:#607087; font-size:10.5px; line-height:1.45; }
  .lemtel-access-rule span { padding:4px 6px; border-radius:6px; background:#e5edf8; color:#4267ba; font:800 10px/1 'Space Grotesk',sans-serif; }
  .lemtel-access-error { display:flex; align-items:flex-start; gap:8px; padding:11px 12px; border-radius:10px; color:#a83d51; background:#fff1f3; border:1px solid #f1c7cf; font-size:11px; line-height:1.45; }
  .lemtel-access-success { display:flex; gap:12px; padding:13px; border:1px solid #c8e6d8; border-radius:12px; background:#f0fbf6; color:#2e6c51; }
  .lemtel-access-success span { color:#3da978; }
  .lemtel-access-success p { margin:0; font-size:11px; line-height:1.52; }
  .lemtel-access-desk-preview { min-width:0; display:flex; flex-direction:column; gap:10px; padding:20px; border:1px solid rgba(160,186,224,.16); border-radius:18px; background:rgba(14,27,47,.70); box-shadow:inset 0 1px 0 rgba(255,255,255,.04); }
  .lemtel-access-preview-head { display:flex; align-items:center; justify-content:space-between; gap:12px; color:#8193ad; font-size:9px; font-weight:800; letter-spacing:1px; }
  .lemtel-access-ready { display:inline-flex; align-items:center; gap:5px; color:#a3e9c9; }
  .lemtel-access-ready i { width:6px; height:6px; border-radius:50%; background:#71e6bd; box-shadow:0 0 9px rgba(113,230,189,.8); }
  .lemtel-access-presence-card { display:flex; gap:13px; align-items:center; padding:13px 0 16px; border-bottom:1px solid rgba(160,186,224,.14); }
  .lemtel-access-presence-orb { width:34px; height:34px; flex:0 0 auto; display:grid; place-items:center; border-radius:50%; border:1px solid rgba(113,230,189,.35); background:rgba(113,230,189,.08); }
  .lemtel-access-presence-orb span { width:10px; height:10px; border-radius:50%; background:#71e6bd; box-shadow:0 0 0 5px rgba(113,230,189,.08),0 0 16px rgba(113,230,189,.75); }
  .lemtel-access-presence-card strong { display:block; color:#eff5ff; font-size:12px; }
  .lemtel-access-presence-card p { margin:4px 0 0; color:#8395af; font-size:10px; line-height:1.45; }
  .lemtel-access-preview-module { display:flex; align-items:center; gap:10px; min-height:48px; padding:8px 0; color:#697d9c; }
  .lemtel-access-preview-module>div { min-width:0; flex:1; }
  .lemtel-access-preview-module strong,.lemtel-access-preview-module small { display:block; }
  .lemtel-access-preview-module strong { color:#dfe9f8; font-size:11px; }
  .lemtel-access-preview-module small { margin-top:3px; color:#71849f; font-size:9.5px; }
  .lemtel-access-preview-icon { width:31px; height:31px; flex:0 0 auto; display:grid; place-items:center; border-radius:9px; }
  .lemtel-access-preview-icon.blue { color:#8db2ff; background:rgba(86,141,255,.14); }.lemtel-access-preview-icon.violet { color:#bfadff; background:rgba(157,118,255,.14); }.lemtel-access-preview-icon.mint { color:#87eac8; background:rgba(99,214,171,.13); }
  .lemtel-access-preview-footer { display:flex; align-items:center; gap:7px; margin-top:4px; padding-top:13px; border-top:1px solid rgba(160,186,224,.14); color:#8395af; font-size:9.5px; line-height:1.4; }
  .lemtel-access-footer { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:0 clamp(26px,4vw,64px) 24px; position:relative; z-index:1; color:#657995; font-size:clamp(9px,.7vw,10px); letter-spacing:.25px; }
  .lemtel-access-footer-product { min-width:0; }
  .lemtel-access-footer span { color:#84a6fc; font-weight:800; }.lemtel-access-footer i { display:inline-block; width:3px; height:3px; margin:0 8px 2px; border-radius:50%; background:#4b6180; }
  .lemtel-access-powered { display:inline-flex; align-items:center; gap:8px; flex:0 0 auto; color:#8293ac; font-size:9px; font-weight:700; letter-spacing:.65px; text-transform:uppercase; text-decoration:none; transition:color .16s ease, transform .16s ease; }
  .lemtel-access-powered:hover { color:#bcd0ff; transform:translateY(-1px); }
  .lemtel-access-powered img { width:25px; height:25px; object-fit:contain; filter:drop-shadow(0 3px 8px rgba(0,0,0,.32)); }
  .lemtel-access-console :where(button, input):focus-visible { outline:none; box-shadow:0 0 0 3px #f5f7fb,0 0 0 6px rgba(70,117,231,.65); }
  @media (max-width:1120px) { .lemtel-access-layout { grid-template-columns:minmax(220px,.7fr) minmax(340px,440px); }.lemtel-access-desk-preview { display:none; } }
  @media (max-width:790px) { .lemtel-access-console { display:block; min-height:100vh; }.lemtel-access-rail { width:100%; min-height:auto; height:68px; padding:0 20px; flex-direction:row; justify-content:space-between; border-right:0; border-bottom:1px solid var(--line); }.lemtel-access-mark { width:34px; height:34px; border-radius:10px; }.lemtel-access-mark img { width:27px !important; height:27px !important; }.lemtel-access-rail-line,.lemtel-access-rail-bottom { display:none; }.lemtel-access-rail-pulse { width:26px; height:26px; }.lemtel-access-stage { min-height:calc(100% - 68px); overflow:visible; }.lemtel-access-topbar { min-height:62px; padding:0 22px; }.lemtel-access-product small { display:none; }.lemtel-access-network { font-size:10px; }.lemtel-access-layout { grid-template-columns:1fr; max-width:580px; padding:34px 22px 22px; gap:25px; }.lemtel-access-intro { display:grid; grid-template-columns:1fr auto; column-gap:20px; }.lemtel-access-intro h1 { grid-column:1; margin:13px 0 8px; font-size:clamp(34px,7vw,40px); }.lemtel-access-intro>p { grid-column:1; font-size:clamp(12px,2.3vw,13px); }.lemtel-access-steps { grid-row:1/4; grid-column:2; margin:4px 0 0; gap:7px; align-self:start; }.lemtel-access-step { min-height:36px; padding:5px 0 5px 9px; }.lemtel-access-step strong,.lemtel-access-step small { display:none; }.lemtel-access-vault { width:100%; }.lemtel-access-footer { padding:0 22px 20px; } }
  @media (max-width:470px) { .lemtel-access-topbar { padding:0 16px; }.lemtel-access-network-separator,.lemtel-access-network { font-size:9px; }.lemtel-access-layout { padding:27px 14px 18px; }.lemtel-access-intro { display:block; }.lemtel-access-steps { display:none; }.lemtel-access-intro h1 { font-size:clamp(32px,10vw,36px); letter-spacing:-1.7px; }.lemtel-access-vault { border-radius:18px; }.lemtel-access-vault-cap { padding:0 18px; }.lemtel-access-vault-body { padding:24px 19px; }.lemtel-access-vault-foot { padding:13px 18px; }.lemtel-access-footer { align-items:flex-start; flex-direction:column; gap:9px; padding:0 16px 18px; }.lemtel-access-powered { font-size:8.5px; } }
  @media (max-height:680px) and (min-width:791px) { .lemtel-access-layout { padding-top:28px; padding-bottom:16px; }.lemtel-access-intro h1 { margin-top:13px; font-size:clamp(32px,3.2vw,48px); }.lemtel-access-steps { margin-top:24px; gap:8px; }.lemtel-access-step { min-height:40px; }.lemtel-access-desk-preview { gap:5px; padding:15px; }.lemtel-access-preview-module { min-height:38px; padding:4px 0; }.lemtel-access-presence-card { padding:8px 0 10px; }.lemtel-access-footer { padding-bottom:14px; } }
  @media (prefers-reduced-motion: reduce) { .lemtel-access-console *, .lemtel-access-console *:before { transition:none !important; animation:none !important; } }
`;
