import { describe, expect, it } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MobileI18nProvider } from '../lib/i18n';
import PoweredByAva, { AVA_URL } from '../components/PoweredByAva';
import SegmentedChoice from '../components/SegmentedChoice';
import { darkColors, lightColors } from '../lib/theme';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Lemtel mobile visual refresh', () => {
  it('links the AVA attribution to the company website', () => {
    render(<MobileI18nProvider><PoweredByAva /></MobileI18nProvider>);
    const link = screen.getByTestId('powered-by-ava');
    expect(link.getAttribute('href')).toBe(AVA_URL);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('changes a segmented preference when another option is tapped', () => {
    let current = 'dark';
    render(
      <SegmentedChoice
        ariaLabel="Theme"
        value="dark"
        onChange={(next) => { current = next; }}
        options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Daylight' }]}
      />,
    );
    fireEvent.click(screen.getByText('Daylight'));
    expect(current).toBe('light');
  });

  it('keeps the dark and daylight palettes structurally aligned', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
    expect(darkColors.mint).toBeTruthy();
    expect(lightColors.navSurface).toBeTruthy();
  });

  it('keeps the primary workspace, dialer, and active-call screens bilingual', () => {
    for (const file of ['HomeScreen.tsx', 'DialerScreen.tsx']) {
      const source = readFileSync(resolve(process.cwd(), 'src/screens', file), 'utf8');
      expect(source).toContain("from '../lib/i18n'");
      expect(source).toContain('tx(');
    }
    const activeCall = readFileSync(resolve(process.cwd(), 'src/components/ActiveCallSheet.tsx'), 'utf8');
    expect(activeCall).toContain("from '../lib/i18n'");
    expect(activeCall).toContain('tx(');
  });
});
