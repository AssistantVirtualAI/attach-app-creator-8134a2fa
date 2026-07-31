import React from 'react';
import { useTranslation, type DesktopLang } from '../../lib/i18n';
import { theme } from '../../lib/theme';

const { colors: c } = theme;

export default function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const { lang, setLang } = useTranslation();
  const opts: DesktopLang[] = ['en', 'fr'];
  return (
    <div
      role="group"
      aria-label="Language"
      style={{
        display: 'inline-flex', gap: 2, padding: 2,
        background: 'rgba(140,180,255,0.06)',
        border: `1px solid ${c.border}`,
        borderRadius: 999,
        fontSize: compact ? 9.5 : 10.5,
      }}
    >
      {opts.map((o) => {
        const active = lang === o;
        return (
          <button
            key={o}
            onClick={() => setLang(o)}
            aria-pressed={active}
            style={{
              padding: compact ? '2px 8px' : '3px 10px',
              borderRadius: 999, border: 'none', cursor: 'pointer',
              background: active ? `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})` : 'transparent',
              color: active ? c.onAccent : c.mutedSilver,
              fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase',
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
