import React from 'react';
import { theme } from '../../lib/theme';
import { useTranslation, type I18nKey } from '../../lib/i18n';

const { colors: c } = theme;

export type StatusVariant =
  | 'connected'
  | 'registered'
  | 'sync-pending'
  | 'sync-failed'
  | 'not-configured'
  | 'online'
  | 'offline'
  | 'busy'
  | 'dnd'
  | 'away';

const MAP: Record<StatusVariant, { fg: string; bg: string; dot: string; key: I18nKey }> = {
  connected:       { fg: c.success, bg: 'rgba(16,185,129,0.12)',  dot: c.success, key: 'status.connected' },
  registered:      { fg: c.success, bg: 'rgba(16,185,129,0.12)',  dot: c.success, key: 'status.registered' },
  'sync-pending':  { fg: c.warning, bg: 'rgba(245,158,11,0.14)',  dot: c.warning, key: 'status.syncPending' },
  'sync-failed':   { fg: c.danger, bg: 'rgba(239,68,68,0.14)',   dot: c.danger, key: 'status.syncFailed' },
  'not-configured':{ fg: c.mutedSilver, bg: c.overlay06, dot: c.mutedSilver, key: 'status.notConfigured' },
  online:          { fg: c.success, bg: 'rgba(16,185,129,0.12)',  dot: c.success, key: 'status.online' },
  offline:         { fg: c.mutedSilver, bg: c.overlay06, dot: c.mutedSilver, key: 'status.offline' },
  busy:            { fg: c.warning, bg: 'rgba(245,158,11,0.14)',  dot: c.warning, key: 'status.busy' },
  dnd:             { fg: c.danger, bg: 'rgba(239,68,68,0.14)',   dot: c.danger, key: 'status.dnd' },
  away:            { fg: c.textDim, bg: 'rgba(148,163,184,0.14)', dot: c.textDim, key: 'status.away' },
};

interface Props {
  variant: StatusVariant;
  label?: string;
  pulse?: boolean;
}

export default function StatusPill({ variant, label, pulse }: Props) {
  const { t } = useTranslation();
  const s = MAP[variant];
  return (
    <span
      role="status"
      aria-label={label ?? t(s.key)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 8px', borderRadius: 999,
        background: s.bg, color: s.fg,
        fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4,
        textTransform: 'uppercase',
        border: `1px solid ${s.fg}33`,
        lineHeight: 1.4,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6, height: 6, borderRadius: '50%', background: s.dot,
          boxShadow: pulse ? `0 0 0 0 ${s.dot}` : undefined,
          animation: pulse ? 'lemtel-pulse 1.6s ease-out infinite' : undefined,
        }}
      />
      {label ?? t(s.key)}
    </span>
  );
}
