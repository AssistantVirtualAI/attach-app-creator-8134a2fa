import React from 'react';
import { ArrowUpRight, Building2, Clock3, MessageCircle, Phone, ShieldCheck, UsersRound } from 'lucide-react';
import { useTranslation, type I18nKey } from '../lib/i18n';

export type DesktopWorkspaceDestination = 'phone' | 'calls' | 'messages' | 'contacts';

type Props = {
  displayName: string;
  organizationVerified: boolean;
  onNavigate: (destination: DesktopWorkspaceDestination) => void;
};

const ACTIONS: Array<{
  id: DesktopWorkspaceDestination;
  Icon: typeof Phone;
  title: I18nKey;
  detail: I18nKey;
  tone: string;
}> = [
  { id: 'phone', Icon: Phone, tone: 'var(--ava-accent, #6680ff)', title: 'workspace.newCall', detail: 'workspace.openDialer' },
  { id: 'messages', Icon: MessageCircle, tone: '#21d4fd', title: 'workspace.team', detail: 'workspace.organizationConversations' },
  { id: 'calls', Icon: Clock3, tone: 'var(--ava-warning, #d4a73a)', title: 'workspace.history', detail: 'workspace.callsAndVoicemail' },
  { id: 'contacts', Icon: UsersRound, tone: 'var(--ava-success, #22d39a)', title: 'workspace.directory', detail: 'workspace.yourOrganization' },
];

/**
 * Design-parity home for the authenticated Desktop shell.
 * It intentionally uses only identity and verified-session state supplied by
 * the session bootstrap. It never queries calls, messages, contacts or SIP.
 */
export default function DesktopWorkspaceHome({ displayName, organizationVerified, onNavigate }: Props) {
  const { t } = useTranslation();

  return (
    <section data-testid="lemtel-desktop-home-page" className="desktop-workspace-home" aria-live="polite">
      <section className="desktop-home-hero">
        <span aria-hidden className="desktop-home-orbit" />
        <div className="desktop-home-hero-top">
          <div className="desktop-home-hero-icon"><Building2 size={23} strokeWidth={2.3} /></div>
          <div>
            <p>{t('workspace.workspace')}</p>
            <h2>{t('workspace.welcome')} {displayName}</h2>
          </div>
        </div>
        <div className="desktop-home-verified">
          <span />
          {organizationVerified ? t('workspace.verifiedOrganization') : t('workspace.secureSession')}
        </div>
      </section>

      <section className="desktop-home-section">
        <div className="desktop-home-section-heading">
          <div>
            <p>{t('workspace.quickActions')}</p>
            <h3>{t('workspace.everythingInReach')}</h3>
          </div>
          <button type="button" aria-label={t('workspace.openDialer')} onClick={() => onNavigate('phone')}><ArrowUpRight size={19} /></button>
        </div>
        <div className="desktop-home-actions">
          {ACTIONS.map(({ id, Icon, title, detail, tone }) => (
            <button key={id} type="button" onClick={() => onNavigate(id)} style={{ '--home-tone': tone } as React.CSSProperties}>
              <span><Icon size={20} /></span>
              <strong>{t(title)}</strong>
              <small>{t(detail)}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="desktop-home-section">
        <p className="desktop-home-overline">{t('workspace.today')}</p>
        <div className="desktop-home-metrics" aria-label={t('workspace.waitingForProvisioning')}>
          <Metric label={t('workspace.calls')} tone="var(--ava-accent, #6680ff)" />
          <Metric label={t('workspace.missed')} tone="var(--ava-warning, #d4a73a)" />
          <Metric label={t('workspace.messages')} tone="#21d4fd" />
        </div>
        <p className="desktop-home-pending">{t('workspace.waitingForProvisioning')}</p>
      </section>

      <section className="desktop-home-boundary">
        <ShieldCheck size={20} />
        <div>
          <strong>{t('workspace.organizationSecured')}</strong>
          <p>{t('workspace.organizationSecuredBody')}</p>
        </div>
      </section>
    </section>
  );
}

function Metric({ label, tone }: { label: string; tone: string }) {
  return (
    <div style={{ '--metric-tone': tone } as React.CSSProperties}>
      <span>{label}</span>
      <strong>—</strong>
    </div>
  );
}
