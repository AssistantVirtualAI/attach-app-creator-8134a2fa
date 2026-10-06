import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { colors, font } from '../lib/theme';
import { LEMTEL_PRIVATE_CONTACTS_UI_ENABLED } from '../lib/contactScope';
import { setLemtelPrivateContactsConsent } from '../lib/lemtelPrivateContactsConsent';
import { useT } from '../lib/i18n';

export default function LemtelPrivateContactsConsentSheet({
  open, userId, onClose,
}: { open: boolean; userId?: string; onClose: (result: 'allowed' | 'declined' | 'ios_denied') => void }) {
  const { tx } = useT();
  const [busy, setBusy] = useState(false);
  if (!open || !userId || !LEMTEL_PRIVATE_CONTACTS_UI_ENABLED) return null;

  async function allow() {
    if (busy) return;
    setBusy(true);
    const stored = await setLemtelPrivateContactsConsent(userId, true);
    let osGranted = false;
    if (stored && Capacitor.isNativePlatform()) {
      try {
        const { Contacts } = await import('@capacitor-community/contacts');
        osGranted = (await Contacts.requestPermissions())?.contacts === 'granted';
      } catch { osGranted = false; }
    }
    if (!stored || !osGranted) await setLemtelPrivateContactsConsent(userId, false);
    setBusy(false);
    onClose(stored && osGranted ? 'allowed' : 'ios_denied');
  }

  async function decline() {
    if (busy) return;
    setBusy(true);
    await setLemtelPrivateContactsConsent(userId, false);
    setBusy(false);
    onClose('declined');
  }

  return <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(2,7,20,0.82)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
    <div style={{ width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', background: colors.midnight2, color: colors.textIce, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '24px 20px 32px', border: `1px solid ${colors.border}` }}>
      <div style={{ textAlign: 'center', fontSize: 44, lineHeight: 1, marginBottom: 8 }}>👥</div>
      <h2 style={{ margin: 0, textAlign: 'center', fontSize: font.lg, fontWeight: 800 }}>{tx('Contacts privés Lemtel', 'Lemtel private contacts')}</h2>
      <p style={{ marginTop: 12, fontSize: font.sm, lineHeight: 1.45, color: colors.mutedSilver }}>{tx(
        'Lemtel vous demandera l’autorisation avant tout accès au carnet de votre téléphone. Votre consentement est lié à ce compte et à ce serveur Lemtel.',
        'Lemtel asks for permission before any access to your phone address book. Your consent is tied to this account and this Lemtel server.',
      )}</p>
      <div style={{ marginTop: 16, padding: '14px', borderRadius: 14, background: 'rgba(46,155,220,0.08)', border: `1px solid ${colors.border}` }}>
        <div style={{ fontWeight: 700, fontSize: font.sm, marginBottom: 8 }}>{tx('Ce que vous contrôlez', 'What you control')}</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: font.sm, lineHeight: 1.55 }}>
          <li>{tx('L’accès système doit être accordé séparément.', 'System permission is requested separately.')}</li>
          <li>{tx('Les contacts appareil restent privés à votre compte.', 'Device contacts remain private to your account.')}</li>
          <li>{tx('Vous pourrez supprimer les contacts téléversés et retirer votre consentement.', 'You can delete uploaded contacts and withdraw consent.')}</li>
          <li>{tx('Aucune synchronisation ne commence sans une activation de build approuvée.', 'No sync begins without an approved build activation.')}</li>
        </ul>
      </div>
      <button onClick={allow} disabled={busy} style={{ marginTop: 18, width: '100%', padding: '14px 16px', borderRadius: 14, border: 'none', cursor: busy ? 'wait' : 'pointer', fontWeight: 800, fontSize: font.md, background: '#2E9BDC', color: '#fff' }}>{tx('Autoriser les contacts privés', 'Allow private contacts')}</button>
      <button onClick={decline} disabled={busy} style={{ marginTop: 10, width: '100%', padding: '14px 16px', borderRadius: 14, border: `1px solid ${colors.border}`, background: 'transparent', color: colors.textIce, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontSize: font.md }}>{tx('Pas maintenant', 'Not now')}</button>
    </div>
  </div>;
}
