import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Building2, Clock3, MessageCircle, Phone, ShieldCheck, UsersRound } from 'lucide-react';
import { font, radius } from '../lib/theme';
import { mobileApi } from '../lib/mobileApi';
import { useT } from '../lib/i18n';
import { useThemeColors } from '../lib/ThemeContext';
import type { Tab } from '../components/BottomTabs';
import PoweredByAva from '../components/PoweredByAva';

type HomeScreenProps = {
  onNavigate: (tab: Tab) => void;
  haptic?: () => Promise<void>;
  onOpenProfile?: () => void;
};

type WorkspaceSnapshot = {
  organization?: { name?: string };
  profile?: { displayName?: string };
  calls?: { today?: number; missed?: number };
  messages?: { unread?: number };
  brief?: string;
};

/** Organization-first workspace, intentionally shared by the iOS and Android build. */
export default function HomeScreen({ onNavigate, haptic }: HomeScreenProps) {
  const { tx } = useT();
  const c = useThemeColors();
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setRefreshing(true);
      try {
        const data = await mobileApi.dashboard() as WorkspaceSnapshot;
        if (active) setSnapshot(data || {});
      } catch {
        if (active) setSnapshot({});
      } finally {
        if (active) setRefreshing(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const name = useMemo(() => snapshot?.profile?.displayName || '', [snapshot]);
  const organization = snapshot?.organization?.name || 'Lemtel';
  const navigate = (tab: Tab) => { void haptic?.(); onNavigate(tab); };
  const actions: Array<{ id: Tab; Icon: typeof Phone; title: string; detail: string; tone: string }> = [
    { id: 'keypad', Icon: Phone, tone: c.lemtelBlue, title: tx('Nouvel appel', 'New call'), detail: tx('Ouvrir le clavier', 'Open keypad') },
    { id: 'chats', Icon: MessageCircle, tone: c.avaCyan, title: tx('Équipe', 'Team'), detail: tx('Conversations de l’organisation', 'Organization conversations') },
    { id: 'calls', Icon: Clock3, tone: c.signalGold, title: tx('Historique', 'History'), detail: tx('Appels et messages vocaux', 'Calls and voicemail') },
    { id: 'contacts', Icon: UsersRound, tone: c.mint, title: tx('Répertoire', 'Directory'), detail: tx('Votre organisation', 'Your organization') },
  ];

  return (
    <main style={{ height: '100%', overflowY: 'auto', padding: '14px 16px 136px' }}>
      <section style={{ position: 'relative', overflow: 'hidden', padding: '22px 20px', borderRadius: 24, background: `radial-gradient(circle at 96% 4%, ${c.avaCyan}40 0, transparent 38%), radial-gradient(circle at 8% 112%, ${c.lemtelBlue}70 0, transparent 58%), linear-gradient(145deg, ${c.graphite2} 0%, ${c.graphite} 100%)`, border: `1px solid ${c.lemtelBlue}55`, boxShadow: '0 22px 54px -26px rgba(0,35,230,.52)' }}>
        <span aria-hidden style={{ position: 'absolute', right: -52, bottom: -70, width: 190, height: 190, borderRadius: 999, border: `1px solid ${c.avaCyan}38`, boxShadow: `0 0 0 22px ${c.avaCyan}0a, 0 0 0 48px ${c.avaCyan}06` }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div aria-hidden style={{ width: 46, height: 46, borderRadius: 15, display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(135deg,#0023e6,#4d6dff 48%,#21d4fd)', boxShadow: '0 16px 32px -16px rgba(0,35,230,.72)' }}><Building2 size={22} strokeWidth={2.3} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, color: c.avaCyan, fontSize: 10, fontWeight: 850, letterSpacing: 1.5, textTransform: 'uppercase' }}>{tx('Espace de travail', 'Workspace')}</p>
            <h1 style={{ margin: '5px 0 0', maxWidth: '90%', color: c.textIce, fontFamily: font.display, fontSize: 25, lineHeight: 1.15, letterSpacing: -.65 }}>{name ? tx(`Bonjour, ${name}`, `Welcome, ${name}`) : tx('Bienvenue dans Lemtel', 'Welcome to Lemtel')}</h1>
          </div>
        </div>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 18, padding: '7px 10px', borderRadius: 999, background: `${c.success}12`, border: `1px solid ${c.success}32`, color: c.textSub, fontSize: 11.5, fontWeight: 650 }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: c.success, boxShadow: `0 0 10px ${c.success}` }} />
          <span>{tx('Organisation vérifiée', 'Verified organization')} · <strong style={{ color: c.textIce }}>{organization}</strong></span>
        </div>
        {snapshot?.brief && <p style={{ position: 'relative', margin: '12px 0 0', maxWidth: '94%', color: c.textSub, fontSize: 12.5, lineHeight: 1.5 }}>{snapshot.brief}</p>}
      </section>

      <section style={{ marginTop: 25 }}>
        <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', padding: '0 2px 11px' }}>
          <div><p style={{ margin: 0, color: c.avaCyan, fontSize: 10, fontWeight: 850, letterSpacing: 1.55, textTransform: 'uppercase' }}>{tx('Actions rapides', 'Quick actions')}</p><h2 style={{ margin: '4px 0 0', color: c.textIce, fontFamily: font.display, fontSize: 20, letterSpacing: -.4 }}>{tx('Tout est à portée de main', 'Everything in reach')}</h2></div>
          <button type="button" onClick={() => navigate('keypad')} aria-label={tx('Composer un numéro', 'Dial a number')} style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 12, background: `${c.lemtelBlue}12`, border: `1px solid ${c.lemtelBlue}32`, color: c.lemtelBlue, cursor: 'pointer' }}><ArrowUpRight size={19} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {actions.map(({ id, Icon, title, detail, tone }) => <button key={id} type="button" onClick={() => navigate(id)} style={{ minHeight: 122, padding: 15, textAlign: 'left', cursor: 'pointer', borderRadius: radius.xl, background: `linear-gradient(145deg, ${tone}1d, ${c.graphite} 82%)`, border: `1px solid ${tone}42`, boxShadow: `0 16px 32px -24px ${tone}bb`, color: c.textIce }}><span style={{ width: 37, height: 37, borderRadius: 12, display: 'grid', placeItems: 'center', color: tone, background: `${tone}18`, border: `1px solid ${tone}3c` }}><Icon size={19} /></span><span style={{ display: 'block', marginTop: 13, fontSize: 14, fontWeight: 800 }}>{title}</span><span style={{ display: 'block', marginTop: 4, color: c.textSub, fontSize: 11, lineHeight: 1.35 }}>{detail}</span></button>)}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <p style={{ margin: '0 0 10px 2px', color: c.avaCyan, fontSize: 10, fontWeight: 850, letterSpacing: 1.55, textTransform: 'uppercase' }}>{tx("Aujourd’hui", 'Today')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <Metric label={tx('Appels', 'Calls')} value={refreshing ? '—' : String(snapshot?.calls?.today ?? 0)} tone={c.lemtelBlue} colors={c} />
          <Metric label={tx('Manqués', 'Missed')} value={refreshing ? '—' : String(snapshot?.calls?.missed ?? 0)} tone={c.signalGold} colors={c} />
          <Metric label={tx('Messages', 'Messages')} value={refreshing ? '—' : String(snapshot?.messages?.unread ?? 0)} tone={c.avaCyan} colors={c} />
        </div>
      </section>

      <section style={{ display: 'flex', gap: 10, marginTop: 18, padding: '14px 15px', borderRadius: radius.xl, background: `${c.mint}0e`, border: `1px solid ${c.mint}32` }}>
        <ShieldCheck size={19} color={c.mint} style={{ flex: '0 0 auto', marginTop: 1 }} />
        <div><div style={{ color: c.textIce, fontSize: 13, fontWeight: 800 }}>{tx('Espace sécurisé par organisation', 'Organization-secured workspace')}</div><div style={{ color: c.textSub, fontSize: 11.5, lineHeight: 1.45, marginTop: 3 }}>{tx('Vos conversations, appels et contacts restent séparés par organisation.', 'Your conversations, calls, and contacts remain separated by organization.')}</div></div>
      </section>

      <div style={{ display: 'grid', justifyItems: 'center', marginTop: 25 }}><PoweredByAva /></div>
    </main>
  );
}

function Metric({ label, value, tone, colors }: { label: string; value: string; tone: string; colors: { graphite: string; textIce: string } }) {
  return <div style={{ minWidth: 0, padding: '12px 10px', borderRadius: radius.lg, background: `linear-gradient(145deg, ${tone}12, ${colors.graphite})`, border: `1px solid ${tone}30` }}><div style={{ overflow: 'hidden', color: tone, fontSize: 9, fontWeight: 850, letterSpacing: 1.05, textOverflow: 'ellipsis', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</div><div style={{ marginTop: 6, color: colors.textIce, fontFamily: font.mono, fontSize: 22, fontWeight: 800 }}>{value}</div></div>;
}
