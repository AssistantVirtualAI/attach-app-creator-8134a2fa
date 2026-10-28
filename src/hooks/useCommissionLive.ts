// Near real-time commission refresh shared by portal and mobile screens.
// The server broadcasts "updated" (no figures) whenever a commission
// snapshot is saved; screens then re-read their own scoped snapshot.
// No timed polling or unconditional tab-focus reloads.
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invalidateCommissionCache } from "@/lib/planipret/commissionClientCache";

// One shared subscription for every mounted screen.
const listeners = new Set<() => void>();
let channel: ReturnType<typeof supabase.channel> | null = null;
function ensureChannel() {
  if (channel || typeof (supabase as any).channel !== "function") return;
  try {
    channel = supabase
      .channel("pp-commissions-updates")
      .on("broadcast", { event: "updated" }, () => {
        // New server snapshot: drop the device copy so screens re-read it.
        invalidateCommissionCache();
        listeners.forEach((l) => l());
      })
      .subscribe();
  } catch { channel = null; /* explicit refresh remains available */ }
}
function releaseChannel() {
  if (listeners.size || !channel) return;
  try { void supabase.removeChannel(channel); } catch { /* ignore */ }
  channel = null;
}

export function useCommissionLive(onUpdate: () => void) {
  const cb = useRef(onUpdate);
  cb.current = onUpdate;
  useEffect(() => {
    let pending = false;
    const fire = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") { pending = true; return; }
      pending = false;
      cb.current();
    };
    listeners.add(fire);
    ensureChannel();
    const onVis = () => { if (pending && document.visibilityState === "visible") fire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      listeners.delete(fire);
      releaseChannel();
    };
  }, []);
}
