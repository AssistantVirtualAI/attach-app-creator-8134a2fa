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
          className="fixed bottom-6 right-6 z-[60] w-14 h-14 rounded-full shadow-lg bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition"
        >
          <img src={avaLogo.url} alt="" className="w-8 h-8 object-contain" />
        </button>
      )}
      {open && (
        <div className="fixed inset-y-0 right-0 z-[60] w-full sm:w-[440px] flex flex-col bg-background border-l border-border shadow-2xl">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <span className="text-sm font-semibold text-foreground">AVA</span>
            <button onClick={() => setOpen(false)} aria-label="Fermer AVA" className="p-1 rounded hover:bg-muted text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div id="pp-mobile-frame" className="flex-1 min-h-0 overflow-y-auto relative">
            <MAvaChat />
          </div>
        </div>
      )}
    </>
  );
}
