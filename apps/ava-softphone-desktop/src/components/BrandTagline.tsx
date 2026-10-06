import React from 'react';
import { theme } from '../lib/theme';

type Size = 'sm' | 'md' | 'lg';

interface Props {
  size?: Size;
  align?: 'center' | 'left';
  /**
   * Kept for compatible call sites. The Lemtel client is intentionally
   * product-branded: this renders a Lemtel service label, never a vendor mark.
   */
  showPoweredBy?: boolean;
  style?: React.CSSProperties;
}

/**
 * Lemtel product signature used below the canonical L mark.
 * It deliberately has no third-party logo or external product attribution.
 */
export default function BrandTagline({
  size = 'md',
  align = 'center',
  showPoweredBy = false,
  style,
}: Props) {
  const { colors } = theme;
  const scale = size === 'lg' ? 1 : size === 'md' ? 0.82 : 0.68;
  const titleFs = `clamp(${11 * scale}px, ${1.1 * scale}vw + 8px, ${15 * scale}px)`;
  const detailFs = `clamp(${9 * scale}px, ${0.7 * scale}vw + 6px, ${11 * scale}px)`;
  const gap = size === 'lg' ? 12 : size === 'md' ? 9 : 5;

  return (
    <div
      style={{
        marginTop: gap,
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        gap: size === 'lg' ? 5 : 3,
        textAlign: align,
        minWidth: 0,
        maxWidth: '100%',
        ...style,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          justifyContent: align === 'center' ? 'center' : 'flex-start',
          fontSize: titleFs,
          fontWeight: 700,
          color: colors.text,
          letterSpacing: 0.25,
          lineHeight: 1.25,
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        <span>Lemtel Communications</span>
        <span
          aria-label="Secure Lemtel service"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 22, height: 18, padding: '0 6px', borderRadius: 999,
            background: colors.primarySoft, border: `1px solid ${colors.borderGold}`,
            color: colors.gold, fontSize: '0.72em', letterSpacing: 0.8, fontWeight: 800,
          }}
        >
          L
        </span>
      </div>
      <span style={{ color: colors.textSub, fontSize: detailFs, fontWeight: 500, lineHeight: 1.35 }}>
        Business communications, simplified
      </span>
      {showPoweredBy && (
        <span style={{ color: colors.textDim, fontSize: detailFs, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase' }}>
          Lemtel Cloud
        </span>
      )}
    </div>
  );
}
