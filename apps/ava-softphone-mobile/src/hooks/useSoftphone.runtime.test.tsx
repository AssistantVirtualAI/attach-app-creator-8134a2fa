import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const state = vi.hoisted(() => ({ native: false, platform: 'web' }));
const nativeSentinel = vi.hoisted(() => ({ sipStatus: 'idle', __impl: 'native' }));
const nativeHook = vi.hoisted(() => vi.fn(() => nativeSentinel));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => state.platform, isNativePlatform: () => state.platform !== 'web' },
  registerPlugin: () => ({}),
}));
vi.mock('../lib/sip/nativeSipProvider', () => ({
  get NATIVE_SIP_ENABLED() { return state.native; },
  startAndroidSipService: vi.fn(),
  stopAndroidSipService: vi.fn(),
}));
vi.mock('./useSoftphoneNative', () => ({ useSoftphoneNative: nativeHook }));
vi.mock('../lib/sip/bootSipGuard', () => ({ notifySipDispatcherLoaded: vi.fn() }));
vi.mock('./useSoftphoneVerto', () => { throw new Error('Verto must not be imported'); });
vi.mock('../lib/sip/vertoProvider', () => { throw new Error('Verto must not be imported'); });

import { useSoftphone } from './useSoftphone';

describe('Phase 18A useSoftphone dispatch', () => {
  beforeEach(() => { nativeHook.mockClear(); });

  it('Android without native SIP selects JsSIP', () => {
    state.native = false; state.platform = 'android';
    const { result } = renderHook(() => useSoftphone(null));
    expect(nativeHook).not.toHaveBeenCalled();
    expect((result.current as any).__impl).toBeUndefined();
    expect(result.current.sipStatus).toBe('idle');
    expect(typeof result.current.call).toBe('function');
  });

  it('web/dev without native SIP selects JsSIP', () => {
    state.native = false; state.platform = 'web';
    const { result } = renderHook(() => useSoftphone(null));
    expect(nativeHook).not.toHaveBeenCalled();
    expect((result.current as any).__impl).toBeUndefined();
    expect(result.current.sipStatus).toBe('idle');
  });

  it('native SIP enabled selects the native hook', () => {
    state.native = true; state.platform = 'ios';
    const { result } = renderHook(() => useSoftphone(null));
    expect(nativeHook).toHaveBeenCalledWith(null);
    expect((result.current as any).__impl).toBe('native');
  });

  it('dispatch source does not reference the Verto hook', () => {
    const candidates = [
      resolve(process.cwd(), 'src/hooks/useSoftphone.ts'),
      resolve(process.cwd(), 'apps/ava-softphone-mobile/src/hooks/useSoftphone.ts'),
    ];
    const file = candidates.find((c) => existsSync(c));
    if (!file) throw new Error('useSoftphone.ts not found from ' + process.cwd());
    const src = readFileSync(file, 'utf8');
    expect(src).not.toContain('useSoftphone' + 'Verto');
  });
});
