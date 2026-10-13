import type { Creds } from './creds';
import {
  bootstrapLemtelMobileSession,
  LemtelSessionBootstrapError,
  type LemtelSessionBootstrap,
} from './lemtelSessionBootstrap';

export type LemtelAuthorityReconciliation =
  | { kind: 'accepted'; credentials: Creds; authorityRevision: number }
  | { kind: 'denied' }
  | { kind: 'retryable' };

type Bootstrapper = (accessToken: string, expectedUserId: string) => Promise<LemtelSessionBootstrap>;

/**
 * Re-checks the exact portal-managed account state with the Lemtel server.
 * No cached organization, role, password, SIP setting, or caller-supplied scope
 * is accepted as proof of current authorization.
 */
export async function reconcileLemtelMobileAuthority(
  credentials: Creds,
  bootstrapper: Bootstrapper = bootstrapLemtelMobileSession,
): Promise<LemtelAuthorityReconciliation> {
  if (!credentials.accessToken || !credentials.userId) return { kind: 'denied' };

  try {
    const authority = await bootstrapper(credentials.accessToken, credentials.userId);
    return {
      kind: 'accepted',
      authorityRevision: authority.authorityRevision,
      credentials: {
        ...credentials,
        email: authority.email,
        userId: authority.userId,
        displayName: authority.displayName,
        organizationId: authority.organizationId,
        organizationName: authority.organizationName,
      },
    };
  } catch (error) {
    if (error instanceof LemtelSessionBootstrapError && [401, 403, 409].includes(error.status)) {
      return { kind: 'denied' };
    }
    return { kind: 'retryable' };
  }
}
