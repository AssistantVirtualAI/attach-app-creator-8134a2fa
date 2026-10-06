import { ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

export function LemtelMonogram({ size = 36 }: { size?: number }) {
  return (
    <span aria-hidden className="lt-monogram inline-flex items-center justify-center font-extrabold rounded-xl"
      style={{ width: size, height: size, fontSize: size * 0.5, letterSpacing: "-0.04em" }}>L</span>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId();
  const dId = error || hint ? `${id}-d` : undefined;
  return (
    <div>
      <label htmlFor={id} className="lt-label">{label}</label>
      {children(id, dId)}
      {error ? <p id={dId} className="lt-error mt-1" role="alert">{error}</p> : hint ? <p id={dId} className="lt-ink-2 text-xs mt-1">{hint}</p> : null}
    </div>
  );
}

export function Panel({ open, onClose, title, side = false, children, footer, wide = false }: {
  open: boolean; onClose: () => void; title: string; side?: boolean; wide?: boolean; children: ReactNode; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,select,button,textarea")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={`fixed inset-0 z-50 lt-overlay flex ${side ? "justify-end" : "items-center justify-center p-4"}`} onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className={`lt-card flex flex-col ${side ? "h-full w-full max-w-[460px] rounded-none" : `w-full ${wide ? "max-w-[880px]" : "max-w-[560px]"} max-h-[90vh]`}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "hsl(var(--lt-border))" }}>
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="lt-btn lt-btn-ghost !p-2"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="px-6 py-4 border-t flex justify-end gap-2" style={{ borderColor: "hsl(var(--lt-border))" }}>{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, message, confirmLabel, cancelLabel, danger, busy, onConfirm, onCancel }: {
  open: boolean; message: string; confirmLabel: string; cancelLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Panel open={open} onClose={onCancel} title={confirmLabel}
      footer={<>
        <button className="lt-btn lt-btn-ghost" onClick={onCancel}>{cancelLabel}</button>
        <button className={`lt-btn ${danger ? "lt-btn-danger" : "lt-btn-gold"}`} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </>}>
      <p className="text-sm leading-relaxed">{message}</p>
    </Panel>
  );
}

export function EmptyState({ icon, text, action }: { icon: ReactNode; text: string; action?: ReactNode }) {
  return (
    <div className="lt-card p-10 flex flex-col items-center text-center gap-3">
      <div className="lt-chip-cyan lt-chip !p-3 !rounded-2xl">{icon}</div>
      <p className="lt-ink-2 text-sm">{text}</p>
      {action}
    </div>
  );
}
