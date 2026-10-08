import React, { useState } from 'react';
import {
  Bell,
  ChevronRight,
  Headphones,
  History,
  LayoutGrid,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import { useTheme, theme } from '../lib/theme';
import { useTranslation, type I18nKey } from '../lib/i18n';
import LemtelLogo from '../components/LemtelLogo';
import LanguageSwitcher from '../components/ui/LanguageSwitcher';
import avaPoweredBy from '../assets/ava-powered-by.png';

const { colors: c } = theme;

type PreviewTab = 'phone' | 'calls' | 'messages' | 'contacts' | 'more';

const NAV: { id: PreviewTab; label: I18nKey; Icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }> }[] = [
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
    <div className="workspace-preview-controls">
      <div role="group" aria-label={t('workspace.theme')} className="workspace-preview-theme-switch">
        <button type="button" aria-pressed={mode === 'daylight'} onClick={() => setMode('daylight')}>☀ {t('workspace.daylight')}</button>
        <button type="button" aria-pressed={mode === 'dark'} onClick={() => setMode('dark')}>◐ {t('workspace.dark')}</button>
      </div>
      <LanguageSwitcher compact />
    </div>
  );
}

export default function WorkspacePreview() {
  const { t } = useTranslation();
  const [active, setActive] = useState<PreviewTab>('phone');
  const [dial, setDial] = useState('');
  const activeLabel = t(NAV.find((item) => item.id === active)?.label || 'nav.dialer');

  const append = (digit: string) => setDial((current) => current + digit);

  return (
    <main className="workspace-preview" aria-label={t('workspace.title')}>
      <style>{`
        .workspace-preview { min-height: 100vh; box-sizing: border-box; padding: clamp(14px, 2vw, 28px); background: var(--ava-bg-gradient, #07152d); color: var(--ava-text, #f6f9ff); font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .workspace-preview-shell { min-height: calc(100vh - clamp(28px, 4vw, 56px)); display: grid; grid-template-columns: 236px minmax(0, 1fr); overflow: hidden; border: 1px solid var(--ava-border-strong, rgba(150,180,255,.28)); border-radius: 28px; background: var(--ava-glass, rgba(12,18,40,.62)); box-shadow: 0 34px 100px -38px rgba(0,0,0,.72); }
        .workspace-preview-rail { display: flex; flex-direction: column; padding: 24px 14px 16px; background: linear-gradient(180deg, rgba(5,13,36,.98), rgba(10,26,58,.95)); border-right: 1px solid rgba(150,185,255,.18); }
        .workspace-preview-brand { display: flex; align-items: center; gap: 11px; padding: 2px 8px 22px; }
        .workspace-preview-brand-title { color: #f7faff; font-size: 16px; font-weight: 850; letter-spacing: -.35px; }
        .workspace-preview-brand-subtitle { margin-top: 2px; color: rgba(211,225,255,.82); font-size: 9px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
        .workspace-preview-status { margin: 0 4px 18px; padding: 13px; border-radius: 17px; border: 1px solid rgba(122,162,255,.27); background: linear-gradient(145deg, rgba(73,112,255,.22), rgba(17,45,98,.3)); }
        .workspace-preview-ready { display: flex; align-items: center; gap: 7px; color: #8ff3cc; font-size: 10px; font-weight: 850; letter-spacing: .04em; }
        .workspace-preview-orb { width: 8px; height: 8px; border-radius: 50%; background: #27d89e; box-shadow: 0 0 15px #27d89e; }
        .workspace-preview-member { margin-top: 9px; color: #f5f8ff; font-weight: 760; font-size: 13px; }
        .workspace-preview-extension { margin-top: 3px; color: rgba(211,225,255,.78); font-size: 10px; }
        .workspace-preview-nav { display: grid; gap: 5px; }
        .workspace-preview-nav button { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 45px; padding: 0 11px; border: 1px solid transparent; border-radius: 13px; background: transparent; color: rgba(221,232,255,.84); font: 700 12px inherit; text-align: left; cursor: pointer; }
        .workspace-preview-nav button:hover { background: rgba(255,255,255,.075); color: #fff; }
        .workspace-preview-nav button[aria-current='page'] { border-color: rgba(128,173,255,.5); background: linear-gradient(100deg, rgba(55,97,255,.56), rgba(34,212,253,.16)); color: #fff; box-shadow: 0 12px 28px -20px rgba(35,96,255,.95); }
        .workspace-preview-nav span { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 9px; background: rgba(255,255,255,.07); }
        .workspace-preview-powered { display: flex; align-items: center; gap: 8px; margin-top: auto; padding: 16px 9px 2px; border-top: 1px solid rgba(179,202,255,.14); color: rgba(211,225,255,.72); font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
        .workspace-preview-powered { text-decoration: none; }
        .workspace-preview-powered img { width: 23px; height: 23px; object-fit: contain; filter: drop-shadow(0 3px 8px rgba(0,0,0,.28)); }
        .workspace-preview-main { min-width: 0; display: flex; flex-direction: column; }
        .workspace-preview-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 72px; padding: 0 28px; border-bottom: 1px solid var(--ava-border, rgba(180,200,255,.14)); background: color-mix(in srgb, var(--ava-surface, rgba(255,255,255,.05)) 86%, transparent); backdrop-filter: blur(22px) saturate(160%); }
        .workspace-preview-eyebrow { color: var(--ava-text-subtle, #8a9bc4); font-size: 9px; font-weight: 850; letter-spacing: .13em; text-transform: uppercase; }
        .workspace-preview-header h1 { margin: 3px 0 0; color: var(--ava-text, #f6f9ff); font-size: 20px; letter-spacing: -.45px; }
        .workspace-preview-controls { display: flex; align-items: center; gap: 7px; }
        .workspace-preview-theme-switch { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid var(--ava-border, rgba(180,200,255,.14)); border-radius: 11px; background: var(--ava-overlay-04, rgba(255,255,255,.04)); }
        .workspace-preview-theme-switch button { padding: 5px 9px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--ava-text-muted, #b8c6e8); font: 800 10px inherit; cursor: pointer; }
        .workspace-preview-theme-switch button[aria-pressed='true'] { border-color: var(--ava-accent, #6680ff); background: var(--ava-accent-soft, rgba(0,35,230,.22)); color: var(--ava-accent, #6680ff); }
        .workspace-preview-content { flex: 1; padding: clamp(18px, 3vw, 36px); overflow: auto; }
        .workspace-preview-greeting { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
        .workspace-preview-greeting h2 { margin: 0; color: var(--ava-text, #f6f9ff); font-size: clamp(22px, 3vw, 30px); letter-spacing: -.9px; }
        .workspace-preview-greeting p { margin: 6px 0 0; color: var(--ava-text-muted, #b8c6e8); font-size: 13px; }
        .workspace-preview-secure { display: inline-flex; align-items: center; gap: 7px; padding: 8px 11px; border: 1px solid color-mix(in srgb, var(--ava-success, #22d39a) 42%, transparent); border-radius: 999px; color: var(--ava-success, #22d39a); background: color-mix(in srgb, var(--ava-success, #22d39a) 10%, transparent); font-size: 10px; font-weight: 800; white-space: nowrap; }
        .workspace-preview-grid { display: grid; grid-template-columns: minmax(300px, 1.16fr) minmax(250px, .84fr); gap: 18px; }
        .workspace-preview-card { border: 1px solid var(--ava-border, rgba(180,200,255,.14)); border-radius: 22px; background: var(--ava-surface, rgba(255,255,255,.05)); box-shadow: var(--ava-shadow, 0 18px 60px -22px rgba(0,0,0,.6)); backdrop-filter: blur(22px) saturate(150%); }
        .workspace-preview-dialer { padding: 26px; min-height: 470px; }
        .workspace-preview-card-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--ava-text, #f6f9ff); font-size: 14px; font-weight: 800; }
        .workspace-preview-chip { padding: 5px 9px; border-radius: 999px; color: var(--ava-accent, #6680ff); background: var(--ava-accent-soft, rgba(0,35,230,.22)); font-size: 9px; font-weight: 850; letter-spacing: .09em; text-transform: uppercase; }
        .workspace-preview-number { display: grid; place-items: center; min-height: 76px; margin: 25px auto 18px; padding: 10px 18px; border: 1px solid var(--ava-border-strong, rgba(180,200,255,.28)); border-radius: 18px; background: linear-gradient(155deg, var(--ava-overlay-10, rgba(255,255,255,.1)), var(--ava-overlay-02, rgba(255,255,255,.02))); color: var(--ava-text, #f6f9ff); font-size: 28px; font-weight: 650; letter-spacing: .04em; text-align: center; }
        .workspace-preview-number[data-empty='true'] { color: var(--ava-text-subtle, #8a9bc4); font-size: 15px; font-weight: 700; }
        .workspace-preview-pad { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; max-width: 312px; margin: 0 auto; }
        .workspace-preview-pad button { min-height: 47px; border: 1px solid var(--ava-border-strong, rgba(180,200,255,.28)); border-radius: 14px; background: var(--ava-surface-elev, rgba(255,255,255,.08)); color: var(--ava-text, #f6f9ff); font: 800 17px inherit; cursor: pointer; transition: transform .16s ease, border-color .16s ease, background .16s ease; }
        .workspace-preview-pad button:hover { transform: translateY(-2px); border-color: var(--ava-accent, #6680ff); background: var(--ava-accent-soft, rgba(0,35,230,.22)); }
        .workspace-preview-call-row { display: flex; align-items: center; justify-content: center; gap: 28px; margin-top: 18px; }
        .workspace-preview-call-row button { border: 0; background: transparent; color: var(--ava-text-muted, #b8c6e8); cursor: pointer; font: 800 10px inherit; letter-spacing: .08em; text-transform: uppercase; }
        .workspace-preview-call-row .workspace-preview-call { display: grid; place-items: center; width: 68px; height: 68px; border-radius: 50%; color: #fff; background: var(--ava-accent-gradient, linear-gradient(135deg, #0023e6, #21d4fd)); box-shadow: var(--ava-accent-glow, 0 10px 36px -10px rgba(0,35,230,.6)); font-size: 24px; }
        .workspace-preview-side { display: grid; gap: 18px; }
        .workspace-preview-quick { padding: 20px; }
        .workspace-preview-quick-list { display: grid; gap: 8px; margin-top: 14px; }
        .workspace-preview-action { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 1px solid transparent; border-radius: 13px; background: transparent; color: var(--ava-text, #f6f9ff); font: 700 12px inherit; text-align: left; cursor: pointer; }
        .workspace-preview-action:hover { border-color: var(--ava-border, rgba(180,200,255,.14)); background: var(--ava-overlay-04, rgba(255,255,255,.04)); }
        .workspace-preview-action span { display: grid; place-items: center; width: 29px; height: 29px; border-radius: 10px; color: var(--ava-accent, #6680ff); background: var(--ava-accent-soft, rgba(0,35,230,.22)); }
        .workspace-preview-activity { padding: 20px; }
        .workspace-preview-activity-row { display: flex; align-items: center; gap: 11px; padding: 12px 0; border-bottom: 1px solid var(--ava-border, rgba(180,200,255,.14)); }
        .workspace-preview-activity-row:last-child { border-bottom: 0; }
        .workspace-preview-avatar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 11px; color: #fff; background: linear-gradient(135deg, #4d6dff, #21d4fd); font-size: 12px; font-weight: 850; }
        .workspace-preview-activity-title { color: var(--ava-text, #f6f9ff); font-size: 12px; font-weight: 760; }
        .workspace-preview-activity-sub { margin-top: 2px; color: var(--ava-text-muted, #b8c6e8); font-size: 10px; }
        .workspace-preview-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 18px; color: var(--ava-text-muted, #b8c6e8); font-size: 10px; }
        .workspace-preview-footer button { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; color: var(--ava-accent, #6680ff); font: 800 10px inherit; cursor: pointer; }
        @media (max-width: 880px) { .workspace-preview-shell { grid-template-columns: 1fr; } .workspace-preview-rail { display: block; padding: 14px; border-right: 0; border-bottom: 1px solid rgba(150,185,255,.18); } .workspace-preview-brand, .workspace-preview-status, .workspace-preview-powered { display: none; } .workspace-preview-nav { display: flex; overflow-x: auto; } .workspace-preview-nav button { min-width: max-content; } .workspace-preview-content { padding: 18px; } }
        @media (max-width: 660px) { .workspace-preview-header { min-height: 62px; padding: 0 14px; } .workspace-preview-header h1 { font-size: 16px; } .workspace-preview-theme-switch button { padding: 5px 6px; font-size: 0; } .workspace-preview-theme-switch button::first-letter { font-size: 12px; } .workspace-preview-greeting { display: block; } .workspace-preview-secure { margin-top: 12px; } .workspace-preview-grid { grid-template-columns: 1fr; } .workspace-preview-dialer { min-height: 0; padding: 18px; } }
      `}</style>

      <section className="workspace-preview-shell">
        <aside className="workspace-preview-rail">
          <div className="workspace-preview-brand">
            <LemtelLogo size="sm" glow />
            <div>
              <div className="workspace-preview-brand-title">Lemtel</div>
              <div className="workspace-preview-brand-subtitle">{t('workspace.desktopClient')}</div>
            </div>
          </div>

          <div className="workspace-preview-status">
            <div className="workspace-preview-ready"><span className="workspace-preview-orb" />{t('workspace.lineReady')}</div>
            <div className="workspace-preview-member">Mohamad Hassoun</div>
            <div className="workspace-preview-extension">{t('workspace.extension')} 2001</div>
          </div>

          <nav className="workspace-preview-nav" aria-label={t('workspace.primaryNavigation')}>
            {NAV.map(({ id, label, Icon }) => (
              <button key={id} type="button" aria-current={active === id ? 'page' : undefined} onClick={() => setActive(id)}>
                <span><Icon size={16} strokeWidth={active === id ? 2.6 : 2} /></span>{t(label)}
              </button>
            ))}
          </nav>

          <a className="workspace-preview-powered" href="https://assistantvirtualai.com" target="_blank" rel="noreferrer" aria-label="Powered by AVA — assistantvirtualai.com"><span>{t('workspace.poweredBy')}</span><img src={avaPoweredBy} alt="AVA" /></a>
        </aside>

        <section className="workspace-preview-main">
          <header className="workspace-preview-header">
            <div>
              <div className="workspace-preview-eyebrow">{t('workspace.title')}</div>
              <h1>{activeLabel}</h1>
            </div>
            <AppearanceControls />
          </header>

          <div className="workspace-preview-content">
            <div className="workspace-preview-greeting">
              <div>
                <h2>{t('preview.hello')}, Mohamad.</h2>
                <p>{t('preview.commandCenter')}</p>
              </div>
              <div className="workspace-preview-secure"><span className="workspace-preview-orb" />{t('workspace.secureNetwork')}</div>
            </div>

            <div className="workspace-preview-grid">
              <section className="workspace-preview-card workspace-preview-dialer">
                <div className="workspace-preview-card-title"><span>{t('preview.yourLine')}</span><span className="workspace-preview-chip">{t('preview.extensionReady')}</span></div>
                <div className="workspace-preview-number" data-empty={!dial}>{dial || t('workspace.enterNumber')}</div>
                <div className="workspace-preview-pad">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => <button key={digit} type="button" onClick={() => append(digit)}>{digit}</button>)}
                </div>
                <div className="workspace-preview-call-row">
                  <button type="button" onClick={() => setDial('')}>{t('workspace.clear')}</button>
                  <button type="button" className="workspace-preview-call" aria-label={t('workspace.call')}><Phone size={26} /></button>
                  <button type="button" onClick={() => setDial((current) => current.slice(0, -1))} aria-label={t('workspace.backspace')}>⌫</button>
                </div>
              </section>

              <div className="workspace-preview-side">
                <section className="workspace-preview-card workspace-preview-quick">
                  <div className="workspace-preview-card-title"><span>{t('preview.smartShortcuts')}</span><Sparkles size={16} color="var(--ava-accent, #6680ff)" /></div>
                  <div className="workspace-preview-quick-list">
                    <button className="workspace-preview-action" type="button"><span><Plus size={16} /></span>{t('preview.newMessage')}<ChevronRight size={15} style={{ marginLeft: 'auto' }} /></button>
                    <button className="workspace-preview-action" type="button"><span><History size={16} /></span>{t('preview.reviewRecent')}<ChevronRight size={15} style={{ marginLeft: 'auto' }} /></button>
                    <button className="workspace-preview-action" type="button"><span><Headphones size={16} /></span>{t('preview.callNotes')}<ChevronRight size={15} style={{ marginLeft: 'auto' }} /></button>
                  </div>
                </section>

                <section className="workspace-preview-card workspace-preview-activity">
                  <div className="workspace-preview-card-title"><span>{t('preview.lastActivity')}</span><Bell size={16} color="var(--ava-text-subtle, #8a9bc4)" /></div>
                  <div className="workspace-preview-activity-row"><div className="workspace-preview-avatar">L</div><div><div className="workspace-preview-activity-title">{t('preview.noCalls')}</div><div className="workspace-preview-activity-sub">{t('workspace.lineReady')}</div></div></div>
                  <div className="workspace-preview-activity-row"><div className="workspace-preview-avatar"><Users size={16} /></div><div><div className="workspace-preview-activity-title">{t('preview.teamAvailability')}</div><div className="workspace-preview-activity-sub">{t('preview.fourAvailable')}</div></div></div>
                  <div className="workspace-preview-footer"><span>v2.5.15</span><button type="button"><Search size={13} />{t('workspace.assistant')}</button></div>
                </section>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
