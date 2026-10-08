/**
 * Lemtel Phase 24B — ActiveCall shows the manual Record/Stop control only for
 * the exact validated 'user_allowed'. Fully simulated `sp`; no real SIP instance.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('./OutputDevicePicker', () => ({ default: () => null }));
vi.mock('./RecentsList', () => ({ default: () => null }));
vi.mock('./ContactsList', () => ({ default: () => null }));
vi.mock('./VoicemailList', () => ({ default: () => null }));
vi.mock('./SmsThreads', () => ({ default: () => null }));
vi.mock('./console/OrgChatView', () => ({ default: () => null }));
vi.mock('./RecordingsList', () => ({ default: () => null }));
vi.mock('./SipRecoveryBanner', () => ({ default: () => null }));
vi.mock('../lib/avaApi', () => ({ ava: {} }));
vi.mock('../lib/a11yAudit', () => ({ watchA11y: () => () => {} }));
vi.mock('@/hooks/useSoftphone', () => ({ useSoftphone: () => ({}) }));

import { ActiveCall } from './SoftphonePane';

function makeSp(policy: any, recording = false) {
  const allowed = policy === 'user_allowed';
  return {
    snap: { remoteNumber: '300', muted: false, onHold: false },
    recording,
    recordingPolicy: policy === 'user_allowed' || policy === 'portal_managed' ? policy : (policy === undefined ? undefined : policy),
    manualRecordingAllowed: allowed,
    toggleRecording: vi.fn(), mute: vi.fn(), unmute: vi.fn(), hold: vi.fn(), unhold: vi.fn(), hangup: vi.fn(), sendDTMF: vi.fn(),
    hasConsult: () => false, completeAttendedTransfer: vi.fn(), cancelAttendedConsult: vi.fn(),
  };
}
const draw = (sp: any, onTransfer = vi.fn()) => render(
  <ActiveCall sp={sp} timer="00:10" showDTMF={false} toggleDTMF={vi.fn()} dialKeys={[]} onTransfer={onTransfer}
    activeOutputLabel="Default" autoResetOutput={false} onAutoResetChange={vi.fn()} onActiveOutputLabel={vi.fn()} />,
);
const recBtn = () => screen.queryByRole('button', { name: /start recording|démarrer l’enregistrement/i });

describe('ActiveCall — Phase 24B recording policy', () => {
  it('user_allowed renders Record and its click calls the action', () => {
    const sp = makeSp('user_allowed');
    draw(sp);
    fireEvent.click(recBtn()!);
    expect(sp.toggleRecording).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('desktop-recording-policy-note')).toBeNull();
  });

  for (const [p, msg] of [['not_allowed', 'Manual recording is not allowed'], ['portal_managed', 'Recording managed in portal'], [undefined, 'Manual recording is not allowed'], ['always', 'Manual recording is not allowed']] as const) {
    it(`${String(p)}: passive note, no button, no route to toggleRecording`, () => {
      const sp = makeSp(p);
      draw(sp);
      expect(recBtn()).toBeNull();
      const note = screen.getByTestId('desktop-recording-policy-note');
      expect(note.getAttribute('role')).toBe('note');
      expect(note.textContent).toBe(msg);
      expect(note.querySelectorAll('a, button, input, select, textarea').length).toBe(0);
      document.querySelectorAll('button').forEach((b) => fireEvent.click(b));
      expect(sp.toggleRecording).not.toHaveBeenCalled();
    });
  }

  it('portal_managed while recording keeps the passive indicator and renders no Stop', () => {
    const sp = makeSp('portal_managed', true);
    draw(sp);
    const ind = screen.getByTestId('desktop-recording-indicator');
    expect(ind.querySelectorAll('button, a').length).toBe(0);
    expect(screen.queryByRole('button', { name: /stop recording|arrêter l’enregistrement/i })).toBeNull();
    fireEvent.click(ind);
    expect(sp.toggleRecording).not.toHaveBeenCalled();
  });

  it('mute, hold, keypad, transfers and hang-up stay available under all policies', () => {
    for (const p of ['user_allowed', 'not_allowed', 'portal_managed']) {
      const { unmount } = draw(makeSp(p));
      for (const n of [/Mute microphone/, /Place call on hold/, /DTMF keypad/, /Blind transfer/, /Attended transfer/, /End call/]) expect(screen.getByRole('button', { name: n }), `${p} ${n}`).toBeTruthy();
      unmount();
    }
  });
});
