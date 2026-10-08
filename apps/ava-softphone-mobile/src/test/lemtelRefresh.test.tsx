import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { I18nProvider } from '../lib/i18n';
import PoweredByAva, { AVA_URL } from '../components/PoweredByAva';
import SegmentedChoice from '../components/SegmentedChoice';
import { darkColors, lightColors } from '../lib/theme';

const I18N = readFileSync(join(__dirname, '../lib/i18n.tsx'), 'utf8');
const KEYS = ['settings.themeDaylight', 'brand.poweredBy', 'brand.poweredByAria', 'brand.appName', 'contacts.consentBody', 'contacts.consentRevoke', 'caller.colleague'];

describe('Lemtel mobile refresh', () => {
  it('every new key exists in both EN and FR', () => {
    const [en, fr] = I18N.split(/\n  fr: \{/);
    for (const k of KEYS) {
      expect(en).toContain(`'${k}'`);
      expect(fr).toContain(`'${k}'`);
    }
  });

  it('Powered by AVA links to assistantvirtualai.com', () => {
    render(<I18nProvider><PoweredByAva /></I18nProvider>);
    const a = screen.getByTestId('powered-by-ava');
    expect(a.getAttribute('href')).toBe(AVA_URL);
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('segmented choice switches value', () => {
    let v = 'dark';
    render(<SegmentedChoice ariaLabel="Theme" value="dark" onChange={(x) => { v = x; }}
      options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Daylight' }]} />);
    fireEvent.click(screen.getByText('Daylight'));
    expect(v).toBe('light');
  });

  it('both palettes expose the same tokens incl. mint', () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort());
    expect(darkColors.mint).toBeTruthy();
  });

  it('no visible Planiprêt branding in the mobile source', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
    });
    const hits = walk(join(__dirname, '..')).filter((p) => /Planipr[eê]t/.test(readFileSync(p, 'utf8')));
    expect(hits).toEqual([]);
  });
});
