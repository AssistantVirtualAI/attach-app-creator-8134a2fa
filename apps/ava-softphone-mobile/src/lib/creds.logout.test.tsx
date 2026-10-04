import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ signOut: vi.fn(), getSession: vi.fn(), setSession: vi.fn(), clearAudio: vi.fn(), clearFiles: vi.fn(), setToken: vi.fn() }));
vi.mock('./mobileSupabase', () => ({ supabase: { auth: { signOut: h.signOut, getSession: h.getSession, setSession: h.setSession } }, clearRecordingAudioCache: h.clearAudio }));
vi.mock('./recordingCache', () => ({ clearRecordingCache: h.clearFiles }));
vi.mock('./mobileApi', () => ({ setAuthToken: h.setToken }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));

import { Preferences } from '@capacitor/preferences';
import { useStoredCreds, Store, restoreSupabaseSession, getCredentialEpoch } from './creds';

const account: any = { userId: 'user-a', organizationId: 'org-a', extension: '201', email: 'a@example.test', accessToken: 'jwt-a' };
beforeEach(() => {
  localStorage.clear();
  for (const mock of Object.values(h)) mock.mockReset();
  h.signOut.mockResolvedValue({ error: null });
  h.getSession.mockResolvedValue({ data: { session: null } });
  h.clearFiles.mockResolvedValue(undefined);
  vi.mocked(Preferences.get).mockReset().mockResolvedValue({ value: null });
  vi.mocked(Preferences.set).mockReset().mockResolvedValue(undefined);
  vi.mocked(Preferences.remove).mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('Phase 30A — mobile sign-out invalidates media first', () => {
  it('locks audio, clears disk and bearer, then closes the real auth session', async () => {
    const order: string[] = [];
    h.clearAudio.mockImplementation(() => order.push('audio'));
    h.clearFiles.mockImplementation(() => { order.push('disk'); return Promise.resolve(); });
    h.setToken.mockImplementation(() => order.push('token'));
    h.signOut.mockImplementation(() => { order.push('signout'); return Promise.resolve({ error: null }); });
    const { result } = renderHook(() => useStoredCreds());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setCreds(account));
    act(() => result.current.clearCreds());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.creds).toBeNull();
    expect(order[0]).toBe('audio');
    expect(order).toContain('disk');
    expect(order).toContain('token');
    expect(order[order.length - 1]).toBe('signout');
    expect(h.setToken).toHaveBeenCalledWith(null);
    act(() => result.current.setCreds((prev: any) => ({ ...prev, accessToken: 'late-a' })));
    expect(result.current.creds).toBeNull();
  });

  it('a fresh explicit login can be signed out again', async () => {
    const { result } = renderHook(() => useStoredCreds());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setCreds(account));
    act(() => result.current.clearCreds());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setCreds({ ...account, userId: 'user-b', accessToken: 'jwt-b' }));
    act(() => result.current.clearCreds());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(h.clearAudio).toHaveBeenCalledTimes(2);
    expect(h.signOut).toHaveBeenCalledTimes(2);
  });

  it('never restores a delayed Preferences.set from A after its logout', async () => {
    let finishWrite!: () => void;
    let saved: string | null = null;
    vi.mocked(Preferences.set).mockImplementation(async ({ value }) => {
      await new Promise<void>((resolve) => { finishWrite = resolve; });
      saved = value;
    });
    vi.mocked(Preferences.get).mockImplementation(async () => ({ value: saved }));
    vi.mocked(Preferences.remove).mockImplementation(async () => { saved = null; });
    const { result } = renderHook(() => useStoredCreds());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setCreds(account));
    await waitFor(() => expect(finishWrite).toBeTypeOf('function'));
    act(() => result.current.clearCreds());
    expect(result.current.loading).toBe(true);
    expect(vi.mocked(Preferences.remove)).not.toHaveBeenCalled();
    await act(async () => { finishWrite(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(await Store.get()).toBeNull();
    expect(saved).toBeNull();
  });

  it('discards a hydration write scheduled under A after A has signed out', async () => {
    const { result } = renderHook(() => useStoredCreds());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setCreds(account));
    const staleEpoch = getCredentialEpoch();
    act(() => result.current.clearCreds());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = vi.mocked(Preferences.set).mock.calls.length;
    await Store.set({ ...account, extension: '202' }, staleEpoch);
    expect(vi.mocked(Preferences.set)).toHaveBeenCalledTimes(before);
    expect(await Store.get()).toBeNull();
  });

  it('finishes an in-flight restore before signing A out and unlocking the login screen', async () => {
    let finishRestore!: (value: any) => void;
    h.setSession.mockReturnValueOnce(new Promise((resolve) => { finishRestore = resolve; }));
    const { result } = renderHook(() => useStoredCreds());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setCreds({ ...account, refreshToken: 'refresh-a' }));
    const restoring = restoreSupabaseSession({ ...account, refreshToken: 'refresh-a' });
    await waitFor(() => expect(h.setSession).toHaveBeenCalledTimes(1));
    act(() => result.current.clearCreds());
    expect(result.current.loading).toBe(true);
    expect(h.signOut).not.toHaveBeenCalled();
    await act(async () => { finishRestore({ data: { session: { user: { id: 'user-a' }, access_token: 'jwt-a', refresh_token: 'refresh-a' } }, error: null }); });
    expect(await restoring).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('does not enable B before the native recording purge for A finishes', async () => {
    let finishPurge!: () => void;
    h.clearFiles.mockReturnValueOnce(new Promise<void>((resolve) => { finishPurge = resolve; }));
    const { result } = renderHook(() => useStoredCreds());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setCreds(account));
    act(() => result.current.clearCreds());
    expect(result.current.loading).toBe(true);
    await act(async () => { finishPurge(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setCreds({ ...account, userId: 'user-b' }));
    expect(result.current.creds?.userId).toBe('user-b');
  });
});
