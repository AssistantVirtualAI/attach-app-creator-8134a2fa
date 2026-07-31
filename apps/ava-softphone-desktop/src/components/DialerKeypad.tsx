import React, { useCallback, useEffect, useRef, useState } from 'react';
import { theme } from '../lib/theme';

const { colors: c } = theme;

export type DialerDensity = 'spacious' | 'compact' | 'ultra';

/* ============================================================
   Dialer density tokens — locked sizing so digit + sub-letter
   baselines remain pixel-aligned across every theme mode.
   Themes can change color/shadow/weight but never the rows
   declared here, which guarantees visual stability.
   ============================================================ */
export const DIALER_TOKENS: Record<DialerDensity, {
  keyH: number;
  gap: number;
  digitRow: number;
  subRow: number;
  rowGap: number;
  digit: number;
  sub: number;
  radius: number;
  gridMax: number;
  pad: number;
}> = {
  spacious: { keyH: 72, gap: 14, digitRow: 30, subRow: 12, rowGap: 4, digit: 26, sub: 8.5, radius: 14, gridMax: 296, pad: 0 },
  compact:  { keyH: 58, gap: 8,  digitRow: 26, subRow: 12, rowGap: 4, digit: 23, sub: 8.5, radius: 14, gridMax: 296, pad: 0 },
  ultra:    { keyH: 50, gap: 6,  digitRow: 22, subRow: 0,  rowGap: 0, digit: 20, sub: 0,   radius: 12, gridMax: 248, pad: 4 },
};

export const DEFAULT_DIAL_KEYS: [string, string][] = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

/* ============================================================
   Persistence for keyboard focus across density/theme remounts.
   - We remember the last key character that was focused.
   - We remember whether focus was *inside* the keypad when the
     previous instance unmounted; only then do we auto-restore,
     so we never steal focus from elsewhere on the page.
   ============================================================ */
const FOCUS_KEY_STORAGE = 'ava.dialer.lastFocusedKey';
const FOCUS_ACTIVE_STORAGE = 'ava.dialer.focusActive';

const readPersistedFocus = (): { key: string | null; active: boolean } => {
  try {
    return {
      key: sessionStorage.getItem(FOCUS_KEY_STORAGE),
      active: sessionStorage.getItem(FOCUS_ACTIVE_STORAGE) === '1',
    };
  } catch {
    return { key: null, active: false };
  }
};

const writePersistedFocus = (key: string | null, active: boolean) => {
  try {
    if (key) sessionStorage.setItem(FOCUS_KEY_STORAGE, key);
    sessionStorage.setItem(FOCUS_ACTIVE_STORAGE, active ? '1' : '0');
  } catch { /* ignore */ }
};

/* Accessible spoken names for non-digit / symbol keys. */
const SPOKEN_NAMES: Record<string, string> = {
  '*': 'star',
  '#': 'pound',
  '+': 'plus',
  '0': 'zero',
};

const spokenFor = (key: string, sub: string): string => {
  const name = SPOKEN_NAMES[key] ?? key;
  if (key === '0' && sub === '+') return 'zero, hold for plus';
  if (sub) return `${name}, ${sub.split('').join(' ')}`;
  return name;
};

type Props = {
  keys?: [string, string][];
  density?: DialerDensity;
  onKey: (k: string) => void;
  onBackspace?: () => void;
  onSubmit?: () => void;
  'data-baseline-check'?: string;
};

