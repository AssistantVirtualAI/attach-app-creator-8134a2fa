import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('Lemtel Desktop product branding', () => {
  it('keeps the email-only sign-in surface Lemtel-branded', () => {
    const wizard = source('./SetupWizard.tsx');
    expect(wizard).toContain('Private communications desk');
    expect(wizard).toContain('Lemtel Telecom');
    expect(wizard).toContain('Forgot password?');
    expect(wizard).toContain('Email-only access. Telephony settings load only after verification.');
    expect(wizard).toContain('No extension or SIP domain required');
    expect(wizard).toContain('YOUR CALLING DESK');
    expect(wizard).toContain('Powered by');
    expect(wizard).toContain('avaPoweredBy');
    expect(wizard).toContain('https://assistantvirtualai.com');
    expect(wizard).not.toContain('AVA Statistic · assistantvirtualai.com');
  });

  it('uses Lemtel marks instead of vendor badges in product chrome', () => {
    const tagline = source('./BrandTagline.tsx');
    const rail = source('./console/LeftRail.tsx');
    const settings = source('./SettingsPage.tsx');
    const pane = source('./SoftphonePane.tsx');
    const workspace = source('./console/AIWorkspace.tsx');

    for (const text of [tagline, rail, settings, workspace]) {
      expect(text).not.toContain('Powered by AVA');
      expect(text).not.toContain('AVA Statistic');
    }
    expect(tagline).toContain('Business communications, simplified');
    expect(rail).toContain('Secure communications');
    expect(workspace).toContain('Lemtel Intelligence');
    expect(pane).toContain('avaPoweredBy');
    expect(pane).toContain('https://assistantvirtualai.com');
    expect(pane).toContain('Powered by AVA — assistantvirtualai.com');
    expect(pane).not.toContain('AVA Statistic');
  });
});
