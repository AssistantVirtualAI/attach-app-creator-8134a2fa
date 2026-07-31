// Dedicated UI modal that explains a duplicate-resource conflict surfaced by
// the PBX create flow and lets the admin choose to OPEN the existing record
// for editing, or ABORT. The exact choice is returned via `onResolve` so the
// create-flow can record it in the audit log (resolution: open_for_edit | abort).
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../../../lib/theme';

const { colors: c } = theme;

export type ConflictKind = 'extension' | 'ivr' | 'queue';

const KIND_LABEL: Record<ConflictKind, string> = {
  extension: 'Extension',
  ivr: 'Auto-Attendant',
  queue: 'Call Queue',
};

export default function ConflictResolutionModal({
  kind,
  identifier,
  existing,
  onResolve,
}: {
  kind: ConflictKind;
  identifier: string;
  existing: any;
  onResolve: (choice: 'open_for_edit' | 'abort') => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onResolve('abort'); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onResolve]);

  const remoteVersion = existing?.updated_at || existing?.modified_date || existing?.pbx_uuid || existing?.id || '—';

  return createPortal(
    <div
      onClick={() => onResolve('abort')}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(2,6,20,0.82)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'grid', placeItems: 'center', padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          background: c.bgCard,
          border: `1px solid ${(c as any).borderAI || c.border}`,
          borderRadius: 14, padding: 22, color: c.textIce,
          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.85)',
        }}
      >
        <div id="conflict-title" style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
          Duplicate {KIND_LABEL[kind]} detected
        </div>
        <div style={{ fontSize: 12.5, color: c.mutedSilver, marginBottom: 14, lineHeight: 1.5 }}>
          A {KIND_LABEL[kind].toLowerCase()} matching <strong style={{ color: c.textIce }}>{identifier}</strong> already
          exists on this PBX. Creating it again would overwrite the remote record.
          Choose how to proceed — your choice is recorded in the audit log.
        </div>
        <div style={{
          background: c.overlay04, border: `1px solid ${c.border}`,
          borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 11.5, color: c.mutedSilver,
        }}>
          <div><span style={{ color: c.mutedSilver }}>Remote id:</span> <code style={{ color: c.textIce }}>{existing?.id || existing?.pbx_uuid || '—'}</code></div>
          <div><span style={{ color: c.mutedSilver }}>Remote version:</span> <code style={{ color: c.textIce }}>{remoteVersion}</code></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => onResolve('abort')}
            data-testid="conflict-abort"
            style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce, cursor: 'pointer',
            }}
          >Abort</button>
          <button
            onClick={() => onResolve('open_for_edit')}
            data-testid="conflict-open-edit"
            autoFocus
            style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
              border: 'none', color: c.onAccent, cursor: 'pointer',
            }}
          >Open existing for edit</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
