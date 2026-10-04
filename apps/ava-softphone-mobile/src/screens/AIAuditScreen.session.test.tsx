import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { BACKEND_URL } from '../lib/backendOrigin';

const h = vi.hoisted(() => ({ getSession: vi.fn(), fetch: vi.fn() }));
vi.mock('../lib/mobileSupabase', () => ({ supabase: { auth: { getSession: h.getSession } } }));
vi.mock('../lib/i18n', () => ({ useT: () => ({ lang: 'fr', t: (key: string) => key }) }));
import AIAuditScreen from './AIAuditScreen';

beforeEach(() => {
  h.getSession.mockReset();
  h.fetch.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  vi.stubGlobal('fetch', h.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('mobile AI audit session boundary', () => {
  it('uses only the active Supabase user session for requests to the configured backend', async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'current-user-jwt' } } });
    render(<AIAuditScreen />);
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());
    const [url, options] = h.fetch.mock.calls[0];
    expect(url).toContain(`${BACKEND_URL}/rest/v1/ai_request_audit_log?`);
    expect(options.headers.Authorization).toBe('Bearer current-user-jwt');
  });

  it('never substitutes the publishable key for a missing user session', async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const event = vi.spyOn(window, 'dispatchEvent');
    render(<AIAuditScreen />);
    await waitFor(() => expect(event.mock.calls.some(([e]) => e.type === 'mobile-auth-required')).toBe(true));
    expect(h.fetch).not.toHaveBeenCalled();
    event.mockRestore();
  });
});
