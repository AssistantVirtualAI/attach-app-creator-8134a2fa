import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import SkeletonRows from './ui/SkeletonRows';

/**
 * Embedded portal tab for the desktop softphone.
 * Calls `desktop-portal-token` to get a magic-link URL, then loads it in a webview/iframe.
 */
export function PortalTab() {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("desktop-portal-token", { body: {} });
        if (error) throw error;
        setUrl(data?.action_link || data?.url);
      } catch (e: any) {
        setErr(e.message || "Failed to load portal");
      }
    })();
  }, []);

  if (err) return <div className="p-6 text-sm text-red-500">{err}</div>;
  if (!url) return <SkeletonRows rows={4} padding={24} label="Loading portal" />;

  // In Electron, prefer <webview>; fall back to <iframe> in browser dev.
  const isElectron = typeof (window as any).electron !== "undefined";
  return isElectron ? (
    // @ts-expect-error — webview is an Electron-only element
    <webview src={url} style={{ width: "100%", height: "100%", border: "none" }} allowpopups="true" />
  ) : (
    <iframe src={url} title="AVA Portal" className="w-full h-full border-0" />
  );
}
