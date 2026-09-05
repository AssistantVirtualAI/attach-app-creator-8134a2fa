import { useState } from "react";
import TaskComposerSheet from "@/components/planipret/mobile/TaskComposerSheet";

/** Dev-only visual harness for the task composer sheet (route /_tc). */
export default function DevTaskComposer() {
  const [open, setOpen] = useState(true);
  if (!import.meta.env.DEV) return null;
  return (
    <div className="planipret-admin-scope min-h-screen" data-pp-theme="dark">
      <div
        id="pp-mobile-frame"
        style={{ position: "relative", width: 390, height: 780, margin: "0 auto", overflow: "hidden", background: "var(--pp-bg-base)" }}
      >
        <div style={{ padding: 16 }}>
          <h1 style={{ color: "var(--pp-text-primary)", fontSize: 18, fontWeight: 600 }}>Toutes mes tâches</h1>
          <p style={{ color: "var(--pp-text-muted)", fontSize: 12 }}>Contenu d'arrière-plan fictif</p>
          <button
            onClick={() => setOpen(true)}
            style={{ marginTop: 12, padding: "10px 16px", borderRadius: 12, background: "var(--pp-brand-accent)", color: "#fff" }}
          >
            Ouvrir
          </button>
        </div>
        <TaskComposerSheet
          open={open}
          lang="fr"
          defaultTarget={null}
          onClose={() => setOpen(false)}
          onSubmit={() => setOpen(false)}
        />
      </div>
    </div>
  );
}
