/**
 * Lemtel Phase 24A — the validated portal recordingPolicy is the only authority
 * for the manual Record / Stop recording control on the Mobile active-call sheet.
 * No real WebSocket, SIP call, device, Supabase function or PBX write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

vi.mock('@capacitor/haptics', () => ({ ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' } }));
vi.mock('../lib/sip/audioOutput', () => ({
  getAudioState: () => ({ route: 'earpiece', busy: false, bluetoothAvailable: false }),
  onAudioStateChange: () => () => {},
  setRoute: vi.fn().mockResolvedValue(true),
}));
vi.mock('../lib/sip/callerLookup', () => ({ lookupCaller: vi.fn().mockResolvedValue(null) }));
vi.mock('../lib/sip/useCallActionBridge', () => ({ useCallActionBridge: () => {} }));
vi.mock('../hooks/useMobileCredentials', () => ({ useMobileCredentials: () => ({ organizationId: null }) }));
vi.mock('../lib/sip/ringPreferences', () => ({ isVibrationEnabled: () => false }));
const invoke = vi.fn();
vi.mock('../lib/mobileSupabase', () => ({ supabase: { functions: { invoke } } }));

import ActiveCallSheet from './ActiveCallSheet';

function makeSp(recording = false) {
  return {
    snap: { callState: 'active', recording, muted: false, onHold: false, remoteParty: 'Test', remoteNumber: '300', startedAt: Date.now(), audioStatus: 'ready' },
    startRecord: vi.fn().mockResolvedValue(undefined),
    stopRecord: vi.fn().mockResolvedValue(undefined),
    hangup: vi.fn(), mute: vi.fn(), unmute: vi.fn(), hold: vi.fn(), unhold: vi.fn(),
    transfer: vi.fn(), park: vi.fn(), addCall: vi.fn(), sendDTMF: vi.fn(),
  };
}
const haptic = vi.fn().mockResolvedValue(undefined);
const draw = (sp: any, recordingPolicy?: any) => render(<ActiveCallSheet sp={sp} haptic={haptic} {...(recordingPolicy === undefined ? {} : { recordingPolicy })} />);
const recBtn = () => screen.queryByRole('button', { name: /^(●|■)?\s*(Record|Stop recording|Enregistrer|Arrêter)$/ }) || screen.queryByText(/^(Record|Stop recording|Enregistrer|Arrêter)$/);
const clickAll = () => document.querySelectorAll('button').forEach((b) => fireEvent.click(b));

beforeEach(() => { invoke.mockReset(); vi.spyOn(window, 'prompt').mockReturnValue(null); });

describe('ActiveCallSheet — Phase 24A recording policy', () => {
  it('user_allowed shows the manual control; click starts (not recording) or stops (recording)', async () => {
    const sp = makeSp(false);
    draw(sp, 'user_allowed');
    expect(screen.getByText('Record')).toBeTruthy();
    expect(screen.queryByTestId('recording-policy-note')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('Record')); });
    expect(sp.startRecord).toHaveBeenCalledTimes(1);
    expect(sp.stopRecord).not.toHaveBeenCalled();

    const sp2 = makeSp(true);
    const { unmount } = draw(sp2, 'user_allowed');
    await act(async () => { fireEvent.click(screen.getByText('Stop recording')); });
    expect(sp2.stopRecord).toHaveBeenCalledTimes(1);
    expect(sp2.startRecord).not.toHaveBeenCalled();
    unmount();
  });

  it('not_allowed: no manual control, passive note, start/stop unreachable', async () => {
    const sp = makeSp(false);
    draw(sp, 'not_allowed');
    expect(recBtn()).toBeNull();
    expect(screen.getByTestId('recording-policy-note').textContent).toMatch(/Manual recording is not allowed|Enregistrement manuel non autorisé/);
    await act(async () => { clickAll(); });
    expect(sp.startRecord).not.toHaveBeenCalled();
    expect(sp.stopRecord).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('portal_managed: no manual control, passive note, start/stop unreachable', async () => {
    const sp = makeSp(false);
    draw(sp, 'portal_managed');
    expect(recBtn()).toBeNull();
    const note = screen.getByTestId('recording-policy-note');
    expect(note.textContent).toMatch(/Recording managed in portal|Enregistrement géré par le portail/);
    expect(note.querySelectorAll('a, button, input').length).toBe(0);
    await act(async () => { clickAll(); });
    expect(sp.startRecord).not.toHaveBeenCalled();
    expect(sp.stopRecord).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('portal_managed while recording: passive indicator stays, no Stop Rec', async () => {
    const sp = makeSp(true);
    draw(sp, 'portal_managed');
    expect(screen.getByText(/Recording in progress|Enregistrement en cours/)).toBeTruthy();
    expect(screen.queryByText(/Stop recording|Arrêter/)).toBeNull();
    await act(async () => { clickAll(); });
    expect(sp.stopRecord).not.toHaveBeenCalled();
  });

  it('absent or invalid policy is treated as not_allowed', async () => {
    for (const p of [undefined, 'always', '', null]) {
      const sp = makeSp(false);
      const { unmount } = draw(sp, p);
      expect(recBtn()).toBeNull();
      expect(screen.getByTestId('recording-policy-note').textContent).toMatch(/Manual recording is not allowed|Enregistrement manuel non autorisé/);
      await act(async () => { clickAll(); });
      expect(sp.startRecord).not.toHaveBeenCalled();
      expect(sp.stopRecord).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('core non-recording controls remain available without call intelligence', () => {
    for (const p of ['user_allowed', 'not_allowed', 'portal_managed']) {
      const { unmount } = draw(makeSp(false), p);
      for (const l of ['Mute', 'Hold', 'Keypad', 'Transfer', 'Add', 'Park', 'Speaker']) expect(screen.getAllByText(l).length, `${p} ${l}`).toBeGreaterThan(0);
      unmount();
    }
  });
});
