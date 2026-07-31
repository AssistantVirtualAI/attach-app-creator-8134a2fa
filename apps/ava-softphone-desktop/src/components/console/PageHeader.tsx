import React from 'react';
import { theme } from '../../lib/theme';

const { colors: c } = theme;

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accent?: string;
  right?: React.ReactNode;
}

/**
 * Shared premium page header — glass surface, aurora hairline, gradient icon
 * halo, and an optional right-side action slot.
 */
export default function PageHeader({
  eyebrow, title, subtitle, icon, accent = c.signalGold, right,
}: Props) {
  return (
    <header
      className="ava-glass ava-page-header"
      style={{
        position: 'relative',
        padding: 'var(--ava-space-5) var(--ava-space-6) var(--ava-space-6)',
        marginBottom: 'var(--ava-space-5)',
        borderRadius: 'var(--ava-radius)',
        overflow: 'hidden',
      }}>
      {/* brand-tinted overlay so the card never reads as flat grey */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `linear-gradient(135deg, ${c.lemtelBlue}14 0%, transparent 45%, ${accent}10 100%)`,
      }} />
      {/* aurora hairline */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${accent}, ${c.lemtelBlue} 45%, ${c.cyan} 100%)`,
        opacity: 0.95,
      }} />
      <div aria-hidden style={{
        position: 'absolute', top: -80, right: -60, width: 240, height: 240,
        borderRadius: '50%', pointerEvents: 'none',
        background: `radial-gradient(circle, ${accent}33 0%, transparent 65%)`,
      }} />
      <div aria-hidden style={{
        position: 'absolute', bottom: -90, left: -60, width: 220, height: 220,
        borderRadius: '50%', pointerEvents: 'none',
        background: `radial-gradient(circle, ${c.lemtelBlue}26 0%, transparent 65%)`,
      }} />
      <div className="ava-page-header-row" style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        {icon && (
          <div style={{
            flexShrink: 0,
            width: 46, height: 46, borderRadius: 14,
            display: 'grid', placeItems: 'center',
            background: `linear-gradient(135deg, ${accent}33, ${c.lemtelBlue}2a)`,
            border: `1px solid ${accent}66`,
            color: accent,
            boxShadow: `0 8px 22px -10px ${accent}88`,
          }}>{icon}</div>
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
          {eyebrow && (
            <div className="ava-page-header-eyebrow" style={{
              fontSize: 10.5, fontWeight: 800, letterSpacing: 2.4,
              color: accent, textTransform: 'uppercase', marginBottom: 6,
              textShadow: `0 0 14px ${accent}55`,
            }}>{eyebrow}</div>
          )}
          <h1 className="ava-display ava-page-header-title" style={{
            fontWeight: 700, lineHeight: 1.15,
            color: c.text, margin: '0 0 6px',
            letterSpacing: -0.4,
            fontFamily: "'Space Grotesk', 'DM Sans', sans-serif",
          }}>{title}</h1>
          {subtitle && (
            <p className="ava-page-header-subtitle" style={{
              fontSize: 13.5, color: c.textSub, margin: 0, lineHeight: 1.55, maxWidth: 640, fontWeight: 500,
            }}>
              {subtitle}
            </p>
          )}
        </div>
        {right && <div style={{ flexShrink: 0 }}>{right}</div>}
      </div>
    </header>
  );
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  hint: string;
  accent?: string;
  cta?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}

export function EmptyState({
  icon = '✦', title, hint, accent = c.avaCyan, cta, secondary,
}: EmptyStateProps) {
  return (
    <div
      className="ava-glass"
      style={{
        position: 'relative',
        padding: '44px 26px',
        margin: '12px 0',
        textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        borderRadius: 20,
        background: c.bgCard,
        border: `1px solid ${accent}33`,
        overflow: 'hidden',
      }}>
      <div aria-hidden style={{
        position: 'absolute', top: -40, left: -40, width: 160, height: 160,
        borderRadius: '50%', pointerEvents: 'none',
        background: `radial-gradient(circle, ${c.lemtelBlue}22, transparent 65%)`,
      }} />
      <div aria-hidden style={{
        position: 'absolute', bottom: -50, right: -30, width: 180, height: 180,
        borderRadius: '50%', pointerEvents: 'none',
        background: `radial-gradient(circle, ${accent}1c, transparent 65%)`,
      }} />

      <div style={{
        position: 'relative',
        width: 68, height: 68, borderRadius: 20,
        display: 'grid', placeItems: 'center',
        background: `linear-gradient(135deg, ${accent}28, ${c.lemtelBlue}1c)`,
        border: `1px solid ${accent}55`,
        color: accent, fontSize: 28,
        boxShadow: `0 14px 34px -16px ${accent}77, inset 0 1px 0 rgba(255,255,255,0.4)`,
      }}>{icon}</div>
      <div className="ava-display" style={{ position: 'relative', fontSize: 16, fontWeight: 600, color: c.textIce, marginTop: 4, letterSpacing: -0.2 }}>{title}</div>
      <div style={{ position: 'relative', fontSize: 12.5, color: c.mutedSilver, maxWidth: 320, lineHeight: 1.55 }}>{hint}</div>
      {(cta || secondary) && (
        <div style={{ position: 'relative', display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {cta && (
            <button onClick={cta.onClick} style={{
              padding: '10px 18px', borderRadius: 12, border: 'none',
              background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.cyan})`,
              color: c.onAccent, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              boxShadow: `0 10px 28px -12px ${c.lemtelBlue}99`,
              letterSpacing: 0.2,
            }}>{cta.label}</button>
          )}
          {secondary && (
            <button onClick={secondary.onClick} style={{
              padding: '10px 16px', borderRadius: 12,
              background: 'rgba(255,255,255,0.6)',
              border: `1px solid ${c.border}`,
              color: c.textIce, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            }}>{secondary.label}</button>
          )}
        </div>
      )}
    </div>
  );
}

/** Shimmer skeleton primitive — uses .lemtel-skeleton from animations.css */
export function Skeleton({
  width = '100%', height = 12, radius = 8, style,
}: { width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties }) {
  return (
    <div className="lemtel-skeleton" style={{ width, height, borderRadius: radius, ...style }} />
  );
}

/** List-row skeleton — matches the unified row layout across console views. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="ava-glass" style={{ borderRadius: 14, overflow: 'hidden' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '24px 1fr 80px 60px',
          alignItems: 'center', gap: 12,
          padding: '14px 16px',
          borderBottom: i === rows - 1 ? 'none' : `1px solid ${c.border}`,
        }}>
          <Skeleton width={10} height={10} radius={999} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton width={`${50 + ((i * 13) % 30)}%`} height={11} />
            <Skeleton width={`${30 + ((i * 7) % 40)}%`} height={9} />
          </div>
          <Skeleton width={50} height={10} />
          <Skeleton width={36} height={10} />
        </div>
      ))}
    </div>
  );
}
