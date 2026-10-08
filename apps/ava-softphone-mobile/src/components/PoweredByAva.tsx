import React from 'react';
import { colors } from '../lib/theme';
import { useT } from '../lib/i18n';

export const AVA_URL = 'https://assistantvirtualai.com';

/** Discreet "Powered by AVA" attribution — the only AVA branding allowed. */
export default function PoweredByAva({ style }: { style?: React.CSSProperties }) {
  const { t } = useT();
  return (
    <a
      href={AVA_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('brand.poweredByAria' as any)}
      data-testid="powered-by-ava"
      className="lemtel-powered-by"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: colors.textSub, letterSpacing: 0.4, ...style }}
    >
      <img src="/ava-logo.png" alt="" aria-hidden width={14} height={14} style={{ borderRadius: 3 }} />
      {t('brand.poweredBy' as any)}
    </a>
  );
}
