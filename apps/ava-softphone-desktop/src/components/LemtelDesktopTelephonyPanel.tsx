import { useEffect, useRef, useState } from 'react';
import { useSoftphone } from '../hooks/useSoftphone';
import { lemtelProvisioningMessage } from '../lib/lemtelSoftphoneProvisioning';
import type { DesktopProvisioningState } from '../hooks/useLemtelDesktopProvisioning';

/**
 * Test-ready telephony surface for the Lemtel origin: registration state, dial, answer, hang up, mute.
 * Every SIP value comes from the portal ("Connexion FusionPBX") through lemtel-softphone-provisioning.
 */
function ReadyPanel({ extension, accessToken, refreshToken }: { extension: string; accessToken: string; refreshToken: string }) {
  const sp = useSoftphone({ extension, accessToken, refreshToken });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [dial, setDial] = useState('');
  useEffect(() => { sp.setAudioEl(audioRef.current); }, [sp]);
  const s = sp.snap;
  const inCall = s.callState === 'active' || s.callState === 'held' || s.callState === 'ringing-out';
  return (
    <section data-testid="lemtel-desktop-telephony" style={{ padding: 16, borderRadius: 14, border: '1px solid rgba(127,127,127,.25)', marginBottom: 16 }}>
      <audio ref={audioRef} autoPlay />
      <strong>Lemtel · {sp.config?.extension ?? extension}@{sp.config?.sipDomain ?? '…'}</strong>
      <p data-testid="lemtel-desktop-sip-status" style={{ margin: '6px 0' }}>SIP : {sp.loading ? 'chargement…' : sp.credError ? sp.credError : s.status}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input aria-label="Numéro" value={dial} onChange={(e) => setDial(e.target.value.replace(/[^0-9*#+]/g, ''))} placeholder="1043" style={{ minHeight: 36, padding: '0 10px', borderRadius: 8 }} />
        {s.callState === 'ringing-in' && <button type="button" onClick={() => sp.answer()}>Répondre</button>}
        {!inCall && s.callState !== 'ringing-in' && <button type="button" disabled={!dial || s.status !== 'registered'} onClick={() => { void sp.call(dial); }}>Appeler</button>}
        {(inCall || s.callState === 'ringing-in') && <button type="button" onClick={() => sp.hangup()}>Raccrocher</button>}
        {inCall && <button type="button" onClick={() => (s.muted ? sp.unmute() : sp.mute())}>{s.muted ? 'Réactiver micro' : 'Muet'}</button>}
        <button type="button" onClick={() => sp.downloadDebugReport()}>Rapport SIP</button>
      </div>
    </section>
  );
}

export default function LemtelDesktopTelephonyPanel({ state, accessToken, refreshToken, onRetry }: { state: DesktopProvisioningState; accessToken: string; refreshToken: string; onRetry: () => void }) {
  if (state.status === 'idle') return null;
  if (state.status === 'checking') return <p data-testid="lemtel-desktop-telephony-checking">Téléphonie : vérification…</p>;
  if (state.status === 'ready' && 'extension' in state && state.extension) return <ReadyPanel extension={state.extension} accessToken={accessToken} refreshToken={refreshToken} />;
  const code = state.status === 'error' ? state.code : state.status;
  return (
    <section data-testid="lemtel-desktop-telephony-blocked" style={{ padding: 12, borderRadius: 12, border: '1px dashed rgba(127,127,127,.35)', marginBottom: 16 }}>
      <span>{lemtelProvisioningMessage(code)}</span> <button type="button" onClick={onRetry}>Réessayer</button>
    </section>
  );
}
