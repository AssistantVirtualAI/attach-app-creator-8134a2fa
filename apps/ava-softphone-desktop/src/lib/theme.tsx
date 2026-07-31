import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'daylight' | 'light' | 'dark' | 'midnight';

export interface ThemeTokens {
  mode: ThemeMode;
  bg: string;
  bgGradient: string;
  surface: string;
  surfaceElev: string;
  surfaceHover: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentSoft: string;
  accentGradient: string;
  accentGlow: string;
  success: string;
  danger: string;
  warning: string;
  ringGlow: string;
  glass: string;
  glassBorder: string;
  shadow: string;
}

/* ============================================================
   AVA Statistic — Logo-aligned palette
   Deep brand blue #0023e6 → bright #4d6dff → aurora cyan #21d4fd
   Signal gold #d4a73a for premium accents
   4 modes: daylight (brightest) · light · dark · midnight (darkest)
   ============================================================ */

const daylight: ThemeTokens = {
  mode: 'daylight',
  bg: '#f6f9ff',
  bgGradient:
    'radial-gradient(1200px 700px at 8% -10%, rgba(0,35,230,0.06), transparent 60%), radial-gradient(900px 600px at 110% 110%, rgba(33,212,253,0.06), transparent 55%), linear-gradient(180deg, #ffffff 0%, #f0f5ff 100%)',
  surface: 'rgba(255,255,255,0.92)',
  surfaceElev: 'rgba(255,255,255,0.98)',
  surfaceHover: '#ffffff',
  border: 'rgba(180,196,224,0.45)',
  borderStrong: 'rgba(120,142,184,0.50)',
  text: '#08102a',
  textMuted: '#33425e',
  textSubtle: '#5a6987',
  accent: '#0023e6',
  accentSoft: 'rgba(0,35,230,0.08)',
  accentGradient: 'linear-gradient(135deg, #0023e6 0%, #4d6dff 45%, #21d4fd 100%)',
  accentGlow: '0 8px 24px -12px rgba(0,35,230,0.35)',
  success: '#0f9d58',
  danger: '#dc2626',
  warning: '#d97706',
  ringGlow: '0 0 0 3px rgba(0,35,230,0.18)',
  glass: 'rgba(255,255,255,0.92)',
  glassBorder: 'rgba(180,196,224,0.45)',
  shadow: '0 1px 2px rgba(11,21,48,0.04), 0 8px 24px -12px rgba(11,21,48,0.12)',
};

const light: ThemeTokens = {
  mode: 'light',
  bg: '#eef2fa',
  bgGradient:
    'radial-gradient(1200px 700px at 8% -10%, rgba(0,35,230,0.10), transparent 60%), radial-gradient(900px 600px at 110% 110%, rgba(33,212,253,0.10), transparent 55%), linear-gradient(180deg, #eef2fa 0%, #dde4f1 100%)',
  surface: 'rgba(255,255,255,0.82)',
  surfaceElev: 'rgba(255,255,255,0.92)',
  surfaceHover: 'rgba(255,255,255,0.98)',
  border: 'rgba(180,196,224,0.55)',
  borderStrong: 'rgba(120,142,184,0.55)',
  text: '#08102a',
  textMuted: '#293756',
  textSubtle: '#54648a',
  accent: '#0023e6',
  accentSoft: 'rgba(0,35,230,0.10)',
  accentGradient: 'linear-gradient(135deg, #0023e6 0%, #4d6dff 45%, #21d4fd 100%)',
  accentGlow: '0 10px 30px -12px rgba(0,35,230,0.45)',
  success: '#0f9d58',
  danger: '#dc2626',
  warning: '#d97706',
  ringGlow: '0 0 0 3px rgba(0,35,230,0.22)',
  glass: 'rgba(255,255,255,0.80)',
  glassBorder: 'rgba(180,196,224,0.55)',
  shadow: '0 1px 2px rgba(11,21,48,0.06), 0 10px 28px -12px rgba(11,21,48,0.18)',
};

