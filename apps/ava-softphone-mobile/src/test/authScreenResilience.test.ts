import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapAuthError } from '../screens/AuthScreen';

describe('Lemtel authentication presentation', () => {
  it('turns the Supabase schema failure into a safe user-facing message', () => {
    const message = mapAuthError('unexpected_failure Database error querying schema');
    expect(message).toContain('temporairement indisponible');
    expect(message).toContain('mot de passe n’a pas été modifié');
    expect(message).not.toMatch(/schema|unexpected_failure/i);
  });

  it('keeps transport diagnostics out of production error banners', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '..', 'screens', 'AuthScreen.tsx'), 'utf8');
    expect(source).toContain('const showDiagnostics = Boolean((import.meta as any).env?.DEV);');
    expect(source).toContain('{showDiagnostics && failure && (');
  });

  it('defines explicit high-contrast auth tokens for Dark and Daylight', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(here, '..', 'styles.css'), 'utf8');
    for (const token of ['--auth-page-bg', '--auth-card', '--auth-ink-strong', '--auth-ink-muted', '--auth-input-ink', '--auth-error-ink']) {
      expect(css).toContain(token);
    }
    expect(css).toContain(':root[data-theme="light"]');
    expect(css).toContain('--auth-card: rgba(255,255,255,0.98);');
  });
});
