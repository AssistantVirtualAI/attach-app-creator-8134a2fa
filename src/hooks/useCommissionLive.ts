// Near real-time commission refresh shared by portal and mobile screens.
// The server broadcasts "updated" (no figures) whenever a commission
// snapshot is saved; screens then re-read their own scoped snapshot.
// Fallback: re-read every 60 s while the screen is visible.
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const THROTTLE_MS = 20_000;
const POLL_MS = 60_000;

export function useCommissionLive(onUpdate: () => void) {
  const cb = useRef(onUpdate);
  cb.current = onUpdate;
  useEffect(() => {
    let last = Date.now();
    const fire = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < THROTTLE_MS) return;
      last = Date.now();
      cb.current();
    };
    const channel = supabase
      .channel(`pp-commissions-updates`)
      .on("broadcast", { event: "updated" }, fire)
      .subscribe();
    const id = setInterval(fire, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") fire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      void supabase.removeChannel(channel);
    };
  }, []);
}