const dark: ThemeTokens = {
  mode: 'dark',
  bg: '#0b1124',
  bgGradient:
    'radial-gradient(1200px 700px at 8% -10%, rgba(0,35,230,0.22), transparent 60%), radial-gradient(900px 600px at 110% 110%, rgba(33,212,253,0.14), transparent 55%), linear-gradient(180deg, #0b1124 0%, #131a35 100%)',
  surface: 'rgba(255,255,255,0.05)',
  surfaceElev: 'rgba(255,255,255,0.08)',
  surfaceHover: 'rgba(255,255,255,0.12)',
  border: 'rgba(180,200,255,0.14)',
  borderStrong: 'rgba(180,200,255,0.28)',
  text: '#f3f7ff',
  textMuted: '#b8c6e8',
  textSubtle: '#8a9bc4',
  accent: '#6680ff',
  accentSoft: 'rgba(0,35,230,0.22)',
  accentGradient: 'linear-gradient(135deg, #0023e6 0%, #4d6dff 45%, #21d4fd 100%)',
  accentGlow: '0 10px 36px -10px rgba(0,35,230,0.60)',
  success: '#22d39a',
  danger: '#ff5577',
  warning: '#ffb84a',
  ringGlow: '0 0 0 3px rgba(102,128,255,0.32)',
  glass: 'rgba(20,28,56,0.55)',
  glassBorder: 'rgba(180,200,255,0.16)',
  shadow: '0 18px 60px -22px rgba(0,0,0,0.6)',
};

const midnight: ThemeTokens = {
  mode: 'midnight',
  bg: '#05081a',
  bgGradient:
    'radial-gradient(1200px 700px at 8% -10%, rgba(0,35,230,0.32), transparent 60%), radial-gradient(900px 600px at 110% 110%, rgba(33,212,253,0.22), transparent 55%), linear-gradient(180deg, #03050f 0%, #080d24 100%)',
  surface: 'rgba(12,18,40,0.62)',
  surfaceElev: 'rgba(18,26,54,0.78)',
  surfaceHover: 'rgba(28,38,72,0.85)',
  border: 'rgba(150,180,255,0.18)',
  borderStrong: 'rgba(150,180,255,0.34)',
  text: '#f6f9ff',
  textMuted: '#bccaed',
  textSubtle: '#8fa1ca',
  accent: '#8aa0ff',
  accentSoft: 'rgba(138,160,255,0.16)',
  accentGradient: 'linear-gradient(135deg, #2240ff 0%, #6680ff 45%, #21d4fd 100%)',
  accentGlow: '0 14px 44px -10px rgba(102,128,255,0.70)',
  success: '#22d39a',
  danger: '#ff5577',
  warning: '#ffb84a',
  ringGlow: '0 0 0 3px rgba(138,160,255,0.38)',
  glass: 'rgba(12,18,40,0.62)',
  glassBorder: 'rgba(150,180,255,0.20)',
  shadow: '0 24px 70px -22px rgba(0,0,0,0.85)',
};

const themeMap: Record<ThemeMode, ThemeTokens> = { daylight, light, dark, midnight };

interface ThemeCtx {
  t: ThemeTokens;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);
