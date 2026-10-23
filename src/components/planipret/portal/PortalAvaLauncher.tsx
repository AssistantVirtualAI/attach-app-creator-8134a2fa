import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import MAvaChat from "@/pages/planipret/mobile/MAvaChat";
import avaLogo from "@/assets/ava-statistics-logo.png.asset.json";

/** Shows the app's AVA (chat + voice, same Maestro tools) in the web portals,
 *  only for profiles with portal_ava_enabled. Uses the signed-in user's own identity. */
export function isPortalAvaAllowed(row: { portal_ava_enabled?: boolean | null } | null | undefined) {
  return row?.portal_ava_enabled === true;
}

export default function PortalAvaLauncher({ authUserId }: { authUserId?: string | null }) {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAllowed(false);
    (async () => {
      const uid = authUserId || (await supabase.auth.getUser()).data.user?.id;
      if (!uid || cancelled) return;
      const { data } = await supabase.from("planipret_profiles").select("portal_ava_enabled").eq("user_id", uid).maybeSingle();
      if (!cancelled) setAllowed(isPortalAvaAllowed(data as any));
    })();
    return () => { cancelled = true; };
  }, [authUserId]);

  if (!allowed) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ouvrir AVA"
          title="AVA"
          className="group fixed bottom-6 right-6 z-[60] w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-[0_8px_30px_hsl(var(--primary)/0.45)] ring-4 ring-primary/20 hover:ring-primary/40 hover:scale-105 transition-all"
        >
          <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping opacity-30 group-hover:opacity-0" />
          <img src={avaLogo.url} alt="" className="relative w-9 h-9 object-contain" />
        </button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-[59] bg-background/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="fixed z-[60] inset-0 sm:inset-auto sm:bottom-6 sm:right-6 sm:top-6 sm:w-[480px] flex flex-col overflow-hidden sm:rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-gradient-to-r from-primary/15 to-transparent">
              <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center">
                <img src={avaLogo.url} alt="" className="w-6 h-6 object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground leading-tight">AVA</div>
                <div className="text-xs text-muted-foreground leading-tight">Assistante Planiprêt · Maestro connecté</div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Fermer AVA" className="p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div id="pp-mobile-frame" className="pp-portal-ava flex-1 min-h-0 flex flex-col overflow-hidden relative">
              <MAvaChat />
            </div>
          </div>
        </>
      )}
    </>
  );
}
