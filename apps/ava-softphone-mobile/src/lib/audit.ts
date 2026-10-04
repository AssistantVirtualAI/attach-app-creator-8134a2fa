import { BACKEND_URL, BACKEND_ANON_KEY } from './backendOrigin';
// Phase 5 — fire-and-forget audit logger for the mobile softphone.
// Never throws; never blocks UX. Disabled in mock/demo mode.
import { isMockMode } from './buildGuard';

export type AuditAction =
  | 'recording.played'
  | 'recording.downloaded'
  | 'voicemail.played'
  | 'voicemail.downloaded'
  | 'voicemail.deleted'
  | 'sms.sent'
  | 'call.originated'
  | 'call.transferred'
  | 'softphone.signed_in'
  | 'softphone.signed_out';

const PORTAL = BACKEND_URL;
const ANON = BACKEND_ANON_KEY;

let getToken: () => Promise<string | null> = async () => null;
export function configureAudit(tokenGetter: () => Promise<string | null>) { getToken = tokenGetter; }

export function audit(action: AuditAction, resourceId?: string | null, metadata?: Record<string, unknown>): void {
  if (isMockMode()) return;
  (async () => {
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`${PORTAL}/functions/v1/audit-log`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: ANON,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, resource_id: resourceId ?? null, metadata: metadata ?? {} }),
        keepalive: true,
      });
    } catch {
      /* swallow */
    }
  })();
}
