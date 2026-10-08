import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');

describe('Lemtel mobile workspace remap', () => {
  it('opens the organization home by default and keeps it in primary navigation', () => {
    const app = read('src/MobileApp.tsx');
    const tabs = read('src/components/BottomTabs.tsx');
    expect(app).toContain("return 'home' as Tab;");
    expect(app).toContain('<HomeScreen onNavigate={setTab as any}');
    expect(tabs).toContain("{ id: 'home', labelKey: 'tabs.home', Icon: Home }");
  });

  it('uses theme tokens for a readable main menu in Dark and Daylight', () => {
    const app = read('src/MobileApp.tsx');
    expect(app).toContain('background: colors.navSurface');
    expect(app).toContain('color: colors.textIce');
    expect(app).toContain('border: `1px solid ${colors.border}`');
  });

  it('presents team conversations inside the authenticated organization', () => {
    const hub = read('src/screens/MessagesHubScreen.tsx');
    const team = read('src/screens/TeamChatScreen.tsx');
    expect(hub).toContain('organizationName={organizationName}');
    expect(team).toContain("tx('Espace d’équipe', 'Team space')");
    expect(team).toContain("tx(\"Conversations d’équipe\", 'Team conversations')");
  });

  it('keeps Powered by AVA in the workspace home with its existing verified link component', () => {
    const home = read('src/screens/HomeScreen.tsx');
    expect(home).toContain("import PoweredByAva from '../components/PoweredByAva'");
    expect(home).toContain('<PoweredByAva />');
  });
});
