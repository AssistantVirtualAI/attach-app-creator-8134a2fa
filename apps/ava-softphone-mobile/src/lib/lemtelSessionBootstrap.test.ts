import { describe, expect, it } from 'vitest';
import { LemtelSessionBootstrapError, bootstrapLemtelMobileSession } from './lemtelSessionBootstrap';

const userId = '11111111-2222-3333-4444-555555555555';
const okBody = {
  user: { id: userId, email: 'member@example.test', displayName: 'Member Test' },
  organizations: [{ organizationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'member', organization: { display_name: 'Lemtel Test' } }],
  telephony: { status: 'not_provisioned' },
};

describe('bootstrapLemtelMobileSession', () => {
  it('uses the server-owned Lemtel session context and bearer token', async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toMatch(/\/functions\/v1\/lemtel-session-bootstrap$/);
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
      return new Response(JSON.stringify(okBody), { status: 200 });
    };
    await expect(bootstrapLemtelMobileSession('access-token', userId, fetcher)).resolves.toEqual({
      userId,
      email: 'member@example.test',
      displayName: 'Member Test',
      organizationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      organizationName: 'Lemtel Test',
    });
  });

  it('fails closed for a server denial or a malformed organization response', async () => {
    const denied = async () => new Response(JSON.stringify({ error: 'lemtel_membership_required' }), { status: 403 });
    await expect(bootstrapLemtelMobileSession('token', userId, denied)).rejects.toMatchObject({ code: 'lemtel_account_not_active', status: 403 } satisfies Partial<LemtelSessionBootstrapError>);

    const malformed = async () => new Response(JSON.stringify({ user: okBody.user, organizations: [] }), { status: 200 });
    await expect(bootstrapLemtelMobileSession('token', userId, malformed)).rejects.toMatchObject({ code: 'bootstrap_invalid_response', status: 200 } satisfies Partial<LemtelSessionBootstrapError>);
  });
});
