import React, { useEffect, useState } from 'react';
import { theme } from '../../lib/theme';

const { colors: c } = theme;

const STORAGE_KEY = 'lemtel.desktop.tour.v2';

interface Step {
  title: string;
  body: string;
  selector?: string;
}

function buildSteps(opts: { isAdmin: boolean; isSuperAdmin: boolean }): Step[] {
  const base: Step[] = [
    {
      title: '👋 Welcome to AVA Desktop',
      body:
        'This is your unified desktop cockpit. Everything you can do in the web portal is here: dial, calls, recordings, messages, voicemail and AI.',
    },
    {
      title: '📞 Make a call',
      body:
        'Use the Dialer or jump to a contact and click call. Active calls dock at the top so you can keep working while in-call.',
      selector: 'nav button[aria-label="Dialer"]',
    },
    {
      title: '🎧 Recordings & Voicemail',
      body:
        'Click play on any row to listen instantly. Recordings now stream straight through the desktop without leaving the app.',
      selector: 'nav button[aria-label="Recordings"]',
    },
    {
      title: '🤖 AVA AI',
      body:
        'Press Cmd/Ctrl+J to toggle the AI panel. Ask AVA to summarize a call, draft a follow-up SMS, or look up a customer.',
    },
  ];

  if (opts.isAdmin) {
    base.push({
      title: '🛠 Admin tools',
      body:
        'As an org admin you can manage Customers, Voice Agents, Reports and the Admin console — all from the left rail.',
      selector: 'nav button[aria-label="Admin"]',
    });
  }

  if (opts.isSuperAdmin) {
    base.push({
      title: '👑 Super Admin · Platform',
      body:
        'You can switch across every organization and access platform-wide controls: all calls, all customers, voice agents and AI admin. Regular admins only see their own org.',
    });
  }

  base.push({
    title: '⚙️ Settings & theme',
    body:
      'Open Settings to switch language, toggle light/dark, sign out, or restart the tour anytime from "Restart tour".',
  });

  return base;
}

export default function DesktopTour({
  isAdmin,
  isSuperAdmin,
  forceOpen,
  onClose,
}: {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (forceOpen) { setOpen(true); setStep(0); return; }
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) setOpen(true);
    } catch { /* ignore */ }
  }, [forceOpen]);

  if (!open) return null;
  const steps = buildSteps({ isAdmin, isSuperAdmin });
  const cur = steps[Math.min(step, steps.length - 1)];

  const close = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
    setOpen(false);
    onClose?.();
  };

  const next = () => {
    if (step >= steps.length - 1) close();
    else setStep(step + 1);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(4,8,16,0.72)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div style={{
        width: 460, maxWidth: '100%',
        background: `linear-gradient(160deg, ${c.deepPanel}, ${c.midnight})`,
        border: `1px solid ${c.borderAI}`,
        borderRadius: 18,
        boxShadow: '0 30px 80px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(122,76,255,0.25)',
        padding: 24,
        color: c.textIce,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: 2,
          color: c.signalGold, textTransform: 'uppercase', marginBottom: 8,
        }}>
          Tour · Step {step + 1} of {steps.length}
        </div>
        <h2 style={{ margin: '4px 0 10px', fontSize: 22, fontWeight: 700 }}>
          {cur.title}
        </h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: c.mutedSilver }}>
          {cur.body}
        </p>

        {/* Progress */}
        <div style={{
          display: 'flex', gap: 4, marginTop: 18,
        }}>
          {steps.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i <= step ? c.signalGold : c.overlay08,
              transition: 'background .25s',
            }} />
          ))}
        </div>

        <div style={{
          marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <button onClick={close} style={{
            background: 'transparent', border: 'none',
            color: c.mutedSilver, fontSize: 12, cursor: 'pointer',
            padding: '8px 4px',
          }}>
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} style={{
                padding: '8px 14px', borderRadius: 9,
                background: 'transparent', border: `1px solid ${c.border}`,
                color: c.textIce, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>
                Back
              </button>
            )}
            <button onClick={next} style={{
              padding: '8px 18px', borderRadius: 9,
              background: `linear-gradient(135deg, ${c.avaViolet}, ${c.avaCyan})`,
              border: 'none', color: c.onAccent, fontSize: 12, fontWeight: 700,
              cursor: 'pointer', letterSpacing: 0.4,
              boxShadow: `0 6px 20px -8px ${c.avaViolet}`,
            }}>
              {step >= steps.length - 1 ? 'Get started' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
