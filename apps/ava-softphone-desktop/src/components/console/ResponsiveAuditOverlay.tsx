import React, { useEffect, useMemo, useState } from 'react';
import { theme } from '../../lib/theme';
const { colors: c } = theme;

interface Props {
  open: boolean;
  onClose: () => void;
}

const PRESETS = [
  { label: 'Mobile',  w: 390,  h: 760, key: 'mobile' },
  { label: 'Tablet',  w: 820,  h: 900, key: 'tablet' },
  { label: 'Desktop', w: 1280, h: 820, key: 'desktop' },
  { label: 'Wide',    w: 1536, h: 880, key: 'wide' },
] as const;

/**
 * Visual verification overlay — renders the current app inside iframes at
 * canonical breakpoints so every page can be audited for layout/overflow
 * issues. Shortcut: Ctrl/Cmd + Shift + R.
 */
export default function ResponsiveAuditOverlay({ open, onClose }: Props) {
  const [scale, setScale] = useState(0.55);
  const [selection, setSelection] = useState<Record<string, boolean>>({
    mobile: true, tablet: true, desktop: true, wide: false,
  });

  // iframe src: current location + ?audit=child to avoid recursive overlays.
  const src = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const u = new URL(window.location.href);
    u.searchParams.set('audit', 'child');
    return u.toString();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (k: string) =>
    setSelection((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div className="ava-audit-overlay" role="dialog" aria-label="Responsive audit">
      <div className="ava-audit-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            Responsive Audit
          </strong>
          <div style={{ display: 'flex', gap: 6 }}>
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => toggle(p.key)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: `1px solid ${c.overlay18}`,
                  background: selection[p.key]
                    ? `linear-gradient(135deg, ${c.primary}, ${c.cyan})`
                    : c.overlay06,
                  color: c.textIce,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  letterSpacing: 0.3,
                }}>
                {p.label} · {p.w}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, opacity: 0.85 }}>
            Zoom {Math.round(scale * 100)}%
            <input
              type="range"
              min={30}
              max={100}
              value={Math.round(scale * 100)}
              onChange={(e) => setScale(Number(e.target.value) / 100)}
              style={{ width: 140 }}
            />
          </label>
          <button
            onClick={onClose}
            style={{
              padding: '8px 14px', borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.2)',
              background: c.overlay08, color: c.textIce,
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>
            Close (Esc)
          </button>
        </div>
      </div>

      <div className="ava-audit-stage">
        {PRESETS.filter((p) => selection[p.key]).map((p) => (
          <div key={p.key} className="ava-audit-frame">
            <div className="ava-audit-meta" style={{ width: p.w * scale }}>
              <span>{p.label}</span>
              <span>{p.w} × {p.h}</span>
            </div>
            <div style={{ width: p.w * scale, height: p.h * scale, overflow: 'hidden', borderRadius: 14 }}>
              <iframe
                title={`audit-${p.key}`}
                src={src}
                width={p.w}
                height={p.h}
                style={{
                  width: p.w,
                  height: p.h,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                  border: 0,
                  display: 'block',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
