import React, { useState } from 'react';
import { Accessibility, BellRing, MonitorCog, Moon, Power, SlidersHorizontal, Sun } from 'lucide-react';
import { useTheme, USER_THEME_MODES } from '../lib/theme';
import { useBrightness, type Brightness } from '../hooks/useBrightness';
import { useContrast, type Contrast } from '../hooks/useContrast';
import { useTranslation, type I18nKey } from '../lib/i18n';
import LanguageSwitcher from './ui/LanguageSwitcher';

const brightnessChoices: Array<{ value: Brightness; label: I18nKey }> = [
  { value: 'dim', label: 'workspace.dim' },
  { value: 'medium', label: 'workspace.medium' },
  { value: 'bright', label: 'workspace.bright' },
];

const contrastChoices: Array<{ value: Contrast; label: I18nKey }> = [
  { value: 'low', label: 'workspace.low' },
  { value: 'med', label: 'workspace.medium' },
  { value: 'high', label: 'workspace.high' },
];

/**
 * Preferences that are functional without a SIP manifest: appearance,
 * accessibility and the Desktop launch behavior. Call-specific options are
 * visible as a truthful capability boundary instead of non-working controls.
 */
export default function DesktopWorkspacePreferences() {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  const { brightness, setBrightness } = useBrightness();
  const { contrast, setContrast } = useContrast();
  const [launchOnStartup, setLaunchOnStartup] = useState(() => {
    try { return localStorage.getItem('lemtel.launchOnStartup') === 'on'; } catch { return false; }
  });
  const [saved, setSaved] = useState(false);

  const flashSaved = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };
  const chooseLaunchOnStartup = (next: boolean) => {
    setLaunchOnStartup(next);
    try { localStorage.setItem('lemtel.launchOnStartup', next ? 'on' : 'off'); } catch {}
    void window.electronAPI?.setLaunchOnStartup?.(next).catch(() => undefined);
    flashSaved();
  };

  return (
    <section className="desktop-workspace-preferences" data-testid="lemtel-desktop-preferences-page" aria-live="polite">
      <div className="desktop-preferences-heading">
        <div className="desktop-preferences-heading-icon"><SlidersHorizontal size={23} /></div>
        <div>
          <p>{t('workspace.readOnlyWorkspace')}</p>
          <h2>{t('workspace.preferencesTitle')}</h2>
          <span>{t('workspace.preferencesBody')}</span>
        </div>
        {saved && <em>{t('workspace.preferencesSaved')}</em>}
      </div>

      <div className="desktop-preferences-grid">
        <section className="desktop-preferences-card">
          <div className="desktop-preferences-card-title"><MonitorCog size={17} /><div><strong>{t('workspace.appearance')}</strong><span>{t('workspace.themeAndDisplay')}</span></div></div>
          <div className="desktop-preferences-row"><span>{t('workspace.theme')}</span><div className="desktop-preferences-options">{USER_THEME_MODES.map((candidate) => <button key={candidate} type="button" aria-pressed={mode === candidate} onClick={() => { setMode(candidate); flashSaved(); }}><span>{candidate === 'daylight' ? <Sun size={14} /> : <Moon size={14} />}</span>{candidate === 'daylight' ? t('workspace.daylight') : t('workspace.dark')}</button>)}</div></div>
          <div className="desktop-preferences-row"><span>{t('workspace.language')}</span><LanguageSwitcher /></div>
        </section>

        <section className="desktop-preferences-card">
          <div className="desktop-preferences-card-title"><Accessibility size={17} /><div><strong>{t('workspace.accessibility')}</strong><span>{t('workspace.themeAndDisplay')}</span></div></div>
          <ChoiceRow label={t('workspace.brightness')} current={brightness} choices={brightnessChoices} onChange={(value) => { setBrightness(value); flashSaved(); }} />
          <ChoiceRow label={t('workspace.contrast')} current={contrast} choices={contrastChoices} onChange={(value) => { setContrast(value); flashSaved(); }} />
        </section>

        <section className="desktop-preferences-card">
          <div className="desktop-preferences-card-title"><Power size={17} /><div><strong>{t('workspace.desktopClient')}</strong><span>{t('workspace.startOnLaunchBody')}</span></div></div>
          <button className="desktop-preferences-toggle" type="button" role="switch" aria-checked={launchOnStartup} onClick={() => chooseLaunchOnStartup(!launchOnStartup)}>
            <span><strong>{t('workspace.startOnLaunch')}</strong><small>{t('workspace.startOnLaunchBody')}</small></span>
            <i aria-hidden />
          </button>
        </section>

        <section className="desktop-preferences-card desktop-preferences-card-boundary">
          <div className="desktop-preferences-card-title"><BellRing size={17} /><div><strong>{t('workspace.callExperience')}</strong><span>{t('workspace.telephonyPending')}</span></div></div>
          <p>{t('workspace.callExperienceBody')}</p>
          <div>{t('workspace.noProtectedData')}</div>
        </section>
      </div>
    </section>
  );
}

function ChoiceRow<T extends string>({ label, current, choices, onChange }: {
  label: string;
  current: T;
  choices: Array<{ value: T; label: I18nKey }>;
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="desktop-preferences-row desktop-preferences-choice-row">
      <span>{label}</span>
      <div className="desktop-preferences-options">
        {choices.map(({ value, label: choiceLabel }) => <button key={value} type="button" aria-pressed={current === value} onClick={() => onChange(value)}>{t(choiceLabel)}</button>)}
      </div>
    </div>
  );
}
