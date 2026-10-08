import type React from 'react';

/**
 * Lemtel product tokens shared by the native iOS and Android shells.
 *
 * These values intentionally mirror Desktop's public Dark and Daylight modes:
 * deep Lemtel blue, aurora cyan, restrained signal gold, soft glass surfaces,
 * and high-contrast foreground text.  The runtime proxy lets legacy screens
 * consume `colors.*` while still repainting when the user switches theme.
 */
export const darkColors = {
  midnight: '#0b1124',
  midnight2: '#131a35',
  graphite: 'rgba(255,255,255,0.05)',
  graphite2: 'rgba(255,255,255,0.08)',
  lemtelBlue: '#6680ff',
  blueGlow: '#4d6dff',
  signalGold: '#d4a73a',
  goldSoft: '#e8c878',
  avaCyan: '#21d4fd',
  avaViolet: '#7a4cff',
  textIce: '#f3f7ff',
  textSub: '#b8c6e8',
  mutedSilver: '#8a9bc4',
  mint: '#22d39a',
  navSurface: 'rgba(20,28,56,0.78)',
  border: 'rgba(180,200,255,0.14)',
  borderGold: 'rgba(212,167,58,0.42)',
  borderAI: 'rgba(33,212,253,0.30)',
  danger: '#ff5577',
  success: '#22d39a',
  warning: '#ffb84a',
};

export type ColorTokens = typeof darkColors;

/** Daylight is the native equivalent of Desktop's `daylight` mode. */
export const lightColors: ColorTokens = {
  midnight: '#f6f9ff',
  midnight2: '#eef4ff',
  graphite: 'rgba(255,255,255,0.92)',
  graphite2: 'rgba(255,255,255,0.98)',
  lemtelBlue: '#0023e6',
  blueGlow: '#4d6dff',
  signalGold: '#b77916',
  goldSoft: '#d4a73a',
  avaCyan: '#0b91bb',
  avaViolet: '#6544d8',
  textIce: '#08102a',
  textSub: '#33425e',
  mutedSilver: '#5a6987',
  mint: '#047857',
  navSurface: 'rgba(255,255,255,0.86)',
  border: 'rgba(180,196,224,0.45)',
  borderGold: 'rgba(183,121,22,0.38)',
  borderAI: 'rgba(11,145,187,0.28)',
  danger: '#dc2626',
  success: '#0f9d58',
  warning: '#d97706',
};

function currentPalette(): ColorTokens {
  if (typeof document !== 'undefined') {
    const mode = document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme');
    if (mode === 'light') return lightColors;
  }
  return darkColors;
}

/** Runtime-resolving palette. Never destructure it at module scope. */
export const colors: ColorTokens = new Proxy({} as ColorTokens, {
  get(_target, prop: string) { return (currentPalette() as Record<string, string>)[prop]; },
  has(_target, prop: string) { return prop in darkColors; },
  ownKeys() { return Reflect.ownKeys(darkColors); },
  getOwnPropertyDescriptor(_target, prop: string) {
    return { enumerable: true, configurable: true, value: (currentPalette() as Record<string, string>)[prop] };
  },
}) as ColorTokens;

type GradientKey = 'app' | 'call' | 'ai' | 'card' | 'hero' | 'shiny' | 'shinyPrimary';
function activeGradients(): Record<GradientKey, string> {
  const c = currentPalette();
  const daylight = c === lightColors;
  return {
    app: daylight
      ? 'radial-gradient(1200px 700px at 8% -10%, rgba(0,35,230,0.06), transparent 60%), radial-gradient(900px 600px at 110% 110%, rgba(33,212,253,0.06), transparent 55%), linear-gradient(180deg, #ffffff 0%, #f0f5ff 100%)'
      : 'radial-gradient(1200px 700px at 8% -10%, rgba(0,35,230,0.22), transparent 60%), radial-gradient(900px 600px at 110% 110%, rgba(33,212,253,0.14), transparent 55%), linear-gradient(180deg, #0b1124 0%, #131a35 100%)',
    call: 'linear-gradient(135deg, #0023e6 0%, #4d6dff 46%, #21d4fd 100%)',
    ai: 'linear-gradient(135deg, #0023e6 0%, #4d6dff 50%, #21d4fd 100%)',
    card: daylight
      ? 'linear-gradient(155deg, rgba(255,255,255,0.98) 0%, rgba(247,250,255,0.90) 100%)'
      : 'linear-gradient(155deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.035) 100%)',
    hero: daylight
      ? 'linear-gradient(145deg, rgba(0,35,230,0.12) 0%, rgba(77,109,255,0.06) 46%, rgba(33,212,253,0.10) 100%)'
      : 'linear-gradient(145deg, rgba(0,35,230,0.36) 0%, rgba(77,109,255,0.16) 48%, rgba(33,212,253,0.12) 100%)',
    shiny: daylight
      ? 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(246,249,255,0.90))'
      : 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.045) 45%, rgba(255,255,255,0.09) 100%)',
    shinyPrimary: 'linear-gradient(135deg, #0023e6 0%, #4d6dff 48%, #21d4fd 100%)',
  };
}

