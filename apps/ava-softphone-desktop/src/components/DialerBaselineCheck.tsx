import React, { useEffect, useState } from 'react';
import DialerKeypad, { DIALER_TOKENS, DialerDensity } from './DialerKeypad';
import { useTheme, UserThemeMode } from '../lib/theme';

/* ============================================================
   Automated visual check: renders the dialer at every theme
   mode × every density and overlays guide-lines through the
   digit row and sub-letter row. Any baseline drift between
   themes shows up immediately as a guide-line misalignment.

   Open with ?check=dialer in the desktop app.
   ============================================================ */

const MODES: UserThemeMode[] = ['daylight', 'dark'];
const DENSITIES: { d: DialerDensity; label: string; width: number }[] = [
  { d: 'spacious', label: 'Spacious (≥440px)', width: 320 },
  { d: 'compact',  label: 'Compact (360–439)',  width: 280 },
  { d: 'ultra',    label: 'Ultra (<360)',       width: 248 },
];

function BaselineOverlay({ density }: { density: DialerDensity }) {
  const t = DIALER_TOKENS[density];
  // Distance from top of a key to the digit-row centerline / sub-row centerline.
  const padTop = (t.keyH - t.digitRow - (t.subRow ? t.rowGap + t.subRow : 0)) / 2;
  const digitMid = padTop + t.digitRow / 2;
  const subMid = t.subRow ? padTop + t.digitRow + t.rowGap + t.subRow / 2 : null;

  // Render 4 horizontal guide-lines spaced by (keyH + gap) for each of the 4 rows.
  const rowStride = t.keyH + t.gap;
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {[0, 1, 2, 3].map((r) => {
        const baseY = r * rowStride;
        return (
          <React.Fragment key={r}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: baseY + digitMid, height: 1, background: 'rgba(255, 60, 120, 0.65)' }} />
            {subMid !== null && (
              <div style={{ position: 'absolute', left: 0, right: 0, top: baseY + subMid, height: 1, background: 'rgba(60, 200, 255, 0.55)' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function MeasureCard({ density, themeKey }: { density: DialerDensity; themeKey: string }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [report, setReport] = useState<string>('measuring…');

  useEffect(() => {
    if (!ref.current) return;
    const root = ref.current;
    const measure = () => {
      const digits = Array.from(root.querySelectorAll('[data-role="digit"]')) as HTMLElement[];
      const subs = Array.from(root.querySelectorAll('[data-role="sub"]')) as HTMLElement[];
      const tops = (els: HTMLElement[]) => els.map((e) => Math.round(e.getBoundingClientRect().top));
      const digitTops = tops(digits);
      const subTops = tops(subs);
      // Compare digits in the same row (groups of 3) — they must share a top.
      const rowDelta = (arr: number[]) => {
        if (arr.length < 2) return 0;
        let max = 0;
        for (let i = 0; i < arr.length; i += 3) {
          const slice = arr.slice(i, i + 3);
          if (slice.length < 2) continue;
          max = Math.max(max, Math.max(...slice) - Math.min(...slice));
        }
        return max;
      };
      const digitDelta = rowDelta(digitTops);
      const subDelta = rowDelta(subTops);
      const ok = digitDelta <= 0.5 && subDelta <= 0.5;
      setReport(`${ok ? '✓ PASS' : '✗ FAIL'}  Δdigit=${digitDelta.toFixed(2)}px  Δsub=${subDelta.toFixed(2)}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [density, themeKey]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <DialerKeypad density={density} onKey={() => {}} />
      <BaselineOverlay density={density} />
      <div
        data-baseline-report
        style={{
          marginTop: 8, fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
          color: report.startsWith('✓') ? '#22c55e' : '#ef4444',
        }}
      >{report}</div>
    </div>
  );
}

export default function DialerBaselineCheck() {
  const { mode, setMode } = useTheme();

  return (
    <div style={{ padding: 24, minHeight: '100vh', overflow: 'auto' }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Dialer baseline check</h1>
        <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.75 }}>
          Switch theme · within each card, digit/sub baselines must align with the guide-lines and report ✓ PASS.
        </p>
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid rgba(127,127,127,0.4)',
                background: m === mode ? 'rgba(0,35,230,0.18)' : 'transparent',
                fontWeight: 600, fontSize: 12,
              }}
            >{m}</button>
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>active: <strong>{mode}</strong></div>
      </header>

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {DENSITIES.map(({ d, label, width }) => (
          <section
            key={d}
            data-density={d}
            style={{
              padding: 16, borderRadius: 14,
              border: '1px solid rgba(127,127,127,0.25)',
              background: 'rgba(127,127,127,0.05)',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, opacity: 0.85 }}>{label}</div>
            <div style={{ width, maxWidth: '100%', margin: '0 auto' }}>
              <MeasureCard density={d} themeKey={mode} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
