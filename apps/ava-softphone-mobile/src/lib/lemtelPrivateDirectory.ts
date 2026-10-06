// Lemtel-only private-directory adapter. It remains inert unless a future
// self-hosted build explicitly enables it; this file never changes the backend origin.
import { BACKEND_URL, LEGACY_BACKEND_URL } from './backendOrigin';
import { getCredentials } from './creds';
import { supabase } from './mobileSupabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const APPROVAL_VALUE = 'approved';

export type LemtelPrivateDirectoryFunction =
  | 'lemtel-caller-lookup'
  | 'lemtel-wss-diagnostics';

export function resolveLemtelPrivateDirectoryEnabled(backendUrl: string, rawApproval: unknown): boolean {
  return backendUrl !== LEGACY_BACKEND_URL && rawApproval === APPROVAL_VALUE;
}

function privateDirectoryApproval(): unknown {
  const vite = ((import.meta as any).env ?? {}).VITE_LEMTEL_PRIVATE_DIRECTORY;
  if (typeof vite === 'string' && vite.trim()) return vite;
  // Vitest mutates process.env at runtime whereas Vite exposes import.meta.env.
  // Browser builds never require or read process.
  const testValue = typeof process === 'undefined' ? undefined : process.env?.VITE_LEMTEL_PRIVATE_DIRECTORY;
  return testValue ?? vite;
}

export function isLemtelPrivateDirectoryEnabled(): boolean {
  return resolveLemtelPrivateDirectoryEnabled(BACKEND_URL, privateDirectoryApproval());
}

export async function getLemtelPrivateDirectoryOrganizationId(): Promise<string | null> {
  if (!isLemtelPrivateDirectoryEnabled()) return null;
  const credentials = await getCredentials();
  const organizationId = credentials?.organizationId;
  return typeof organizationId === 'string' && UUID_RE.test(organizationId) ? organizationId.toLowerCase() : null;
}

/**
 * Invokes only the two deployed read/diagnostic functions with the current
 * authenticated SDK session. The organization is taken only from scoped local
 * Lemtel credentials, never from a caller-provided value.
 */
export async function invokeLemtelPrivateDirectory<T>(
  functionName: LemtelPrivateDirectoryFunction,
  payload: Record<string, unknown>,
): Promise<T | null> {
  const organizationId = await getLemtelPrivateDirectoryOrganizationId();
  if (!organizationId) return null;
  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: { ...payload, organizationId },
    });
    return error || data == null ? null : data as T;
  } catch {
    return null;
  }
}

export type WssFailureCode = 'timeout' | 'rejected' | 'closed' | 'tls' | 'unknown';

export function classifyLemtelWssFailure(rawReason: unknown): WssFailureCode {
  const reason = typeof rawReason === 'string' ? rawReason.toLowerCase() : '';
  if (reason.includes('timeout')) return 'timeout';
  if (reason.includes('certificate') || reason.includes('tls') || reason.includes('ssl')) return 'tls';
  if (reason.includes('closed')) return 'closed';
  if (reason.includes('refused') || reason.includes('reject')) return 'rejected';
  return 'unknown';
}

export function boundedLatency(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 30_000 ? value : 0;
}

export function buildLemtelWssFallbackPayload(input: {
  primaryIndex: number;
  fallbackIndex: number;
  primaryReason?: unknown;
  primaryLatencyMs?: unknown;
  fallbackState: 'ok' | 'fail';
  fallbackLatencyMs?: unknown;
}): Record<string, unknown> | null {
  if (!Number.isSafeInteger(input.primaryIndex) || !Number.isSafeInteger(input.fallbackIndex) ||
      input.primaryIndex < 0 || input.fallbackIndex < 0 || input.primaryIndex === input.fallbackIndex) return null;
  return {
    primaryEndpointId: `candidate-${input.primaryIndex}`,
    fallbackEndpointId: `candidate-${input.fallbackIndex}`,
    primaryFailureCode: classifyLemtelWssFailure(input.primaryReason),
    primaryLatencyMs: boundedLatency(input.primaryLatencyMs),
    fallbackState: input.fallbackState,
    fallbackLatencyMs: boundedLatency(input.fallbackLatencyMs),
  };
}

/**
 * Records only opaque ordinal endpoint identifiers and bounded outcome data.
 * Endpoint URLs, SIP credentials, free-form reasons and all response bodies are
 * deliberately absent from the payload.
 */
export async function reportLemtelWssFallback(input: {
  primaryIndex: number;
  fallbackIndex: number;
  primaryReason?: unknown;
  primaryLatencyMs?: unknown;
  fallbackState: 'ok' | 'fail';
  fallbackLatencyMs?: unknown;
}): Promise<boolean> {
  const payload = buildLemtelWssFallbackPayload(input);
  if (!payload) return false;
  const result = await invokeLemtelPrivateDirectory<{ recorded?: boolean }>('lemtel-wss-diagnostics', payload);
  return result?.recorded === true;
}
