/**
 * Responsive light-mode snapshots for the navigation shell (BottomTabs)
 * and lightweight stand-ins for the Home, History, Chat and Settings
 * screens. Real screens are too coupled to Supabase / SIP to mount in
 * jsdom; we snapshot the *theme surface area* (light palette applied,
 * data-theme attribute, key tokens used in style attributes) at both
 * mobile (375) and desktop (1280) viewports so a token regression would
 * change the snapshot and fail CI.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import BottomTabs from '../components/BottomTabs';
import { ThemeProvider, useTheme, useThemeColors } from '../lib/ThemeContext';

function setViewport(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

function ScreenStub({ name }: { name: string }) {
  const c = useThemeColors();
  return (
    <section
      data-screen={name}
      style={{
        background: c.midnight,
        color: c.textIce,
        border: `1px solid ${c.border}`,
      }}
    >
      <h1 style={{ color: c.textIce }}>{name}</h1>
      <p style={{ color: c.mutedSilver }}>muted</p>
    </section>
  );
}

function ThemeSwitchProbe() {
  const { mode, setMode } = useTheme();
  return <button onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}>switch theme</button>;
}

const SCREENS = ['Home', 'History', 'Chat', 'Settings'] as const;
const BREAKPOINTS = [
  { name: 'mobile',  w: 375,  h: 812 },
  { name: 'desktop', w: 1280, h: 800 },
] as const;

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'light');
  document.body.setAttribute('data-theme', 'light');
  // Force the ThemeProvider's localStorage default to 'light' before mount.
  try { localStorage.setItem('ava.theme.mode', 'light'); } catch {}
});

describe('light-mode responsive snapshots', () => {
  it('updates the DOM token before a Daylight repaint', async () => {
    localStorage.setItem('ava.theme.mode', 'dark');
    const { getByText } = render(<ThemeProvider><ThemeSwitchProbe /></ThemeProvider>);
    fireEvent.click(getByText('switch theme'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.body.getAttribute('data-theme')).toBe('light');
  });

  for (const bp of BREAKPOINTS) {
    describe(`@${bp.name} ${bp.w}x${bp.h}`, () => {
      it('BottomTabs', () => {
        setViewport(bp.w, bp.h);
        const { container } = render(
          <ThemeProvider>
            <BottomTabs active="contacts" onChange={() => {}} />
          </ThemeProvider>,
        );
        expect(container.innerHTML).toMatchSnapshot();
      });

      for (const name of SCREENS) {
        it(`${name} screen surface`, () => {
          setViewport(bp.w, bp.h);
          const { container } = render(
            <ThemeProvider>
              <ScreenStub name={name} />
            </ThemeProvider>,
          );
          expect(container.innerHTML).toMatchSnapshot();
        });
      }
    });
  }
});
