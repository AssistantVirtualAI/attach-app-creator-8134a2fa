import React, { useState } from 'react';
import {
  Bell,
  ChevronRight,
  History,
  LayoutGrid,
  LockKeyhole,
  MessageCircle,
  Phone,
  PhoneOff,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useTranslation, type I18nKey } from '../lib/i18n';
import LemtelLogo from './LemtelLogo';
import LanguageSwitcher from './ui/LanguageSwitcher';
import avaPoweredBy from '../assets/ava-powered-by.png';

type WorkspaceTab = 'phone' | 'calls' | 'messages' | 'contacts' | 'more';

type ReadOnlyWorkspaceProps = {
  email: string;
  organizationId: string | null;
  onRetry: () => void;
  onSignOut: () => void;
};

const NAV: { id: WorkspaceTab; label: I18nKey; Icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }> }[] = [
  { id: 'phone', label: 'nav.dialer', Icon: Phone },
  { id: 'calls', label: 'workspace.calls', Icon: History },
  { id: 'messages', label: 'workspace.chats', Icon: MessageCircle },
  { id: 'contacts', label: 'nav.contacts', Icon: Users },
  { id: 'more', label: 'workspace.settings', Icon: LayoutGrid },
];

function AppearanceControls() {
  const { mode, setMode } = useTheme();
  const { t } = useTranslation();

  return (
    <div className="desktop-readonly-controls">
      <div role="group" aria-label={t('workspace.theme')} className="desktop-readonly-theme-switch">
        <button type="button" aria-pressed={mode === 'daylight'} onClick={() => setMode('daylight')}>☀ {t('workspace.daylight')}</button>
        <button type="button" aria-pressed={mode === 'dark'} onClick={() => setMode('dark')}>◐ {t('workspace.dark')}</button>
      </div>
      <LanguageSwitcher compact />
    </div>
  );
}

/**
 * Safe authenticated workspace for the current server contract.
 * It deliberately uses no SIP, CDR, realtime, contact, or credential-loading
 * hook. The member can inspect the actual Desktop experience before their
 * administrator assigns telephony, while all calling actions stay disabled.
 */
