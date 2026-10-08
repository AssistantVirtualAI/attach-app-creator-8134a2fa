import { useCallback, useEffect, useRef, useState } from 'react';
import { SB_KEY, SB_URL } from '../lib/supabaseClient';

/**
 * Authoritative Desktop session gate.
 *
 * The Hostinger endpoint only returns authenticated Lemtel identity and the
 * current telephony state. It never returns SIP/WSS/TURN data and it never
 * starts, registers, or retries telephony.
 */
export type DesktopBootstrapStatus = 'idle' | 'checking' | 'not_provisioned' | 'denied' | 'retryable_error';

export type DesktopBootstrap = {
  status: DesktopBootstrapStatus;
  organizationId: string | null;
  /** Deliberately false until a separately-authorized provisioning contract exists. */
  telephonyEnabled: false;
  refresh: () => Promise<void>;
};

type BootstrapPayload = {
  organizations?: Array<{ organizationId?: unknown }>;
  telephony?: { status?: unknown };
};

function parseNotProvisioned(payload: unknown): { organizationId: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as BootstrapPayload;
  const organizationId = data.organizations?.[0]?.organizationId;
  if (typeof organizationId !== 'string' || !organizationId) return null;
  if (data.telephony?.status !== 'not_provisioned') return null;
  return { organizationId };
}

/** A single GET to the deployed Lemtel authority. No device lifecycle fallback exists. */
async function requestBootstrap(sessionToken: string): Promise<{ kind: 'ok'; organizationId: string } | { kind: 'denied' | 'retryable_error' }> {
  try {
    const response = await fetch(`${SB_URL}/functions/v1/lemtel-session-bootstrap`, {
      method: 'GET',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    if (!response.ok) {
      return { kind: response.status === 401 || response.status === 403 || response.status === 409 ? 'denied' : 'retryable_error' };
    }
    const parsed = await response.json().catch(() => null);
    const verified = parseNotProvisioned(parsed);
    return verified ? { kind: 'ok', organizationId: verified.organizationId } : { kind: 'retryable_error' };
  } catch {
    return { kind: 'retryable_error' };
  }
}

export function useLemtelDesktopSessionBootstrap(sessionToken: string | null | undefined): DesktopBootstrap {
  const tokenRef = useRef(sessionToken);
  const activeRequestRef = useRef(0);
  const [status, setStatus] = useState<DesktopBootstrapStatus>(sessionToken ? 'checking' : 'idle');
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  tokenRef.current = sessionToken;

  const refresh = useCallback(async () => {
    const token = tokenRef.current;
    const requestId = ++activeRequestRef.current;
    if (!token) {
      setOrganizationId(null);
      setStatus('idle');
      return;
    }

    setStatus('checking');
    const result = await requestBootstrap(token);
    if (requestId !== activeRequestRef.current) return;

    if (result.kind === 'ok') {
      setOrganizationId(result.organizationId);
      setStatus('not_provisioned');
      return;
    }

    setOrganizationId(null);
    setStatus(result.kind);
  }, []);

  useEffect(() => {
    void refresh();
  }, [sessionToken, refresh]);

  return { status, organizationId, telephonyEnabled: false, refresh };
}
