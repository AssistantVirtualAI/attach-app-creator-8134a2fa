// Lemtel Phase 21B — Desktop lifecycle hook consuming the pure lifecycle module.
// Only talks to the authenticated lifecycle function. It never fetches telephony
// credentials and never opens any telephony connection itself. Without a session it is unavailable.
import { useCallback, useEffect, useRef, useState } from 'react';
import { SB_URL, SB_KEY } from '../lib/supabaseClient';
import {
  cacheUsableAfterTransient, classifyError, clearCachedManifest as clearManifestCache, evaluateManifest,
  foregroundRefreshDue, getInstallationRef, loadCachedManifest, saveCachedManifest, type LemtelManifest,
} from '../lib/lemtelDesktopClientConfig';

export type LemtelDesktopClientConfigStatus = 'checking' | 'allowed' | 'pending_block' | 'blocked' | 'unavailable';

export type LemtelDesktopClientConfig = {
  status: LemtelDesktopClientConfigStatus;
  sipAllowed: boolean;
  deviceRef: string | null;
  manifest: LemtelManifest | null;
  refresh: (opts?: { force?: boolean }) => Promise<void>;
  finalizeBlock: () => void;
  clearCachedManifest: () => Promise<void>;
};

const FN = 'lemtel-client-config';

/** Single authenticated call to the lifecycle function. Never logs the body or the session token. */
async function callLifecycle(sessionToken: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SB_URL}/functions/v1/${FN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed: any = await res.json().catch(() => null);
    const code = typeof parsed?.error === 'string' ? parsed.error : typeof parsed?.code === 'string' ? parsed.code : '';
    throw new Error(code || (res.status === 401 ? 'unauthorized' : `HTTP ${res.status}`));
  }
  return res.json().catch(() => null);
}

export function useLemtelDesktopClientConfig(sessionToken: string | null | undefined): LemtelDesktopClientConfig {
  const hasSession = !!sessionToken;
  const [status, setStatus] = useState<LemtelDesktopClientConfigStatus>(hasSession ? 'checking' : 'unavailable');
  const [deviceRef, setDeviceRef] = useState<string | null>(null);
  const [manifest, setManifest] = useState<LemtelManifest | null>(null);
  const tokenRef = useRef(sessionToken);
  const deviceRefRef = useRef<string | null>(null);
  const lastSuccessRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const statusRef = useRef(status);
  const registeredRef = useRef(false);
  tokenRef.current = sessionToken;
  statusRef.current = status;

  const applyManifest = useCallback(async (raw: unknown) => {
    const decision = evaluateManifest(raw);
    if (decision === 'allowed') {
      const m = raw as LemtelManifest;
      await saveCachedManifest(m);
      deviceRefRef.current = m.device.deviceRef;
      lastSuccessRef.current = Date.now();
      setDeviceRef(m.device.deviceRef);
      setManifest(m);
      setStatus('allowed');
      return;
    }
    setManifest(null);
    if (decision === 'expired_manifest' || decision === 'invalid_manifest') { setStatus('unavailable'); return; }
    setStatus('pending_block');
  }, []);

  const handleFailure = useCallback(async (err: unknown) => {
    const kind = classifyError(err);
    if (kind === 'unauthorized') { setManifest(null); setStatus('unavailable'); return; }
    if (kind === 'transient_failure') {
      const cached = await loadCachedManifest();
      if (cacheUsableAfterTransient(cached)) {
        deviceRefRef.current = cached!.manifest.device.deviceRef;
        setDeviceRef(cached!.manifest.device.deviceRef);
        setManifest(cached!.manifest);
        setStatus('allowed');
      } else {
        setManifest(null);
        setStatus('unavailable');
      }
      return;
    }
    setManifest(null);
    setStatus('pending_block');
  }, []);

  const run = useCallback(async (mode: 'register' | 'manifest') => {
    const token = tokenRef.current;
    if (!token || inFlightRef.current) return;
    if (statusRef.current === 'blocked' || statusRef.current === 'pending_block') return;
    inFlightRef.current = true;
    try {
      const body = mode === 'register' || !deviceRefRef.current
        ? { action: 'register', platform: 'desktop', installationRef: await getInstallationRef() }
        : { action: 'manifest', platform: 'desktop', deviceRef: deviceRefRef.current };
      const res = await callLifecycle(token, body);
      await applyManifest(res);
      if (mode === 'register') registeredRef.current = true;
    } catch (e) {
      await handleFailure(e);
    } finally {
      inFlightRef.current = false;
    }
  }, [applyManifest, handleFailure]);

  // Mandatory register once at the start of an authenticated Desktop session.
  useEffect(() => {
    if (!hasSession) {
      registeredRef.current = false;
      setManifest(null);
      setStatus((s) => (s === 'blocked' ? s : 'unavailable'));
      return;
    }
    if (registeredRef.current) return;
    // A new authenticated session (including after a finalized block) re-registers; the portal decides.
    statusRef.current = 'checking';
    setStatus('checking');
    void run('register');
  }, [hasSession, run]);

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
    setManifest(null);
    void clearManifestCache();
  }, []);

  const sipAllowed = status === 'allowed';
  return { status, sipAllowed, deviceRef, manifest, refresh, finalizeBlock, clearCachedManifest };
}
