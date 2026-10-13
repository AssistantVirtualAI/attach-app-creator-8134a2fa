import { describe, expect, it } from 'vitest';
import type { Creds } from './creds';
import { LemtelSessionBootstrapError } from './lemtelSessionBootstrap';
import { reconcileLemtelMobileAuthority } from './lemtelAuthorityReconciliation';

const credentials: Creds = {
  email: 'member@example.test',
  extension: '',
  accessToken: 'session-token',
  userId: 'user-a',
  organizationId: 'stale-org',
  organizationName: 'Stale organization',
};

describe('reconcileLemtelMobileAuthority', () => {
  it('replaces cached organization metadata only from the server bootstrap', async () => {
    const result = await reconcileLemtelMobileAuthority(credentials, async () => ({
      userId: 'user-a',
      email: 'member@example.test',
      displayName: 'Member',
      organizationId: 'server-org',
      organizationName: 'Server organization',
      authorityRevision: 7,
    }));

    expect(result).toMatchObject({
      kind: 'accepted',
      authorityRevision: 7,
      credentials: { organizationId: 'server-org', organizationName: 'Server organization', displayName: 'Member' },
    });
  });

  it('fails closed when the portal removes membership or requires a new password', async () => {
    const denied = await reconcileLemtelMobileAuthority(credentials, async () => {
      throw new LemtelSessionBootstrapError('lemtel_account_not_active', 403);
    });
    const passwordRequired = await reconcileLemtelMobileAuthority(credentials, async () => {
      throw new LemtelSessionBootstrapError('first_password_change_required', 409);
    });

    expect(denied).toEqual({ kind: 'denied' });
    expect(passwordRequired).toEqual({ kind: 'denied' });
  });

  it('keeps a transient server failure retryable without trusting stale access', async () => {
    const result = await reconcileLemtelMobileAuthority(credentials, async () => {
      throw new LemtelSessionBootstrapError('bootstrap_service_unavailable', 503);
    });
    expect(result).toEqual({ kind: 'retryable' });
  });
});
