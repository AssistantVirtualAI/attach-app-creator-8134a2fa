import React from 'react';
import { colors } from '../lib/theme';
import { useT } from '../lib/i18n';

export const AVA_URL = 'https://assistantvirtualai.com';

/** Attribution discrète et accessible, sans changer l’identité produit Lemtel. */
export default function PoweredByAva({ style }: { style?: React.CSSProperties }) {
  const { t } = useT();

  return (
    <a
      href={AVA_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('brand.poweredByAria')}
      data-testid="powered-by-ava"
      className="lemtel-powered-by"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        color: colors.textSub,
        fontSize: 11,
        fontWeight: 650,
        letterSpacing: 0.25,
        ...style,
      }}
    >
      <img
        src="/ava-logo.png"
        alt=""
        aria-hidden="true"
        width={18}
        height={18}
        style={{ borderRadius: 5, display: 'block' }}
      />
      {t('brand.poweredBy')}
    </a>
  );
}
