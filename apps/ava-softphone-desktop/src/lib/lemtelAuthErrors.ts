export type LemtelAuthOperation = 'bootstrap' | 'first-password' | 'password-recovery';

export type LemtelEdgeFailure = {
  code?: unknown;
  status?: unknown;
};

const normaliseCode = (value: unknown) => String(value ?? '').trim().toLowerCase();
const normaliseStatus = (value: unknown) => Number(value ?? 0);

/**
 * Converts controlled Lemtel Edge responses into user-facing guidance.
 * Raw Edge SDK errors are intentionally never displayed because they do not
 * tell an end user what they can do next.
 */
export function lemtelAuthErrorMessage(operation: LemtelAuthOperation, failure: LemtelEdgeFailure = {}): string {
  const code = normaliseCode(failure.code);
  const status = normaliseStatus(failure.status);

  if (code === 'weak_password' || status === 400) {
    return 'Choose a password with at least 12 characters, including uppercase, lowercase, a number and a symbol.';
  }
  if (code === 'unauthorized' || status === 401) {
    return 'Your secure session expired. Sign in again, then continue.';
  }
  if (code === 'lemtel_membership_required' || code === 'lemtel_active_organization_required' || status === 403) {
    return 'Your Lemtel account is not active yet. Ask your organization administrator to confirm your invitation.';
  }
  if (code === 'first_password_change_required' || code === 'first_password_change_not_required' || status === 409) {
    return 'Your account security state changed. Sign in again with your personal password.';
  }
  if (code === 'server_not_configured' || status >= 500) {
    return 'Lemtel secure access is temporarily unavailable. Please try again shortly.';
  }
  if (code === 'method_not_allowed' || status === 405) {
    return operation === 'bootstrap'
      ? 'The secure desktop session could not be started. Install the latest Lemtel Desktop update, then sign in again.'
      : 'This request could not be completed. Please return to sign in and try again.';
  }

  if (operation === 'password-recovery') {
    return 'Password recovery is temporarily unavailable. Please try again shortly.';
  }
  if (operation === 'first-password') {
    return 'Your personal password could not be saved. Please try again.';
  }
  return 'Your Lemtel secure session could not be started. Please sign in again.';
}

export function edgeFailure(error: unknown, body: unknown): LemtelEdgeFailure {
  const bodyCode = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  const context = typeof error === 'object' && error !== null ? (error as { context?: { status?: unknown } }).context : undefined;
  return { code: bodyCode, status: context?.status };
}