export default function DialerKeypad({
  keys = DEFAULT_DIAL_KEYS,
  density = 'spacious',
  onKey,
  onBackspace,
  onSubmit,
  ...rest
}: Props) {
  const t = DIALER_TOKENS[density];
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const COLS = 3;

  // Live-region announcement of the most recent activation.
  const [announcement, setAnnouncement] = useState('');

  const focusAt = (i: number) => {
    const clamped = Math.max(0, Math.min(keys.length - 1, i));
    btnRefs.current[clamped]?.focus();
  };

  const handleActivate = useCallback(
    (key: string, sub: string) => {
      onKey(key);
      // Re-trigger announcement even for repeated keys by resetting first.
      setAnnouncement('');
      // Defer so screen readers register the change.
      requestAnimationFrame(() => setAnnouncement(`Dialed ${spokenFor(key, sub)}`));
    },
    [onKey],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); focusAt(i + 1); return;
        case 'ArrowLeft':  e.preventDefault(); focusAt(i - 1); return;
        case 'ArrowDown':  e.preventDefault(); focusAt(i + COLS); return;
        case 'ArrowUp':    e.preventDefault(); focusAt(i - COLS); return;
        case 'Home':       e.preventDefault(); focusAt(0); return;
        case 'End':        e.preventDefault(); focusAt(keys.length - 1); return;
        case 'Backspace':  e.preventDefault(); onBackspace?.(); return;
        case 'Enter':      if (onSubmit) { e.preventDefault(); onSubmit(); } return;
        default: return;
      }
    },
    [keys.length, onBackspace, onSubmit],
  );

  /* ---- Global physical numpad support ----
     When the dialer is mounted, digits, star, hash, plus pressed anywhere on the
     window are forwarded to onKey unless the focus is inside a text
     input, textarea, or contenteditable (so we never hijack typing). */
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if ((node as HTMLElement).isContentEditable) return true;
      return false;
    };
    const flashKey = (k: string) => {
      const idx = keys.findIndex(([kk]) => kk === k);
      const btn = btnRefs.current[idx];
      if (!btn) return;
      btn.classList.add('ava-key-flash');
      setTimeout(() => btn.classList.remove('ava-key-flash'), 140);
    };
    const onWinKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.hidden) return;
      // Only handle when the keypad is actually visible on screen (guards against
      // hidden/off-screen instances such as a collapsed FloatingDialpad).
      const root = rootRef.current;
      if (!root || root.offsetParent === null) return;
      if (isTypingTarget(e.target)) return;
      const k = e.key;
      if (/^[0-9]$/.test(k) || k === '*' || k === '#') {
        e.preventDefault();
        onKey(k);
        flashKey(k);
        return;
      }
      if (k === '+') {
        e.preventDefault();
        onKey('+');
        flashKey('0');
        return;
      }
      if (k === 'Backspace') {
        e.preventDefault();
        onBackspace?.();
        return;
      }
      if (k === 'Enter') {
        if (onSubmit) { e.preventDefault(); onSubmit(); }
        return;
      }
    };
    window.addEventListener('keydown', onWinKey);
    return () => window.removeEventListener('keydown', onWinKey);
  }, [keys, onKey, onBackspace, onSubmit]);

  /* ---- Restore focus across density/theme remounts ---- */
  useEffect(() => {
    const { key, active } = readPersistedFocus();
    if (!active || !key) return;
    const idx = keys.findIndex(([k]) => k === key);
    if (idx < 0) return;
    // Restore on next frame so layout is settled.
    const id = requestAnimationFrame(() => btnRefs.current[idx]?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Mark focus inactive when focus actually leaves the keypad. */
  const onBlurCapture = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    const { key } = readPersistedFocus();
    writePersistedFocus(key, false);
  }, []);

  const onFocusKey = useCallback((key: string) => {
    writePersistedFocus(key, true);
  }, []);

  return (
    <div
      ref={rootRef}
      role="grid"
      aria-label="Dialpad"
      data-density={density}
      className="lemtel-keypad"
      onBlurCapture={onBlurCapture}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
        gap: t.gap,
        width: `min(100%, ${t.gridMax}px)`,
        margin: '0 auto',
        padding: t.pad ? `0 ${t.pad}px` : 0,
        boxSizing: 'border-box',
      }}
      {...rest}
    >
      <style>{`
        @keyframes ava-key-flash-kf { 0% { transform: scale(1); box-shadow: 0 0 0 rgba(33,212,253,0); } 40% { transform: scale(0.96); box-shadow: 0 0 0 6px rgba(33,212,253,0.28); } 100% { transform: scale(1); box-shadow: 0 0 0 rgba(33,212,253,0); } }
        .ava-key-flash { animation: ava-key-flash-kf 140ms ease-out; }
      `}</style>
      {keys.map(([key, sub], i) => {
        const row = Math.floor(i / COLS) + 1;
        const col = (i % COLS) + 1;
        const hasSub = t.subRow > 0;
        const spoken = spokenFor(key, sub);
        return (
          <button
            key={key}
            ref={(el) => { btnRefs.current[i] = el; }}
            role="gridcell"
            type="button"
            aria-rowindex={row}
            aria-colindex={col}
            aria-label={`Dial ${spoken}`}
            aria-keyshortcuts={key.length === 1 ? key : undefined}
            data-key={key}
            className="lemtel-key lemtel-glass ava-press"
            onClick={() => handleActivate(key, sub)}
            onKeyDown={(e) => onKeyDown(e, i)}
            onFocus={() => onFocusKey(key)}
            style={{
              height: t.keyH,
              display: 'grid',
              gridTemplateRows: hasSub ? `${t.digitRow}px ${t.subRow}px` : `${t.digitRow}px`,
              rowGap: t.rowGap,
              justifyItems: 'center',
              alignContent: 'center',
              padding: 0,
              borderRadius: t.radius,
              background: 'linear-gradient(160deg, rgba(255,255,255,0.09), rgba(255,255,255,0.04))',
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 14px -10px rgba(0,0,0,0.8)',
              color: '#E8EEFB',
              cursor: 'pointer',
              transition: 'background .18s ease, border-color .18s ease, box-shadow .18s ease, transform .12s ease',
              willChange: 'transform',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'linear-gradient(160deg, rgba(33,212,253,0.18), rgba(0,35,230,0.10))';
              el.style.borderColor = 'rgba(33,212,253,0.42)';
              el.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.14), 0 0 18px -6px rgba(33,212,253,0.45)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'linear-gradient(160deg, rgba(255,255,255,0.09), rgba(255,255,255,0.04))';
              el.style.borderColor = 'rgba(255,255,255,0.12)';
              el.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 14px -10px rgba(0,0,0,0.8)';
            }}

          >
            <span
              className="ava-display-num"
              data-role="digit"
              aria-hidden="true"
              style={{
                gridRow: 1,
                height: t.digitRow,
                lineHeight: `${t.digitRow}px`,
                fontSize: t.digit,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >{key}</span>
            {hasSub && (
              <span
                data-role="sub"
                aria-hidden="true"
                style={{
                  gridRow: 2,
                  height: t.subRow,
                  lineHeight: `${t.subRow}px`,
                  fontSize: t.sub,
                  color: 'rgba(159,179,214,0.72)',
                  letterSpacing: '0.22em',
                  fontWeight: 700,
                  minWidth: '2.4em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >{sub || '\u00A0'}</span>
            )}
          </button>
        );
      })}

      {/* Screen-reader-only live region for activation feedback. */}
      <span
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1, height: 1, padding: 0, margin: -1,
          overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
        }}
      >
        {announcement}
      </span>
    </div>
  );
}
