import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('Lemtel Desktop product branding', () => {
  it('keeps the email-only sign-in surface Lemtel-branded', () => {
    const wizard = source('./SetupWizard.tsx');
    expect(wizard).toContain('Lemtel Telecom · Private, intelligent communications');
    expect(wizard).toContain('Forgot password?');
    expect(wizard).toContain('Encrypted account verification · Email-only access');
    expect(wizard).toContain("color: '#f4f8ff'");
    expect(wizard).not.toContain('AVA Statistic · assistantvirtualai.com');
    expect(wizard).not.toContain('Powered by AVA');
  });

  it('uses Lemtel marks instead of vendor badges in product chrome', () => {
    const tagline = source('./BrandTagline.tsx');
    const rail = source('./console/LeftRail.tsx');
    const settings = source('./SettingsPage.tsx');
    const pane = source('./SoftphonePane.tsx');
    const workspace = source('./console/AIWorkspace.tsx');

    for (const text of [tagline, rail, settings, pane, workspace]) {
      expect(text).not.toContain('Powered by AVA');
      expect(text).not.toContain('AVA Statistic');
    }
    expect(tagline).toContain('Business communications, simplified');
    expect(rail).toContain('Secure communications');
    expect(workspace).toContain('Lemtel Intelligence');
  });
});
