import { describe, expect, it } from 'vitest';
import { edgeFailure, lemtelAuthErrorMessage } from './lemtelAuthErrors';

describe('Lemtel Desktop authentication errors', () => {
  it('never exposes the raw Edge SDK error for a rejected bootstrap', () => {
    expect(lemtelAuthErrorMessage('bootstrap', { status: 405, code: 'method_not_allowed' }))
      .toBe('The secure desktop session could not be started. Install the latest Lemtel Desktop update, then sign in again.');
  });

  it('gives actionable guidance for membership, session and service failures', () => {
    expect(lemtelAuthErrorMessage('bootstrap', { code: 'lemtel_membership_required' })).toContain('organization administrator');
    expect(lemtelAuthErrorMessage('first-password', { status: 401 })).toContain('Sign in again');
    expect(lemtelAuthErrorMessage('first-password', { code: 'server_not_configured' })).toContain('temporarily unavailable');
  });

  it('extracts a controlled Edge status and body code without preserving raw text', () => {
    expect(edgeFailure({ context: { status: 403 } }, { error: 'lemtel_membership_required' }))
      .toEqual({ status: 403, code: 'lemtel_membership_required' });
  });
});