export default function DesktopReadOnlyWorkspace({ email, organizationId, onRetry, onSignOut }: ReadOnlyWorkspaceProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<WorkspaceTab>('phone');
  const [dial, setDial] = useState('');
  const activeLabel = t(NAV.find((item) => item.id === active)?.label || 'nav.dialer');
  const displayName = email.split('@')[0]?.replace(/[._-]+/g, ' ') || t('workspace.member');
  const append = (digit: string) => setDial((current) => current + digit);

  return (
    <main className="desktop-readonly-workspace" data-testid="lemtel-desktop-readonly-workspace" aria-label={t('workspace.title')}>
      <style>{`
        .desktop-readonly-workspace { min-height: 100vh; box-sizing: border-box; padding: clamp(14px, 2vw, 28px); background: var(--ava-bg-gradient, #07152d); color: var(--ava-text, #f6f9ff); font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .desktop-readonly-shell { min-height: calc(100vh - clamp(28px, 4vw, 56px)); display: grid; grid-template-columns: 236px minmax(0, 1fr); overflow: hidden; border: 1px solid var(--ava-border-strong, rgba(150,180,255,.28)); border-radius: 28px; background: var(--ava-glass, rgba(12,18,40,.62)); box-shadow: 0 34px 100px -38px rgba(0,0,0,.72); }
        .desktop-readonly-rail { display: flex; flex-direction: column; padding: 24px 14px 16px; background: linear-gradient(180deg, rgba(5,13,36,.98), rgba(10,26,58,.95)); border-right: 1px solid rgba(150,185,255,.18); }
        .desktop-readonly-brand { display: flex; align-items: center; gap: 11px; padding: 2px 8px 22px; }
        .desktop-readonly-brand-title { color: #f7faff; font-size: 16px; font-weight: 850; letter-spacing: -.35px; }
        .desktop-readonly-brand-subtitle { margin-top: 2px; color: rgba(211,225,255,.82); font-size: 9px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
        .desktop-readonly-status { margin: 0 4px 18px; padding: 13px; border-radius: 17px; border: 1px solid rgba(122,162,255,.27); background: linear-gradient(145deg, rgba(73,112,255,.22), rgba(17,45,98,.3)); }
        .desktop-readonly-verified { display: flex; align-items: center; gap: 7px; color: #8ff3cc; font-size: 10px; font-weight: 850; letter-spacing: .04em; }
        .desktop-readonly-orb { width: 8px; height: 8px; border-radius: 50%; background: #27d89e; box-shadow: 0 0 15px #27d89e; }
        .desktop-readonly-member { margin-top: 9px; color: #f5f8ff; font-weight: 760; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: capitalize; }
        .desktop-readonly-email { margin-top: 3px; color: rgba(211,225,255,.78); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .desktop-readonly-nav { display: grid; gap: 5px; }
        .desktop-readonly-nav button { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 45px; padding: 0 11px; border: 1px solid transparent; border-radius: 13px; background: transparent; color: rgba(221,232,255,.84); font: 700 12px inherit; text-align: left; cursor: pointer; }
        .desktop-readonly-nav button:hover { background: rgba(255,255,255,.075); color: #fff; }
        .desktop-readonly-nav button[aria-current='page'] { border-color: rgba(128,173,255,.5); background: linear-gradient(100deg, rgba(55,97,255,.56), rgba(34,212,253,.16)); color: #fff; box-shadow: 0 12px 28px -20px rgba(35,96,255,.95); }
        .desktop-readonly-nav span { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 9px; background: rgba(255,255,255,.07); }
        .desktop-readonly-powered { display: flex; align-items: center; gap: 8px; margin-top: auto; padding: 16px 9px 2px; border-top: 1px solid rgba(179,202,255,.14); color: rgba(211,225,255,.72); font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; text-decoration: none; }
        .desktop-readonly-powered img { width: 23px; height: 23px; object-fit: contain; filter: drop-shadow(0 3px 8px rgba(0,0,0,.28)); }
        .desktop-readonly-main { min-width: 0; display: flex; flex-direction: column; }
        .desktop-readonly-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 72px; padding: 0 28px; border-bottom: 1px solid var(--ava-border, rgba(180,200,255,.14)); background: color-mix(in srgb, var(--ava-surface, rgba(255,255,255,.05)) 86%, transparent); backdrop-filter: blur(22px) saturate(160%); }
        .desktop-readonly-eyebrow { color: var(--ava-text-subtle, #8a9bc4); font-size: 9px; font-weight: 850; letter-spacing: .13em; text-transform: uppercase; }
        .desktop-readonly-header h1 { margin: 3px 0 0; color: var(--ava-text, #f6f9ff); font-size: 20px; letter-spacing: -.45px; }
        .desktop-readonly-controls { display: flex; align-items: center; gap: 7px; }
        .desktop-readonly-theme-switch { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid var(--ava-border, rgba(180,200,255,.14)); border-radius: 11px; background: var(--ava-overlay-04, rgba(255,255,255,.04)); }
        .desktop-readonly-theme-switch button { padding: 5px 9px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--ava-text-muted, #b8c6e8); font: 800 10px inherit; cursor: pointer; }
        .desktop-readonly-theme-switch button[aria-pressed='true'] { border-color: var(--ava-accent, #6680ff); background: var(--ava-accent-soft, rgba(0,35,230,.22)); color: var(--ava-accent, #6680ff); }
        .desktop-readonly-content { flex: 1; padding: clamp(18px, 3vw, 36px); overflow: auto; }
        .desktop-readonly-greeting { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
        .desktop-readonly-greeting h2 { margin: 0; color: var(--ava-text, #f6f9ff); font-size: clamp(22px, 3vw, 30px); letter-spacing: -.9px; text-transform: capitalize; }
        .desktop-readonly-greeting p { margin: 6px 0 0; color: var(--ava-text-muted, #b8c6e8); font-size: 13px; max-width: 720px; }
        .desktop-readonly-secure { display: inline-flex; align-items: center; gap: 7px; padding: 8px 11px; border: 1px solid color-mix(in srgb, var(--ava-success, #22d39a) 42%, transparent); border-radius: 999px; color: var(--ava-success, #22d39a); background: color-mix(in srgb, var(--ava-success, #22d39a) 10%, transparent); font-size: 10px; font-weight: 800; white-space: nowrap; }
        .desktop-readonly-grid { display: grid; grid-template-columns: minmax(300px, 1.16fr) minmax(250px, .84fr); gap: 18px; }
        .desktop-readonly-card { border: 1px solid var(--ava-border, rgba(180,200,255,.14)); border-radius: 22px; background: var(--ava-surface, rgba(255,255,255,.05)); box-shadow: var(--ava-shadow, 0 18px 60px -22px rgba(0,0,0,.6)); backdrop-filter: blur(22px) saturate(150%); }
        .desktop-readonly-dialer { padding: 26px; min-height: 470px; }
        .desktop-readonly-card-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--ava-text, #f6f9ff); font-size: 14px; font-weight: 800; }
        .desktop-readonly-chip { padding: 5px 9px; border-radius: 999px; color: var(--ava-warning, #d4a73a); background: color-mix(in srgb, var(--ava-warning, #d4a73a) 14%, transparent); font-size: 9px; font-weight: 850; letter-spacing: .09em; text-transform: uppercase; }
        .desktop-readonly-number { display: grid; place-items: center; min-height: 76px; margin: 25px auto 18px; padding: 10px 18px; border: 1px solid var(--ava-border-strong, rgba(180,200,255,.28)); border-radius: 18px; background: linear-gradient(155deg, var(--ava-overlay-10, rgba(255,255,255,.1)), var(--ava-overlay-02, rgba(255,255,255,.02))); color: var(--ava-text, #f6f9ff); font-size: 28px; font-weight: 650; letter-spacing: .04em; text-align: center; }
        .desktop-readonly-number[data-empty='true'] { color: var(--ava-text-subtle, #8a9bc4); font-size: 15px; font-weight: 700; }
        .desktop-readonly-pad { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; max-width: 312px; margin: 0 auto; }
        .desktop-readonly-pad button { min-height: 47px; border: 1px solid var(--ava-border-strong, rgba(180,200,255,.28)); border-radius: 14px; background: var(--ava-surface-elev, rgba(255,255,255,.08)); color: var(--ava-text, #f6f9ff); font: 800 17px inherit; cursor: pointer; transition: transform .16s ease, border-color .16s ease, background .16s ease; }
        .desktop-readonly-pad button:hover { transform: translateY(-2px); border-color: var(--ava-accent, #6680ff); background: var(--ava-accent-soft, rgba(0,35,230,.22)); }
        .desktop-readonly-call-row { display: flex; align-items: center; justify-content: center; gap: 28px; margin-top: 18px; }
        .desktop-readonly-call-row button { border: 0; background: transparent; color: var(--ava-text-muted, #b8c6e8); cursor: pointer; font: 800 10px inherit; letter-spacing: .08em; text-transform: uppercase; }
        .desktop-readonly-call-row .desktop-readonly-call { display: grid; place-items: center; width: 68px; height: 68px; border-radius: 50%; color: rgba(255,255,255,.5); background: rgba(133,151,190,.22); box-shadow: none; cursor: not-allowed; }
        .desktop-readonly-call-row .desktop-readonly-call:disabled { opacity: .8; }
        .desktop-readonly-side { display: grid; gap: 18px; }
        .desktop-readonly-quick, .desktop-readonly-activity { padding: 20px; }
        .desktop-readonly-quick-list { display: grid; gap: 8px; margin-top: 14px; }
        .desktop-readonly-action { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 1px solid transparent; border-radius: 13px; background: transparent; color: var(--ava-text, #f6f9ff); font: 700 12px inherit; text-align: left; cursor: pointer; }
        .desktop-readonly-action:hover { border-color: var(--ava-border, rgba(180,200,255,.14)); background: var(--ava-overlay-04, rgba(255,255,255,.04)); }
        .desktop-readonly-action span { display: grid; place-items: center; width: 29px; height: 29px; border-radius: 10px; color: var(--ava-accent, #6680ff); background: var(--ava-accent-soft, rgba(0,35,230,.22)); }
        .desktop-readonly-activity-row { display: flex; align-items: center; gap: 11px; padding: 12px 0; border-bottom: 1px solid var(--ava-border, rgba(180,200,255,.14)); }
        .desktop-readonly-activity-row:last-child { border-bottom: 0; }
        .desktop-readonly-avatar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 11px; color: #fff; background: linear-gradient(135deg, #4d6dff, #21d4fd); font-size: 12px; font-weight: 850; }
        .desktop-readonly-activity-title { color: var(--ava-text, #f6f9ff); font-size: 12px; font-weight: 760; }
        .desktop-readonly-activity-sub { margin-top: 2px; color: var(--ava-text-muted, #b8c6e8); font-size: 10px; }
        .desktop-readonly-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 18px; color: var(--ava-text-muted, #b8c6e8); font-size: 10px; }
        .desktop-readonly-footer button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: var(--ava-accent, #6680ff); font: 800 10px inherit; cursor: pointer; }
        @media (max-width: 880px) { .desktop-readonly-shell { grid-template-columns: 1fr; } .desktop-readonly-rail { display: block; padding: 14px; border-right: 0; border-bottom: 1px solid rgba(150,185,255,.18); } .desktop-readonly-brand, .desktop-readonly-status, .desktop-readonly-powered { display: none; } .desktop-readonly-nav { display: flex; overflow-x: auto; } .desktop-readonly-nav button { min-width: max-content; } .desktop-readonly-content { padding: 18px; } }
        @media (max-width: 660px) { .desktop-readonly-header { min-height: 62px; padding: 0 14px; } .desktop-readonly-header h1 { font-size: 16px; } .desktop-readonly-theme-switch button { padding: 5px 6px; font-size: 0; } .desktop-readonly-theme-switch button::first-letter { font-size: 12px; } .desktop-readonly-greeting { display: block; } .desktop-readonly-secure { margin-top: 12px; } .desktop-readonly-grid { grid-template-columns: 1fr; } .desktop-readonly-dialer { min-height: 0; padding: 18px; } }
      `}</style>

      <section className="desktop-readonly-shell">
        <aside className="desktop-readonly-rail">
          <div className="desktop-readonly-brand">
            <LemtelLogo size="sm" glow />
            <div>
              <div className="desktop-readonly-brand-title">Lemtel</div>
              <div className="desktop-readonly-brand-subtitle">{t('workspace.desktopClient')}</div>
            </div>
          </div>

          <div className="desktop-readonly-status">
            <div className="desktop-readonly-verified"><span className="desktop-readonly-orb" />{t('workspace.desktopReadyEyebrow')}</div>
            <div className="desktop-readonly-member">{displayName}</div>
            <div className="desktop-readonly-email">{email}</div>
          </div>

          <nav className="desktop-readonly-nav" aria-label={t('workspace.primaryNavigation')}>
            {NAV.map(({ id, label, Icon }) => (
              <button key={id} type="button" aria-current={active === id ? 'page' : undefined} onClick={() => setActive(id)}>
                <span><Icon size={16} strokeWidth={active === id ? 2.6 : 2} /></span>{t(label)}
              </button>
            ))}
          </nav>

          <a className="desktop-readonly-powered" href="https://assistantvirtualai.com" target="_blank" rel="noreferrer" aria-label="Powered by AVA — assistantvirtualai.com"><span>{t('workspace.poweredBy')}</span><img src={avaPoweredBy} alt="AVA" /></a>
        </aside>

        <section className="desktop-readonly-main">
          <header className="desktop-readonly-header">
            <div>
              <div className="desktop-readonly-eyebrow">{t('workspace.title')}</div>
              <h1>{activeLabel}</h1>
            </div>
            <AppearanceControls />
          </header>

          <div className="desktop-readonly-content">
            <div className="desktop-readonly-greeting">
              <div>
                <h2>{t('workspace.desktopReadyTitle')}</h2>
                <p>{t('workspace.readOnlyWorkspaceExplanation')}</p>
              </div>
              <div className="desktop-readonly-secure"><ShieldCheck size={14} />{t('workspace.secureSession')}</div>
            </div>

            <div className="desktop-readonly-grid">
              <section className="desktop-readonly-card desktop-readonly-dialer">
                <div className="desktop-readonly-card-title"><span>{t('preview.yourLine')}</span><span className="desktop-readonly-chip">{t('workspace.callingDisabled')}</span></div>
                <div className="desktop-readonly-number" data-empty={!dial}>{dial || t('workspace.enterNumber')}</div>
                <div className="desktop-readonly-pad">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => <button key={digit} type="button" onClick={() => append(digit)}>{digit}</button>)}
                </div>
                <div className="desktop-readonly-call-row">
                  <button type="button" onClick={() => setDial('')}>{t('workspace.clear')}</button>
                  <button type="button" className="desktop-readonly-call" disabled aria-label={t('workspace.callingDisabled')} title={t('workspace.telephonyNotProvisioned')}><PhoneOff size={26} /></button>
                  <button type="button" onClick={() => setDial((current) => current.slice(0, -1))} aria-label={t('workspace.backspace')}>⌫</button>
                </div>
              </section>

              <div className="desktop-readonly-side">
                <section className="desktop-readonly-card desktop-readonly-quick">
                  <div className="desktop-readonly-card-title"><span>{t('workspace.readOnlyWorkspace')}</span><LockKeyhole size={16} color="var(--ava-accent, #6680ff)" /></div>
                  <div className="desktop-readonly-quick-list">
                    <button className="desktop-readonly-action" type="button" onClick={() => setActive('messages')}><span><MessageCircle size={16} /></span>{t('workspace.teamChat')}<ChevronRight size={15} style={{ marginLeft: 'auto' }} /></button>
                    <button className="desktop-readonly-action" type="button" onClick={() => setActive('calls')}><span><History size={16} /></span>{t('preview.reviewRecent')}<ChevronRight size={15} style={{ marginLeft: 'auto' }} /></button>
                    <button className="desktop-readonly-action" type="button" onClick={() => setActive('contacts')}><span><Users size={16} /></span>{t('nav.contacts')}<ChevronRight size={15} style={{ marginLeft: 'auto' }} /></button>
                  </div>
                </section>

                <section className="desktop-readonly-card desktop-readonly-activity">
                  <div className="desktop-readonly-card-title"><span>{t('workspace.workspaceStatus')}</span><Bell size={16} color="var(--ava-text-subtle, #8a9bc4)" /></div>
                  <div className="desktop-readonly-activity-row"><div className="desktop-readonly-avatar"><ShieldCheck size={16} /></div><div><div className="desktop-readonly-activity-title">{t('workspace.desktopReadyEyebrow')}</div><div className="desktop-readonly-activity-sub">{email}</div></div></div>
                  <div className="desktop-readonly-activity-row"><div className="desktop-readonly-avatar"><Users size={16} /></div><div><div className="desktop-readonly-activity-title">{t('workspace.organization')}</div><div className="desktop-readonly-activity-sub">{organizationId ? t('workspace.verified') : t('workspace.secureSession')}</div></div></div>
                  <div className="desktop-readonly-activity-row"><div className="desktop-readonly-avatar"><PhoneOff size={16} /></div><div><div className="desktop-readonly-activity-title">{t('workspace.telephonyPending')}</div><div className="desktop-readonly-activity-sub">{t('workspace.callingDisabled')}</div></div></div>
                  <div className="desktop-readonly-footer"><span>{t('workspace.desktopClient')}</span><button type="button" onClick={onRetry}><RefreshCw size={13} />{t('workspace.retrySessionCheck')}</button></div>
                </section>
              </div>
            </div>

            <div className="desktop-readonly-footer" style={{ marginTop: 24 }}>
              <span>{t('workspace.readOnlyWorkspaceExplanation')}</span>
              <button type="button" onClick={onSignOut}><Search size={13} />{t('workspace.returnToSignIn')}</button>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
