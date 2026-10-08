import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const desktopRoot = path.resolve(__dirname, '../..');
const source = (relative: string) => fs.readFileSync(path.join(desktopRoot, relative), 'utf8');

describe('Lemtel Desktop responsive visual contract', () => {
  it('keeps the sign-in view scrollable and legible at narrow widths', () => {
    const wizard = source('src/components/SetupWizard.tsx');
    const app = source('src/App.tsx');

    expect(wizard).toContain('grid-template-columns: minmax(0, 1.15fr) minmax(min(100%, 440px), 0.85fr)');
    expect(wizard).toContain('@media (max-width: 520px)');
    expect(wizard).toContain('overflow-wrap: anywhere');
    expect(wizard).toContain('min-height: 50px');
    expect(wizard).toContain('white-space: normal');
    expect(wizard).toContain('lemtel-auth-field');
    expect(app).toContain("flex: 1, minHeight: 0, overflow: 'auto'");
  });

  it('changes the softphone navigation before labels are squeezed out', () => {
    const pane = source('src/components/SoftphonePane.tsx');

    expect(pane).toContain('const showTabLabels = paneWidth >= 560;');
    expect(pane).toContain('const workspaceWide = paneWidth >= 1024 && !hideTabs;');
    expect(pane).toContain('{showTabLabels && (');
    expect(pane).toContain("paneWidth < 520 ? 'Lemtel'");
  });
});
