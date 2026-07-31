import React from 'react';
import { theme } from '../../lib/theme';
import { useTranslation } from '../../lib/i18n';

const { colors: c } = theme;

type Mode = 'loading' | 'empty' | 'error';

interface Props {
  mode: Mode;
  title?: string;
  hint?: string;
  icon?: React.ReactNode;
  onRetry?: () => void;
}

export default function StateView({ mode, title, hint, icon, onRetry }: Props) {
  const { t } = useTranslation();
  const heading =
    title ??
    (mode === 'loading' ? t('state.loading') : mode === 'empty' ? t('state.empty') : t('state.error'));

  return (
    <div
      role={mode === 'error' ? 'alert' : 'status'}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 12, padding: 32, minHeight: 220, textAlign: 'center', color: c.mutedSilver,
      }}
    >
      {mode === 'loading' ? (
        <div
          aria-hidden
          style={{
            width: 36, height: 36, borderRadius: '50%',
            border: `2px solid ${c.border}`,
            borderTopColor: c.signalGold,
            animation: 'lemtel-spin 0.9s linear infinite',
          }}
        />
      ) : (
        <div style={{ fontSize: 32, opacity: 0.7 }}>{icon ?? (mode === 'error' ? '⚠' : '∅')}</div>
      )}
      <div style={{ fontSize: 14, color: c.textIce, fontWeight: 600 }}>{heading}</div>
      {hint && <div style={{ fontSize: 12, maxWidth: 360 }}>{hint}</div>}
      {mode === 'error' && onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: 6, padding: '7px 14px', borderRadius: 8,
            border: `1px solid ${c.border}`, background: c.overlay04,
            color: c.textIce, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {t('state.retry')}
        </button>
      )}
    </div>
  );
}
