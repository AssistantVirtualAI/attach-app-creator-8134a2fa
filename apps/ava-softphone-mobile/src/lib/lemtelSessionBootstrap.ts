import { BACKEND_ANON_KEY, BACKEND_URL } from './backendOrigin';

export type LemtelSessionBootstrap = {
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
};

export class LemtelSessionBootstrapError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Fetches only the Lemtel-owned session context from the server authority.
 * The client never chooses an organization, role, SIP setting, or onboarding
 * state based on a direct REST relationship query.
 */
export async function bootstrapLemtelMobileSession(
  accessToken: string,
  expectedUserId: string,
  fetcher: FetchLike = fetch,
): Promise<LemtelSessionBootstrap> {
  let response: Response;
  try {
    response = await fetcher(`${BACKEND_URL}/functions/v1/lemtel-session-bootstrap`, {
      method: 'GET',
      headers: { apikey: BACKEND_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new LemtelSessionBootstrapError('bootstrap_network_error', 0);
  }

  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  const rawCode = text((body as Record<string, unknown>)?.error);
  if (!response.ok) {
    const code = response.status === 401 ? 'session_expired'
      : response.status === 403 ? 'lemtel_account_not_active'
        : response.status === 409 ? 'first_password_change_required'
          : response.status >= 500 ? 'bootstrap_service_unavailable'
            : rawCode || 'bootstrap_failed';
    throw new LemtelSessionBootstrapError(code, response.status);
  }

  const user = (body as Record<string, unknown>)?.user as Record<string, unknown> | undefined;
  const organizations = (body as Record<string, unknown>)?.organizations;
  const firstMembership = Array.isArray(organizations) ? organizations[0] as Record<string, unknown> | undefined : undefined;
  const organization = firstMembership?.organization as Record<string, unknown> | undefined;
  const userId = text(user?.id);
  const email = text(user?.email);
  const displayName = text(user?.displayName);
  const organizationId = text(firstMembership?.organizationId);
  const organizationName = text(organization?.display_name);

  if (!userId || userId !== expectedUserId || !email || !displayName || !organizationId || !organizationName) {
    throw new LemtelSessionBootstrapError('bootstrap_invalid_response', response.status);
  }

  return { userId, email, displayName, organizationId, organizationName };
}
