// Desktop bootstrap boundary — local static checks only; no network or telephony.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(__dirname, '..');
const rd = (p: string) => fs.readFileSync(path.join(src, p), 'utf8');

describe('Lemtel Desktop bootstrap boundary', () => {
  it('uses the deployed authenticated bootstrap as the only post-login authority', () => {
    const hook = rd('hooks/useLemtelDesktopSessionBootstrap.ts');
    expect(hook).toContain('lemtel-session-bootstrap');
    expect(hook).toContain("method: 'GET'");
    expect(hook).not.toContain('lemtel-client-config');
    expect(hook).not.toContain('lemtel-device-register');
    expect(hook).not.toMatch(/WebSocket|setInterval|console\./);
  });

  it('renders a truthful provision-pending workspace and never mounts SIP on the current contract', () => {
    const app = rd('App.tsx');
    expect(app).toContain("bootstrap.status === 'not_provisioned'");
    expect(app).toContain('DesktopProvisioningWorkspace');
    expect(app).not.toContain('useLemtelDesktopClientConfig');
    expect(app).not.toContain('<SipKeepAlive');
    expect(app).not.toContain('softphone-credentials');
    expect(app).not.toContain('desktopUnavailable');
    expect(rd('lib/i18n.ts')).not.toContain('Desktop access is unavailable');
    expect(rd('lib/i18n.ts')).not.toContain('L’accès Desktop est indisponible');
  });

  it('keeps recording policy restrictive by default', () => {
    const policy = rd('lib/lemtelTelephonyPolicy.ts');
    expect(policy).toContain("'not_allowed'");
    expect(rd('hooks/useSoftphone.ts')).toContain("? args.recordingPolicy : 'not_allowed'");
  });
});
