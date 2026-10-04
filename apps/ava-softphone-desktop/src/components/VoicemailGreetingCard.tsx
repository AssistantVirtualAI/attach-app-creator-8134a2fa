// Lemtel Phase 25B — the Lemtel portal is the sole authority on the voicemail greeting.
// Passive, non-interactive information card. No state, no request, no media.
import React from 'react';
import { theme } from '../lib/theme';

const { colors: c } = theme;

export default function VoicemailGreetingCard() {
  return (
    <section
      data-testid="desktop-voicemail-greeting-portal-only"
      role="note"
      style={{ padding: 14, borderRadius: 12, background: c.bgElev, border: `1px solid ${c.border}`, color: c.textSub, fontSize: 13, lineHeight: 1.5 }}
    >
      <p style={{ margin: 0, fontWeight: 600, color: c.text }}>Voicemail greeting is managed in the Lemtel portal.</p>
      <p style={{ margin: '4px 0 0' }}>Open the Lemtel portal to review or change voicemail settings.</p>
    </section>
  );
}
