import React, { useState } from 'react';
import type { ImpactStyle } from '@capacitor/haptics';
import { MessageCircle, UsersRound } from 'lucide-react';
import { font, radius } from '../lib/theme';
import { useThemeColors } from '../lib/ThemeContext';
import TeamChatScreen from './TeamChatScreen';
import MessagesScreen from './MessagesScreen';
import ContactsScreen from './ContactsScreen';
import { useTr, useT } from '../lib/i18n';

type Sub = 'team' | 'sms' | 'contacts';

/** Communication hub — the team space always remains scoped to the organization. */
export default function MessagesHubScreen({
  accessToken, userId, organizationName, sp, haptic, channelUnread,
}: {
  accessToken: string | null;
  userId: string | undefined;
  organizationName?: string;
  sp: any;
  haptic: (style?: ImpactStyle) => Promise<void>;
  channelUnread?: Record<string, number>;
}) {
  const [sub, setSub] = useState<Sub>('team');
  const { tr } = useTr();
  const { tx } = useT();
  const c = useThemeColors();

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '15px 14px 10px' }}>
        <div style={{ padding: '13px 14px', borderRadius: radius.xl, background: `linear-gradient(145deg, ${c.lemtelBlue}1c, ${c.graphite} 78%)`, border: `1px solid ${c.lemtelBlue}32`, boxShadow: '0 14px 32px -24px rgba(0,35,230,.48)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><span style={{ width: 31, height: 31, display: 'grid', placeItems: 'center', borderRadius: 10, background: `${c.avaCyan}14`, color: c.avaCyan, border: `1px solid ${c.avaCyan}32` }}><UsersRound size={17} /></span><div style={{ minWidth: 0 }}><div style={{ color: c.avaCyan, fontSize: 9.5, fontWeight: 850, letterSpacing: 1.4, textTransform: 'uppercase' }}>{tx('Organisation', 'Organization')}</div><div style={{ color: c.textIce, fontFamily: font.display, fontSize: 16, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{organizationName || 'Lemtel'}</div></div></div>
          <p style={{ margin: '9px 0 0', color: c.textSub, fontSize: 11.5, lineHeight: 1.4 }}>{tx('Conversations et contacts de votre organisation.', 'Conversations and contacts from your organization.')}</p>
        </div>
        <Segmented value={sub} onChange={(next) => { void haptic(); setSub(next); }} tr={tr} colors={c} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {sub === 'team' && <TeamChatScreen accessToken={accessToken} userId={userId} organizationName={organizationName} channelUnread={channelUnread} />}
        {sub === 'sms' && <MessagesScreen haptic={haptic} />}
        {sub === 'contacts' && <ContactsScreen sp={sp} />}
      </div>
    </div>
  );
}

function Segmented({ value, onChange, tr, colors }: { value: Sub; onChange: (value: Sub) => void; tr: any; colors: ReturnType<typeof useThemeColors> }) {
  const items: { id: Sub; label: string; Icon: typeof MessageCircle }[] = [
    { id: 'team', label: tr.messages.team, Icon: UsersRound },
    { id: 'sms', label: tr.messages.sms, Icon: MessageCircle },
    { id: 'contacts', label: tr.messages.contacts, Icon: UsersRound },
  ];
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 4, marginTop: 10, padding: 4, borderRadius: radius.lg, background: colors.graphite, border: `1px solid ${colors.border}` }}>{items.map(({ id, label, Icon }) => { const active = id === value; return <button key={id} type="button" onClick={() => onChange(id)} style={{ minHeight: 42, padding: '8px 6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: radius.md, border: active ? `1px solid ${colors.lemtelBlue}42` : '1px solid transparent', background: active ? 'linear-gradient(135deg,#0023e6,#4d6dff 48%,#21d4fd)' : 'transparent', color: active ? '#fff' : colors.mutedSilver, fontSize: 11, fontWeight: 800, cursor: 'pointer', boxShadow: active ? '0 10px 22px -16px rgba(0,35,230,.72)' : 'none' }}><Icon size={14} strokeWidth={2.2} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span></button>; })}</div>;
}
