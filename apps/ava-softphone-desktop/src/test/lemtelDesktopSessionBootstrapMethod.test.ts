import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const wizard = fs.readFileSync(path.resolve(__dirname, '../components/SetupWizard.tsx'), 'utf8');

describe('Lemtel Desktop session bootstrap transport', () => {
  it('uses the GET-only server contract instead of the Edge SDK default POST', () => {
    expect(wizard).toMatch(/invoke\('lemtel-session-bootstrap',\s*\{\s*method:\s*'GET'\s*\}\)/s);
  });

  it('does not surface the generic Edge SDK message to an end user', () => {
    expect(wizard).toContain("lemtelAuthErrorMessage('bootstrap'");
    expect(wizard).not.toContain("bootstrapError?.message || 'Lemtel account setup is unavailable.'");
  });
});
