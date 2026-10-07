import React from 'react';
import { colors, gradients } from '../lib/theme';

/** Official Lemtel mark shared by the mobile product surfaces. */
export function LemtelMark({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/lemtel-icon.png"
      alt="Lemtel"
      width={size}
      height={size}
      style={{
        width: size, height: size, display: 'block',
        borderRadius: size * 0.22,
        boxShadow: `0 8px 22px -10px ${colors.lemtelBlue}`,
      }}
    />
  );
}

/** A compact Lemtel product marker for dashboards and assistance surfaces. */
export function LemtelBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: compact ? '2px 8px' : '3px 10px',
      borderRadius: 999,
      background: 'linear-gradient(110deg, rgba(37,99,235,0.18), rgba(35,214,255,0.22), rgba(37,99,235,0.18))',
      border: `1px solid ${colors.borderAI}`,
      color: colors.avaCyan, fontSize: compact ? 9 : 9.5, fontWeight: 800,
      letterSpacing: 1.15, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      Lemtel secure communications
    </span>
  );
}

/** Hero gradient banner used on Home + dashboards. */
export function HeroGradient({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      padding: '20px 18px 22px',
      borderRadius: 22,
      background: gradients.hero,
      border: `1px solid ${colors.border}`,
      ...style,
    }}>
      <div aria-hidden style={{
        position: 'absolute', top: -80, right: -60, width: 220, height: 220,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${colors.signalGold}22 0%, transparent 65%)`,
        pointerEvents: 'none',
      }} />
      <div aria-hidden style={{
        position: 'absolute', bottom: -120, left: -40, width: 260, height: 260,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${colors.avaViolet}28 0%, transparent 65%)`,
        pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
}
