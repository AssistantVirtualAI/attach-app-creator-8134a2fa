import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const desktopRoot = path.resolve(__dirname, '../..');
const source = (relative: string) => fs.readFileSync(path.join(desktopRoot, relative), 'utf8');

describe('Lemtel Desktop responsive visual contract', () => {
  it('keeps the sign-in view scrollable and legible at narrow widths', () => {
    const wizard = source('src/components/SetupWizard.tsx');
    const app = source('src/App.tsx');

    expect(wizard).toContain('grid-template-columns:minmax(230px,.8fr) minmax(340px,440px) minmax(220px,.72fr)');
    expect(wizard).toContain('@media (max-width:790px)');
    expect(wizard).toContain('@media (max-width:470px)');
    expect(wizard).toContain('min-height:50px');
    expect(wizard).toContain('lemtel-access-field');
    expect(wizard).toContain('.lemtel-access-desk-preview { display:none; }');
    expect(wizard).toContain('.lemtel-access-stage { min-height:calc(100% - 68px); overflow:visible; }');
    expect(wizard).toContain('@media (max-height:680px) and (min-width:791px)');
    expect(wizard).toContain('font-size:clamp(32px,10vw,36px)');
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