const STORAGE_KEY = 'ava-softphone-theme';
const cycle: ThemeMode[] = ['daylight', 'light', 'dark', 'midnight'];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      // One-time migration: the app now ships a bright, high-contrast default.
      if (!localStorage.getItem('ava-softphone-theme-v2')) {
        localStorage.setItem('ava-softphone-theme-v2', '1');
        localStorage.setItem(STORAGE_KEY, 'light');
        return 'light';
      }
      const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      if (saved && cycle.includes(saved)) return saved;
    } catch {}
    return 'light';
  });


  const t = themeMap[mode] ?? light;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
    const root = document.documentElement;
    root.setAttribute('data-ava-theme', mode);
    // Push every token to a CSS variable so the static `theme` export and
    // any raw consumer of `var(--ava-…)` repaint instantly on mode change.
    const set = (k: string, val: string) => root.style.setProperty(`--ava-${k}`, val);
    set('bg', t.bg);
    set('bg-gradient', t.bgGradient);
    set('surface', t.surface);
    set('surface-elev', t.surfaceElev);
    set('surface-hover', t.surfaceHover);
    set('border', t.border);
    set('border-strong', t.borderStrong);
    set('text', t.text);
    set('text-muted', t.textMuted);
    set('text-subtle', t.textSubtle);
    set('accent', t.accent);
    set('accent-soft', t.accentSoft);
    set('accent-gradient', t.accentGradient);
    set('accent-glow', t.accentGlow);
    set('success', t.success);
    set('danger', t.danger);
    set('warning', t.warning);
    set('ring-glow', t.ringGlow);
    set('glass', t.glass);
    set('glass-border', t.glassBorder);
    set('shadow', t.shadow);
    // Global background uses the themed gradient (fixed so it never scrolls).
    root.style.background = t.bgGradient;
    root.style.backgroundColor = t.bg;
    root.style.backgroundAttachment = 'fixed';
    root.style.color = t.text;
    document.body.style.background = t.bgGradient;
    document.body.style.backgroundColor = t.bg;
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.color = t.text;

  }, [mode, t]);


  // Cross-document sync: when the parent (or any same-origin doc) writes the
  // theme key, iframes/other windows pick it up live — used by the responsive
  // audit overlay so all preview widths track the active theme instantly.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      if (cycle.includes(e.newValue as ThemeMode) && e.newValue !== mode) {
        setModeState(e.newValue as ThemeMode);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [mode]);

  const setMode = (m: ThemeMode) => setModeState(m);
  const toggle = () =>
    setModeState((m) => cycle[(cycle.indexOf(m) + 1) % cycle.length]);

  return (
    <ThemeContext.Provider value={{ t, mode, setMode, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}


/* ============================================================
   Static design tokens consumed via `import { theme } from '../lib/theme'`.
   Values resolve to CSS variables at runtime so flipping the active
   ThemeMode in <ThemeProvider> instantly repaints every component
   that consumes this static export — no refactors needed.
   ============================================================ */
const v = (name: string, fallback: string) => `var(--ava-${name}, ${fallback})`;

export const theme = {
  colors: {
    bg: v('bg', '#eef2fa'),
    bgGradient: v('bg-gradient',
      'radial-gradient(1200px 700px at 8% -10%, rgba(0,35,230,0.10), transparent 60%), radial-gradient(900px 600px at 110% 110%, rgba(33,212,253,0.10), transparent 55%), linear-gradient(180deg, #eef2fa 0%, #dde4f1 100%)'),
    bgMesh:
      'radial-gradient(1000px 600px at 8% -10%, rgba(0,35,230,0.08), transparent 60%), radial-gradient(900px 600px at 110% 110%, rgba(33,212,253,0.08), transparent 55%)',
    bgCard: v('surface', 'rgba(255,255,255,0.85)'),
    bgCardHover: v('surface-hover', 'rgba(255,255,255,0.95)'),
    bgElev: v('surface-elev', 'rgba(255,255,255,0.92)'),
    border: v('border', 'rgba(180,196,224,0.55)'),
    borderStrong: v('border-strong', 'rgba(120,142,184,0.55)'),
    borderGold: 'rgba(224,193,120,0.70)',
    borderAI: 'rgba(191,176,255,0.70)',

    primary: v('accent', '#0023e6'),
    primaryLight: '#4d6dff',
    primarySoft: v('accent-soft', 'rgba(0,35,230,0.10)'),
    cyan: '#21d4fd',

    gold: '#d4a73a',
    goldSoft: '#e8c878',
    goldDim: '#fff3d6',
    ai: '#7a4cff',
    aiLight: '#a78bfa',
    aiGlow: 'rgba(122,76,255,0.20)',

    green: v('success', '#0f9d58'),
    red: v('danger', '#dc2626'),
    yellow: v('warning', '#d97706'),
    success: v('success', '#0f9d58'),
    warning: v('warning', '#d97706'),
    danger: v('danger', '#dc2626'),

    text: v('text', '#0b1530'),
    textSub: v('text-muted', '#3b4a6b'),
    textDim: v('text-subtle', '#7d8aa6'),

    midnight: v('bg', '#eef2fa'),
    deepPanel: v('surface', 'rgba(255,255,255,0.78)'),
    graphite: v('surface-elev', 'rgba(245,247,252,0.88)'),
    lemtelBlue: v('accent', '#0023e6'),
    signalGold: '#d4a73a',
    avaCyan: '#0891b2',
    avaViolet: '#7a4cff',
    textIce: v('text', '#0b1530'),
    mutedSilver: v('text-muted', '#5e6c8a'),

    /* Foreground used on top of saturated accent/danger/success fills.
       Constant by design — it must stay readable in every theme. */
    onAccent: v('on-accent', '#ffffff'),
    /* Translucent surface overlays (theme-aware: white on dark, ink on light). */
    overlay02: v('overlay-02', 'rgba(255,255,255,0.02)'),
    overlay04: v('overlay-04', 'rgba(255,255,255,0.04)'),
    overlay06: v('overlay-06', 'rgba(255,255,255,0.06)'),
    overlay08: v('overlay-08', 'rgba(255,255,255,0.08)'),
    overlay10: v('overlay-10', 'rgba(255,255,255,0.10)'),
    overlay12: v('overlay-12', 'rgba(255,255,255,0.12)'),
    overlay18: v('overlay-18', 'rgba(255,255,255,0.18)'),
  },

  gradients: {
    aurora: v('accent-gradient', 'linear-gradient(135deg, #0023e6 0%, #4d6dff 45%, #21d4fd 100%)'),
    auroraSubtle: 'linear-gradient(135deg, rgba(0,35,230,0.18), rgba(33,212,253,0.12))',
    goldEdge: 'linear-gradient(135deg, #d4a73a, #e8c878 60%, #fff3d6)',
    mesh:
      'radial-gradient(1000px 600px at 8% -10%, rgba(0,35,230,0.08), transparent 60%), radial-gradient(900px 600px at 110% 110%, rgba(33,212,253,0.08), transparent 55%)',
  },
  glow: {
    gold: '0 8px 22px -10px rgba(212,167,58,0.45)',
    blue: v('accent-glow', '0 10px 30px -12px rgba(0,35,230,0.45)'),
    blueStrong: '0 18px 44px -18px rgba(0,35,230,0.55)',
    ai: '0 10px 26px -10px rgba(122,76,255,0.35)',
    green: '0 8px 20px -8px rgba(15,157,88,0.40)',
    red: '0 8px 20px -8px rgba(220,38,38,0.40)',
  },
  glass: {
    card: {
      background: v('glass', 'rgba(255,255,255,0.82)'),
      border: `1px solid ${v('glass-border', 'rgba(180,196,224,0.55)')}`,
      borderRadius: 18,
      boxShadow: '0 1px 2px rgba(11,21,48,0.06), 0 10px 28px -12px rgba(11,21,48,0.18), inset 0 1px 0 rgba(255,255,255,0.08)',
      backdropFilter: 'blur(20px) saturate(150%)',
      WebkitBackdropFilter: 'blur(20px) saturate(150%)',
    } as React.CSSProperties,
    cardGold: {
      background: v('glass', 'rgba(255,255,255,0.82)'),
      border: '1px solid rgba(224,193,120,0.70)',
      borderRadius: 18,
      boxShadow: '0 10px 26px -14px rgba(212,167,58,0.40), inset 0 1px 0 rgba(255,255,255,0.10)',
      backdropFilter: 'blur(20px) saturate(150%)',
      WebkitBackdropFilter: 'blur(20px) saturate(150%)',
    } as React.CSSProperties,
    cardAI: {
      background: v('glass', 'rgba(255,255,255,0.82)'),
      border: '1px solid rgba(191,176,255,0.70)',
      borderRadius: 18,
      boxShadow: '0 10px 26px -14px rgba(122,76,255,0.35), inset 0 1px 0 rgba(255,255,255,0.10)',
      backdropFilter: 'blur(20px) saturate(150%)',
      WebkitBackdropFilter: 'blur(20px) saturate(150%)',
    } as React.CSSProperties,
    nav: {
      background: v('glass', 'rgba(255,255,255,0.72)'),
      borderRight: `1px solid ${v('glass-border', 'rgba(180,196,224,0.55)')}`,
      backdropFilter: 'blur(22px) saturate(160%)',
      WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    } as React.CSSProperties,
    dock: {
      background: v('glass', 'rgba(255,255,255,0.88)'),
      border: `1px solid ${v('glass-border', 'rgba(180,196,224,0.70)')}`,
      borderRadius: 22,
      boxShadow: '0 24px 60px -22px rgba(0,35,230,0.40), 0 2px 6px rgba(11,21,48,0.08), inset 0 1px 0 rgba(255,255,255,0.10)',
      backdropFilter: 'blur(24px) saturate(170%)',
      WebkitBackdropFilter: 'blur(24px) saturate(170%)',
    } as React.CSSProperties,
  },
  motion: {
    fast: '160ms cubic-bezier(.2,.7,.2,1)',
    base: '240ms cubic-bezier(.2,.7,.2,1)',
    slow: '360ms cubic-bezier(.2,.7,.2,1)',
  },
  font: {
    display: "'Space Grotesk', 'DM Sans', sans-serif",
    body: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    xs: 11, sm: 12, base: 14, md: 16, lg: 20, xl: 24, xxl: 32, displaySize: 40,
  },
  radius: { sm: 8, md: 12, lg: 18, xl: 22, pill: 999 },
} as const;

