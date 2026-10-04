/**
 * Lemtel Phase 25A — the portal voicemailPolicy is the sole authority on greeting
 * configuration. Local mocks only: no network, no call, no write, no env, no secret.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';

const edgeCall = vi.fn();
vi.mock('../lib/mobileSupabase', () => ({
  edgeCall: (...a: any[]) => edgeCall(...a),
  authedRealtime: () => ({ channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }), removeChannel: () => {} }),
}));
vi.mock('../lib/mobileApi', () => ({
  mobileApi: { voicemails: vi.fn().mockResolvedValue([]), analyzeCall: vi.fn(), voicemailAudio: vi.fn() },
}));
vi.mock('../hooks/useMobileCredentials', () => ({
  useMobileCredentials: () => ({ accessToken: 'test-token', extension: 'x', domainUuid: null }),
}));
vi.mock('../lib/audit', () => ({ audit: vi.fn() }));

import VoicemailScreen from './VoicemailScreen';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe('Phase 25A — VoicemailScreen portal voicemailPolicy', () => {
  beforeEach(() => {
    edgeCall.mockReset();
    edgeCall.mockResolvedValue({ voices: [{ id: 'v1', name: 'Voice' }], settings: { greeting_tts_text: 'Hi' } });
  });

  it('disabled renders the passive greeting-disabled card', async () => {
    render(<VoicemailScreen voicemailPolicy="disabled" />);
    await flush();
    const card = screen.getByTestId('voicemail-greeting-disabled');
    expect(card.textContent).toContain('disabled in the Lemtel portal');
    expect(card.textContent).toContain('managed from the portal');
    expect(card.querySelector('button, input, textarea, select, a')).toBeNull();
  });

  it('disabled renders no greeting control', async () => {
    const { container } = render(<VoicemailScreen voicemailPolicy="disabled" />);
    await flush();
    expect(container.querySelector('textarea')).toBeNull();
    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.queryByText('ElevenLabs greeting')).toBeNull();
  });

  it('disabled never calls edgeCall, even after effects settle', async () => {
    render(<VoicemailScreen voicemailPolicy="disabled" />);
    await flush(); await flush();
    expect(edgeCall).not.toHaveBeenCalled();
  });

  it('missing policy defaults to disabled', async () => {
    render(<VoicemailScreen />);
    await flush();
    expect(screen.getByTestId('voicemail-greeting-disabled')).toBeTruthy();
    expect(edgeCall).not.toHaveBeenCalled();
  });

  it('enabled keeps the editor and performs only get_settings', async () => {
    const { container } = render(<VoicemailScreen voicemailPolicy="enabled" />);
    await waitFor(() => expect(edgeCall).toHaveBeenCalledTimes(1));
    expect(edgeCall.mock.calls[0][0]).toBe('user-voicemail-greeting');
    expect(edgeCall.mock.calls[0][2]).toEqual({ action: 'get_settings', payload: {} });
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(screen.queryByTestId('voicemail-greeting-disabled')).toBeNull();
  });

  it('enabled → disabled clears editor and makes no further request', async () => {
    const { container, rerender } = render(<VoicemailScreen voicemailPolicy="enabled" />);
    await waitFor(() => expect(edgeCall).toHaveBeenCalledTimes(1));
    rerender(<VoicemailScreen voicemailPolicy="disabled" />);
    await flush();
    expect(container.querySelector('textarea')).toBeNull();
    expect(edgeCall).toHaveBeenCalledTimes(1);
  });
});
