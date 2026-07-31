import React, { useEffect, useState } from 'react';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabaseClient';
import { useTranslation, type I18nKey } from '../../lib/i18n';
import StatusPill from '../ui/StatusPill';
import StateView from '../ui/StateView';

const { colors: c } = theme;

const DAY_KEYS: I18nKey[] = ['day.sun', 'day.mon', 'day.tue', 'day.wed', 'day.thu', 'day.fri', 'day.sat'];
type Hour = {
  day_of_week: number;
  is_working_day: boolean;
  start_time: string;
  end_time: string;
  break_start?: string | null;
  break_end?: string | null;
  timezone?: string;
};
type Handling = {
  availability: string;
  after_hours_action: string;
  forward_target: string | null;
  timezone: string;
};

const AVAIL = ['available', 'busy', 'do_not_disturb', 'away', 'vacation'];
const AFTER = ['voicemail', 'forward_extension', 'forward_external', 'org_default'];

async function call(action: string, payload?: any) {
  const { data, error } = await supabase.functions.invoke('user-telecom-settings', { body: { action, payload } });
  if (error) throw error;
  if (data?.error) throw new Error(data.detail || data.error);
  return data;
}

function SaveBadge({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return <span style={{ fontSize: 11, color: c.mutedSilver }}>—</span>;
  if (status === 'saving') return <StatusPill variant="sync-pending" pulse />;
  if (status === 'saved') return <StatusPill variant="connected" />;
  return <StatusPill variant="sync-failed" />;
}

export default function TelecomSettingsView() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [ext, setExt] = useState<any>(null);
  const [hours, setHours] = useState<Hour[]>([]);
  const [handling, setHandling] = useState<Handling>({
    availability: 'available',
    after_hours_action: 'voicemail',
    forward_target: null,
    timezone: 'America/Toronto',
  });
  const [hStatus, setHStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [cStatus, setCStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await call('get');
        setExt(d.extension);
        const map = new Map<number, Hour>();
        (d.working_hours ?? []).forEach((h: Hour) => map.set(h.day_of_week, h));
        const filled: Hour[] = Array.from({ length: 7 }).map((_, i) =>
          map.get(i) ?? {
            day_of_week: i,
            is_working_day: i >= 1 && i <= 5,
            start_time: '09:00',
            end_time: '17:00',
            break_start: null,
            break_end: null,
            timezone: 'America/Toronto',
          }
        );
        setHours(filled);
        if (d.call_handling) setHandling({ ...handling, ...d.call_handling });
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveHours = async () => {
    setHStatus('saving');
    try { await call('save_hours', { days: hours }); setHStatus('saved'); }
    catch (e: any) { setErr(e.message); setHStatus('error'); }
  };
  const saveHandling = async () => {
    setCStatus('saving');
    try { await call('save_handling', handling); setCStatus('saved'); }
    catch (e: any) { setErr(e.message); setCStatus('error'); }
  };
  const resetDefault = async () => {
    setHStatus('saving');
    try { await call('reset_to_org_default'); const d = await call('get'); setHours(d.working_hours); setHStatus('saved'); }
    catch (e: any) { setErr(e.message); setHStatus('error'); }
  };

  if (loading) return <StateView mode="loading" />;

  return (
    <div style={{ padding: '24px 28px', overflowY: 'auto', height: '100%' }}>
      <header style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, color: c.textIce, margin: 0 }}>{t('telecom.title')}</h1>
        <div style={{ marginTop: 6, fontSize: 12, color: c.mutedSilver }}>
          {t('telecom.extension')} <b style={{ color: c.textIce }}>{ext?.extension ?? '—'}</b> · {ext?.display_name ?? ''} · {ext?.sip_domain ?? ''}
        </div>
      </header>

      {err && <div style={{ padding: 10, marginBottom: 14, background: 'rgba(239,68,68,0.12)', border: `1px solid ${c.danger}55`, borderRadius: 8, color: c.danger, fontSize: 12 }}>{err}</div>}

      {/* Working hours */}
      <section style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, padding: 18, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 14, color: c.textIce, margin: 0, letterSpacing: 0.5 }}>{t('telecom.workingHours')}</h2>
          <SaveBadge status={hStatus} />
        </div>
        {hours.map((h, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 80px 1fr 1fr 100px', gap: 8, padding: '6px 0', alignItems: 'center', borderTop: i ? `1px solid ${c.border}` : 'none' }}>
            <span style={{ color: c.textIce, fontSize: 12, fontWeight: 600 }}>{t(DAY_KEYS[h.day_of_week])}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: c.mutedSilver }}>
              <input type="checkbox" checked={h.is_working_day} onChange={(e) => { const v = [...hours]; v[i] = { ...h, is_working_day: e.target.checked }; setHours(v); }} />
              {t('telecom.on')}
            </label>
            <input type="time" value={h.start_time} disabled={!h.is_working_day}
              onChange={(e) => { const v = [...hours]; v[i] = { ...h, start_time: e.target.value }; setHours(v); }}
              style={inputStyle} />
            <input type="time" value={h.end_time} disabled={!h.is_working_day}
              onChange={(e) => { const v = [...hours]; v[i] = { ...h, end_time: e.target.value }; setHours(v); }}
              style={inputStyle} />
            <span style={{ fontSize: 10, color: c.mutedSilver }}>{h.timezone}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={saveHours} style={primaryBtn}>{t('telecom.saveSchedule')}</button>
          <button onClick={resetDefault} style={ghostBtn}>{t('telecom.resetDefault')}</button>
        </div>
      </section>

      {/* Availability + handling */}
      <section style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 14, color: c.textIce, margin: 0, letterSpacing: 0.5 }}>{t('telecom.handling')}</h2>
          <SaveBadge status={cStatus} />
        </div>
        <Row label={t('telecom.availability')}>
          <select value={handling.availability} onChange={(e) => setHandling({ ...handling, availability: e.target.value })} style={inputStyle}>
            {AVAIL.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>
        </Row>
        <Row label={t('telecom.afterHours')}>
          <select value={handling.after_hours_action} onChange={(e) => setHandling({ ...handling, after_hours_action: e.target.value })} style={inputStyle}>
            {AFTER.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>
        </Row>
        {handling.after_hours_action.startsWith('forward') && (
          <Row label={handling.after_hours_action === 'forward_external' ? t('telecom.externalNumber') : t('telecom.extension')}>
            <input type="text" value={handling.forward_target ?? ''} onChange={(e) => setHandling({ ...handling, forward_target: e.target.value })} placeholder="e.g. 201 or +15145550123" style={inputStyle} />
          </Row>
        )}
        <button onClick={saveHandling} style={{ ...primaryBtn, marginTop: 14 }}>{t('telecom.saveHandling')}</button>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, padding: '8px 0', alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: c.mutedSilver, fontWeight: 600 }}>{label}</span>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 12, borderRadius: 8, color: c.textIce,
  background: 'rgba(140,180,255,0.06)', border: `1px solid ${c.border}`,
};
const primaryBtn: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', color: c.onAccent, fontWeight: 700, fontSize: 12,
  background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
};
const ghostBtn: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 600,
  background: 'transparent', color: c.mutedSilver, border: `1px solid ${c.border}`,
};
