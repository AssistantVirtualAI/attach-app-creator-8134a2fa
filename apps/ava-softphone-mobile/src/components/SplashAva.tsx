import React from 'react';
import { colors, gradients } from '../lib/theme';

/** Animated Lemtel splash used for cold boot and secure session restore. */
export default function SplashAva() {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 28,
      background: gradients.app,
      color: colors.textIce,
    }}>
      <style>{`
        @keyframes lemtel-pulse { 0%,100% { opacity: .65; transform: scale(1); } 50% { opacity: 1; transform: scale(1.04); } }
      `}</style>
      <div style={{
        width: 120, height: 120, borderRadius: 28,
        overflow: 'hidden', boxShadow: '0 24px 60px -20px rgba(34,211,238,0.45)',
        animation: 'lemtel-pulse 2.6s ease-in-out infinite',
      }}>
        <img src="/lemtel-icon.png" alt="Lemtel" width={120} height={120} style={{ display: 'block' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Lemtel</div>
        <div style={{ fontSize: 12, color: colors.mutedSilver, marginTop: 4, textTransform: 'uppercase', letterSpacing: 2 }}>Secure communications</div>
      </div>
    </div>
  );
}
