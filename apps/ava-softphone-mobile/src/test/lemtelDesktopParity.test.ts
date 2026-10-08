import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { darkColors, lightColors, gradients } from '../lib/theme';

describe('Lemtel cross-platform visual parity', () => {
  it('shares Desktop public Dark palette values on the iOS and Android client', () => {
    expect(darkColors.midnight).toBe('#0b1124');
    expect(darkColors.midnight2).toBe('#131a35');
    expect(darkColors.lemtelBlue).toBe('#6680ff');
    expect(darkColors.avaCyan).toBe('#21d4fd');
    expect(darkColors.textIce).toBe('#f3f7ff');
    expect(darkColors.success).toBe('#22d39a');
    expect(gradients.call).toBe('linear-gradient(135deg, #0023e6 0%, #4d6dff 46%, #21d4fd 100%)');
  });

  it('shares Desktop Daylight ink, surface, and accent values on the mobile client', () => {
    expect(lightColors.midnight).toBe('#f6f9ff');
    expect(lightColors.textIce).toBe('#08102a');
    expect(lightColors.textSub).toBe('#33425e');
    expect(lightColors.lemtelBlue).toBe('#0023e6');
    expect(lightColors.border).toBe('rgba(180,196,224,0.45)');
  });

  it('keeps the mobile shell aligned with the declared Desktop source of truth', () => {
    const desktopTheme = readFileSync(resolve(process.cwd(), '../ava-softphone-desktop/src/lib/theme.tsx'), 'utf8');
    for (const token of ['#0b1124', '#131a35', '#0023e6', '#4d6dff', '#21d4fd', '#d4a73a', '#f3f7ff', '#08102a']) {
      expect(desktopTheme).toContain(token);
    }
    const mobileShell = readFileSync(resolve(process.cwd(), 'src/MobileApp.tsx'), 'utf8');
    const mobileDock = readFileSync(resolve(process.cwd(), 'src/components/BottomTabs.tsx'), 'utf8');
    expect(mobileShell).toContain('linear-gradient(90deg,#0023e6,#7a4cff 52%,#21d4fd)');
    expect(mobileDock).toContain('Floating glass dock inspired by the Desktop Lemtel shell');
  });
});
