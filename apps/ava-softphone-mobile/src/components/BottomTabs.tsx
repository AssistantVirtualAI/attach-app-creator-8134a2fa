import React from 'react';
import { History, Home, LayoutGrid, MessageCircle, Phone, Users, type LucideIcon } from 'lucide-react';
import { colors, radius } from '../lib/theme';
import { useT } from '../lib/i18n';
import { useTheme } from '../lib/ThemeContext';

export type Tab =
  | 'contacts' | 'chats' | 'calls' | 'keypad' | 'speeddial'
  | 'home' | 'ava' | 'messages' | 'settings' | 'more' | 'voicemail' | 'sms' | 'queues'
  | 'audiodiag' | 'permissions';

type Item = { id: Tab; fr: string; en: string; Icon: LucideIcon };

/** Same pages, order, icons and names as the Desktop workspace rail (Home · Phone · Calls · Chats · Contacts · Settings). */
export const TABS: Item[] = [
  { id: 'home', fr: 'Accueil', en: 'Home', Icon: Home },
  { id: 'keypad', fr: 'Téléphone', en: 'Phone', Icon: Phone },
  { id: 'calls', fr: 'Appels', en: 'Calls', Icon: History },
  { id: 'chats', fr: 'Messages', en: 'Chats', Icon: MessageCircle },
  { id: 'contacts', fr: 'Contacts', en: 'Contacts', Icon: Users },
  { id: 'settings', fr: 'Paramètres', en: 'Settings', Icon: LayoutGrid },
];

/** Bottom navigation: the Desktop rail, docked at the bottom of the phone screen. */
export default function BottomTabs({
  active, onChange, badges,
}: { active: Tab; onChange: (tab: Tab) => void; badges?: Partial<Record<Tab, number>> }) {
  const { tx } = useT();
  const { mode } = useTheme();
  const dark = mode === 'dark';
  return (
    <nav
      data-bottom-nav="true"
      aria-label="Primary navigation"
      style={{
        position: 'fixed', zIndex: 50, bottom: 0, left: 0, right: 0,
        width: 'min(calc(100% - 16px), 540px)', margin: '0 auto calc(env(safe-area-inset-bottom, 0px) + 4px)',
        padding: '8px 8px 7px', borderRadius: radius.xxl,
        background: `linear-gradient(180deg, ${colors.navSurface} 0%, ${colors.graphite} 100%)`,
        border: `1px solid ${colors.border}`,
        boxShadow: dark
          ? '0 24px 60px -28px rgba(0,0,0,.82), inset 0 1px 0 rgba(255,255,255,.09)'
          : '0 22px 56px -26px rgba(0,35,230,.34), inset 0 1px 0 rgba(255,255,255,.96)',
        backdropFilter: 'blur(24px) saturate(160%)',
        WebkitBackdropFilter: 'blur(24px) saturate(160%)',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))`, alignItems: 'center', gap: 2 }}>
        {TABS.map((item) => (
          <TabButton
            key={item.id}
            dark={dark}
            label={tx(item.fr, item.en)}
            Icon={item.Icon}
            active={active === item.id}
            badge={badges?.[item.id]}
            onPress={() => onChange(item.id)}
          />
        ))}
      </div>
    </nav>
  );
}

function TabButton({ label, Icon, active, badge, onPress, dark }: { label: string; Icon: LucideIcon; active: boolean; badge?: number; onPress: () => void; dark: boolean }) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      onClick={onPress}
      style={{
        position: 'relative', minHeight: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
        padding: '5px 2px', borderRadius: radius.lg, cursor: 'pointer',
        border: active ? (dark ? '1px solid rgba(128,173,255,.5)' : `1px solid ${colors.lemtelBlue}40`) : '1px solid transparent',
        background: active ? (dark ? 'linear-gradient(100deg, rgba(55,97,255,.56), rgba(34,212,253,.16))' : `linear-gradient(180deg, ${colors.lemtelBlue}24, ${colors.lemtelBlue}0e)`) : 'transparent',
        color: active ? (dark ? '#ffffff' : colors.lemtelBlue) : colors.mutedSilver,
        boxShadow: active ? '0 12px 28px -20px rgba(35,96,255,.95)' : 'none',
        transform: active ? 'translateY(-2px)' : 'none',
        transition: 'transform 160ms cubic-bezier(.2,.7,.2,1), color 160ms ease, background 160ms ease, box-shadow 160ms ease',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span style={{ position: 'relative', display: 'grid', placeItems: 'center', width: 27, height: 27, borderRadius: 10, background: active ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.04)' }}>
        <Icon size={19} strokeWidth={active ? 2.5 : 2} />
        {badge && badge > 0 ? (
          <span aria-label={`${badge} new`} style={{ position: 'absolute', top: -5, right: -7, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 9, display: 'grid', placeItems: 'center', background: colors.danger, color: '#fff', border: `2px solid ${colors.midnight}`, boxShadow: `0 2px 7px ${colors.danger}66`, fontSize: 9, fontWeight: 850, lineHeight: 1 }}>
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </span>
      <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 9.5, fontWeight: active ? 800 : 650, letterSpacing: .15 }}>{label}</span>
    </button>
  );
}
