import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Clock3, MessageCircle, Phone, ShieldCheck, UsersRound } from 'lucide-react';
import { colors, font, radius, shadow } from '../lib/theme';
import { mobileApi } from '../lib/mobileApi';
import { useT } from '../lib/i18n';
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

export default function HomeScreen({ onNavigate, haptic, onOpenProfile }: HomeScreenProps) {
  const { tx } = useT();
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
  const go = (tab: Tab) => {
    void haptic?.();
    onNavigate(tab);
  };

  const actions: Array<{ id: Tab; icon: React.ReactNode; title: string; detail: string; tone: string }> = [
    { id: 'keypad', icon: <Phone size={20} />, tone: colors.lemtelBlue, title: tx('Nouvel appel', 'New call'), detail: tx('Ouvrir le clavier', 'Open keypad') },
    { id: 'chats', icon: <MessageCircle size={20} />, tone: colors.avaCyan, title: tx('Équipe', 'Team'), detail: tx('Conversations de l’organisation', 'Organization conversations') },
    { id: 'calls', icon: <Clock3 size={20} />, tone: colors.signalGold, title: tx('Historique', 'History'), detail: tx('Appels et messages vocaux', 'Calls and voicemail') },
    { id: 'contacts', icon: <UsersRound size={20} />, tone: colors.mint, title: tx('Répertoire', 'Directory'), detail: tx('Votre organisation', 'Your organization') },
  ];

  return (
    <main style={{ height: '100%', overflowY: 'auto', padding: '8px 16px 132px' }}>
      <section style={{
        position: 'relative', overflow: 'hidden', borderRadius: 24, padding: '20px 18px 18px',
        background: `radial-gradient(circle at 92% 4%, ${colors.avaCyan}44 0, transparent 40%), radial-gradient(circle at 12% 100%, ${colors.lemtelBlue}66 0, transparent 56%), ${colors.graphite}`,
        border: `1px solid ${colors.lemtelBlue}66`, boxShadow: shadow.lift,
      }}>
        <span aria-hidden style={{
          position: 'absolute', right: -30, bottom: -44, width: 150, height: 150, borderRadius: 999,
          border: `1px solid ${colors.avaCyan}44`, boxShadow: `0 0 0 22px ${colors.avaCyan}0d, 0 0 0 44px ${colors.avaCyan}08`,
        }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button onClick={onOpenProfile} aria-label={tx('Ouvrir le profil', 'Open profile')} style={{
            width: 42, height: 42, borderRadius: 14, display: 'grid', placeItems: 'center', cursor: 'pointer',
            border: `1px solid ${colors.avaCyan}66`, color: '#fff', background: `${colors.avaCyan}1f`, fontWeight: 800,
          }}>{name ? name.slice(0, 2).toUpperCase() : 'L'}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: colors.avaCyan, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.6 }}>
              {tx('Espace de travail', 'Workspace')}
            </div>
            <h1 style={{ margin: '3px 0 0', color: colors.textIce, fontSize: 23, lineHeight: 1.18, letterSpacing: -0.45 }}>
              {name ? tx(`Bonjour, ${name}`, `Welcome, ${name}`) : tx('Bienvenue dans Lemtel', 'Welcome to Lemtel')}
            </h1>
          </div>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 7, marginTop: 18, color: colors.textSub, fontSize: font.sm }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: colors.success, boxShadow: `0 0 12px ${colors.success}` }} />
          <span>{tx('Connecté à', 'Connected to')} <strong style={{ color: colors.textIce }}>{organization}</strong></span>
        </div>
        {snapshot?.brief && <p style={{ position: 'relative', margin: '10px 0 0', maxWidth: '85%', color: colors.textSub, fontSize: 12, lineHeight: 1.45 }}>{snapshot.brief}</p>}
      </section>

      <section style={{ marginTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 3px 10px' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, color: colors.signalGold, textTransform: 'uppercase' }}>{tx('Actions rapides', 'Quick actions')}</div>
            <h2 style={{ margin: '3px 0 0', fontSize: 19, color: colors.textIce }}>{tx('Tout est à portée de main', 'Everything in reach')}</h2>
          </div>
          <button onClick={() => go('keypad')} aria-label={tx('Composer un numéro', 'Dial a number')} style={{ background: 'transparent', border: 'none', color: colors.avaCyan, cursor: 'pointer', padding: 4 }}><ArrowUpRight size={20} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {actions.map((action) => (
            <button key={action.id} onClick={() => go(action.id)} style={{
              minHeight: 118, padding: 14, textAlign: 'left', cursor: 'pointer', borderRadius: radius.xl,
              background: `linear-gradient(145deg, ${action.tone}1f, ${colors.graphite} 78%)`,
              border: `1px solid ${action.tone}44`, boxShadow: `0 14px 30px -22px ${action.tone}bb`, color: colors.textIce,
            }}>
              <span style={{ width: 34, height: 34, borderRadius: 12, display: 'grid', placeItems: 'center', color: action.tone, background: `${action.tone}22`, border: `1px solid ${action.tone}44` }}>{action.icon}</span>
              <span style={{ display: 'block', marginTop: 12, fontWeight: 800, fontSize: 14 }}>{action.title}</span>
              <span style={{ display: 'block', marginTop: 3, color: colors.textSub, fontSize: 11, lineHeight: 1.35 }}>{action.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 22 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, color: colors.signalGold, textTransform: 'uppercase', padding: '0 3px 10px' }}>{tx("Aujourd’hui", 'Today')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Metric label={tx('Appels', 'Calls')} value={refreshing ? '—' : String(snapshot?.calls?.today ?? 0)} tone={colors.lemtelBlue} />
          <Metric label={tx('Manqués', 'Missed')} value={refreshing ? '—' : String(snapshot?.calls?.missed ?? 0)} tone={colors.signalGold} />
          <Metric label={tx('Messages', 'Messages')} value={refreshing ? '—' : String(snapshot?.messages?.unread ?? 0)} tone={colors.avaCyan} />
        </div>
      </section>

      <section style={{ marginTop: 18, padding: '14px 15px', borderRadius: radius.xl, background: `${colors.mint}0f`, border: `1px solid ${colors.mint}38`, display: 'flex', gap: 10 }}>
        <ShieldCheck size={19} color={colors.mint} style={{ flex: '0 0 auto', marginTop: 1 }} />
        <div>
          <div style={{ color: colors.textIce, fontSize: 13, fontWeight: 800 }}>{tx('Espace sécurisé par organisation', 'Organization-secured workspace')}</div>
          <div style={{ color: colors.textSub, fontSize: 11, lineHeight: 1.45, marginTop: 3 }}>{tx('Vos conversations, appels et contacts restent séparés par organisation.', 'Your conversations, calls, and contacts remain separated by organization.')}</div>
        </div>
      </section>

      <div style={{ display: 'grid', justifyItems: 'center', marginTop: 24 }}><PoweredByAva /></div>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={{ borderRadius: radius.lg, padding: '12px 10px', background: `${tone}12`, border: `1px solid ${tone}33` }}>
      <div style={{ color: tone, fontSize: 9, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ marginTop: 5, color: colors.textIce, fontSize: 22, fontWeight: 800, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{value}</div>
    </div>
  );
}
