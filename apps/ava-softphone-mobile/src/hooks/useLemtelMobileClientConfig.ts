// Lemtel Phase 21A — React hook consuming the pure lifecycle module.
// Only talks to the authenticated lifecycle function. It never fetches telephony
// credentials and never opens any telephony connection itself.
import { useCallback, useEffect, useRef, useState } from 'react';
import { edgeCall } from '../lib/mobileSupabase';
import {
  cacheUsableAfterTransient, classifyError, clearCachedManifest as clearManifestCache, evaluateManifest,
  foregroundRefreshDue, getInstallationRef, loadCachedManifest, saveCachedManifest, type LemtelManifest,
} from '../lib/lemtelClientConfig';

export type LemtelClientConfigStatus = 'legacy' | 'checking' | 'allowed' | 'pending_block' | 'blocked' | 'unavailable';

export type LemtelMobileClientConfig = {
  status: LemtelClientConfigStatus;
  sipAllowed: boolean;
  deviceRef: string | null;
  refresh: (opts?: { force?: boolean }) => Promise<void>;
  finalizeBlock: () => void;
  clearCachedManifest: () => Promise<void>;
};

const FN = 'lemtel-client-config';

export function useLemtelMobileClientConfig(accessToken: string | null | undefined): LemtelMobileClientConfig {
  const hasPortalSession = !!accessToken;
  const [status, setStatus] = useState<LemtelClientConfigStatus>(hasPortalSession ? 'checking' : 'legacy');
  const [deviceRef, setDeviceRef] = useState<string | null>(null);
  const tokenRef = useRef(accessToken);
  const deviceRefRef = useRef<string | null>(null);
  const lastSuccessRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const statusRef = useRef(status);
  const registeredRef = useRef(false);
  tokenRef.current = accessToken;
  statusRef.current = status;

  const applyManifest = useCallback(async (raw: unknown): Promise<boolean> => {
    const decision = evaluateManifest(raw);
    if (decision === 'allowed') {
      const m = raw as LemtelManifest;
      await saveCachedManifest(m);
      deviceRefRef.current = m.device.deviceRef;
      lastSuccessRef.current = Date.now();
      setDeviceRef(m.device.deviceRef);
      setStatus('allowed');
      return true;
    }
    if (decision === 'expired_manifest') { setStatus('unavailable'); return false; }
    setStatus('pending_block');
    return false;
  }, []);

  const handleFailure = useCallback(async (err: unknown) => {
    const kind = classifyError(err);
    if (kind === 'unauthorized') { setStatus('unavailable'); return; }
    if (kind === 'transient_failure') {
      const cached = await loadCachedManifest();
      if (cacheUsableAfterTransient(cached)) {
        deviceRefRef.current = cached!.manifest.device.deviceRef;
        setDeviceRef(cached!.manifest.device.deviceRef);
        setStatus('allowed');
      } else {
        setStatus('unavailable');
      }
      return;
    }
    setStatus('pending_block');
  }, []);

  const run = useCallback(async (mode: 'register' | 'manifest') => {
    const token = tokenRef.current;
    if (!token || inFlightRef.current) return;
    if (statusRef.current === 'blocked' || statusRef.current === 'pending_block') return;
    inFlightRef.current = true;
    try {
      const body = mode === 'register' || !deviceRefRef.current
        ? { action: 'register', platform: 'mobile', installationRef: await getInstallationRef() }
        : { action: 'manifest', platform: 'mobile', deviceRef: deviceRefRef.current };
      const res = await edgeCall(FN, token, body);
      await applyManifest(res);
      if (mode === 'register') registeredRef.current = true;
    } catch (e) {
      await handleFailure(e);
    } finally {
      inFlightRef.current = false;
    }
  }, [applyManifest, handleFailure]);

  // Mandatory register at the start of an authenticated session (once per session).
  useEffect(() => {
    if (!hasPortalSession) { setStatus((s) => (s === 'blocked' ? s : 'legacy')); return; }
    if (registeredRef.current || statusRef.current === 'blocked') return;
    setStatus((s) => (s === 'legacy' ? 'checking' : s));
    void run('register');
  }, [hasPortalSession, run]);

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (!tokenRef.current) return;
    if (opts?.force) { await run(registeredRef.current ? 'manifest' : 'register'); return; }
    if (!foregroundRefreshDue(deviceRefRef.current, lastSuccessRef.current)) return;
    await run('manifest');
  }, [run]);

  const clearCachedManifest = useCallback(async () => { await clearManifestCache(); }, []);

  const finalizeBlock = useCallback(() => {
    setStatus('blocked');
    deviceRefRef.current = null;
    lastSuccessRef.current = null;
    setDeviceRef(null);
    void clearManifestCache();
  }, []);

  const sipAllowed = status === 'legacy' || status === 'allowed';
  return { status, sipAllowed, deviceRef, refresh, finalizeBlock, clearCachedManifest };
}