/** Gradients are dynamic so Daylight never inherits a dark background. */
export const gradients = new Proxy({} as Record<GradientKey, string>, {
  get(_target, prop: GradientKey) { return activeGradients()[prop]; },
  ownKeys() { return Object.keys(activeGradients()); },
  getOwnPropertyDescriptor(_target, prop: GradientKey) {
    return { enumerable: true, configurable: true, value: activeGradients()[prop] };
  },
}) as Readonly<Record<GradientKey, string>>;

export const radius = { sm: 8, md: 12, lg: 18, xl: 22, xxl: 26, pill: 999 } as const;
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 32, 8: 40 } as const;
export const font = {
  family: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  display: "'Space Grotesk', 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
  xs: 11, sm: 12, base: 14, md: 16, lg: 20, xl: 24, xxl: 32, displaySize: 40,
} as const;

export const shadow = {
  card: '0 1px 2px rgba(11,21,48,0.06), 0 12px 30px -18px rgba(11,21,48,0.22)',
  lift: '0 22px 54px -26px rgba(0,35,230,0.52)',
  gold: '0 12px 28px -16px rgba(212,167,58,0.42)',
  ai: '0 14px 32px -18px rgba(0,35,230,0.48)',
  glass: '0 1px 2px rgba(11,21,48,0.05), 0 14px 32px -20px rgba(11,21,48,0.32), inset 0 1px 0 rgba(255,255,255,0.09)',
} as const;

export const glass = {
  surface: {
    background: gradients.card,
    border: `1px solid ${colors.border}`,
    backdropFilter: 'blur(20px) saturate(150%)',
    WebkitBackdropFilter: 'blur(20px) saturate(150%)',
    boxShadow: shadow.card,
    borderRadius: radius.lg,
  } as React.CSSProperties,
} as const;

/** Compatibility export used by existing light-theme checks and legacy screens. */
export const lightTheme = {
  background: '#f6f9ff',
  backgroundSecondary: '#eef4ff',
  surface: '#ffffff',
  surfaceHover: '#ffffff',
  textPrimary: '#08102a',
  textSecondary: '#33425e',
  textMuted: '#5a6987',
  textDisabled: '#8492aa',
  border: 'rgba(180,196,224,0.45)',
  borderFocus: '#0023e6',
  divider: 'rgba(180,196,224,0.30)',
  accent: '#0023e6',
  accentLight: 'rgba(0,35,230,0.08)',
  accentText: '#ffffff',
  statusOnline: '#0f9d58', statusBusy: '#dc2626', statusAway: '#d97706', statusOffline: '#8492aa',
  cardBg: '#ffffff', cardBorder: 'rgba(180,196,224,0.45)', cardShadow: shadow.card,
  inputBg: '#ffffff', inputBorder: 'rgba(180,196,224,0.55)', inputBorderFocus: '#0023e6', inputText: '#08102a', inputPlaceholder: '#8492aa',
  navBg: '#ffffff', navBorder: 'rgba(180,196,224,0.40)', navIconActive: '#0023e6', navIconInactive: '#5a6987', navLabelActive: '#0023e6', navLabelInactive: '#5a6987', navActiveBg: 'rgba(0,35,230,0.08)',
  btnPrimaryBg: '#0023e6', btnPrimaryText: '#ffffff', btnSecondaryBg: 'rgba(0,35,230,0.08)', btnSecondaryText: '#0023e6', btnSecondaryBorder: 'rgba(0,35,230,0.25)', btnDangerBg: '#fee2e2', btnDangerText: '#dc2626',
  headerBg: '#ffffff', headerBorder: 'rgba(180,196,224,0.40)', headerText: '#08102a', headerShadow: shadow.card,
  pillBg: 'rgba(0,35,230,0.08)', pillText: '#0023e6', pillBorder: 'rgba(0,35,230,0.20)',
  badgeSuccessBg: '#dcfce7', badgeSuccessText: '#0f9d58', badgeErrorBg: '#fee2e2', badgeErrorText: '#dc2626', badgeWarningBg: '#fef3c7', badgeWarningText: '#a16207', badgeInfoBg: '#dbeafe', badgeInfoText: '#1d4ed8',
  listItemBg: '#ffffff', listItemBorder: 'rgba(180,196,224,0.30)', listItemHover: '#f7f9ff',
  liveBadgeBg: '#dcfce7', liveBadgeText: '#0f9d58', liveBadgeDot: '#0f9d58',
  statTotal: '#0023e6', statAnswered: '#0f9d58', statMissed: '#dc2626', statVoicemail: '#d97706', statRate: '#6544d8', statDuration: '#0b91bb', statActive: '#b77916', statOnline: '#047857',
} as const;
export type LightTheme = typeof lightTheme;
