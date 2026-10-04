import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKEND_URL } from '../backendOrigin';

const h = vi.hoisted(() => ({ getSession: vi.fn(), fetch: vi.fn() }));
vi.mock('../mobileSupabase', () => ({ supabase: { auth: { getSession: h.getSession } } }));
import { clearIceServerCache, FALLBACK_ICE_SERVERS, fetchIceServers } from './iceServers';

beforeEach(() => {
  clearIceServerCache(); h.getSession.mockReset(); h.fetch.mockReset();
  h.fetch.mockResolvedValue({ ok: true, json: async () => [{ urls: 'turn:relay.example.test', username: 'ephemeral', credential: 'test-only' }] });
  vi.stubGlobal('fetch', h.fetch);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Lemtel mobile TURN session boundary', () => {
  it('does not ask for TURN or ship a TURN credential when the session is absent', async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    expect(await fetchIceServers()).toBe(FALLBACK_ICE_SERVERS);
    expect(FALLBACK_ICE_SERVERS.every((server) => !server.credential)).toBe(true);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('uses the active JWT and never reuses an old account cache', async () => {
    h.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'jwt-a', user: { id: 'A' } } } })
      .mockResolvedValueOnce({ data: { session: { access_token: 'jwt-b', user: { id: 'B' } } } });
    await fetchIceServers();
    await fetchIceServers();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.fetch.mock.calls[0][0]).toBe(`${BACKEND_URL}/functions/v1/get-turn-credentials`);
    expect(h.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-a');
    expect(h.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer jwt-b');
  });

  it('aborts a stalled TURN service and returns STUN within the incoming-call budget', async () => {
    vi.useFakeTimers();
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-a', user: { id: 'A' } } } });
    h.fetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = fetchIceServers();
    await vi.advanceTimersByTimeAsync(1_200);
    expect(await pending).toBe(FALLBACK_ICE_SERVERS);
    expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('returns before a hung session refresh and never starts a late TURN request', async () => {
    vi.useFakeTimers();
    let release!: (value: unknown) => void;
    h.getSession.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const pending = fetchIceServers();
    await vi.advanceTimersByTimeAsync(1_200);
    expect(await pending).toBe(FALLBACK_ICE_SERVERS);
    release({ data: { session: { access_token: 'old-jwt', user: { id: 'A' } } } });
    await Promise.resolve();
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
