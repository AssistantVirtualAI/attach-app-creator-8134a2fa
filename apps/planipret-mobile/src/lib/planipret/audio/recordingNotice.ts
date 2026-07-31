// Plays the "cet appel est enregistré" notice locally at the start of every
// active call. The audio lives in the private `pbx-audio` bucket
// (`call-recording-notice.wav`) — the same file NetSapiens plays to the caller
// as ring announcement — so both parties hear the same notice.

import { supabase } from "@/integrations/supabase/client";

const BUCKET = "pbx-audio";
const OBJECT = "call-recording-notice.wav";

let cachedUrl: string | null = null;
let cachedAt = 0;

async function getNoticeUrl(): Promise<string | null> {
  if (cachedUrl && Date.now() - cachedAt < 45 * 60 * 1000) return cachedUrl;
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(OBJECT, 3600);
    if (data?.signedUrl) {
      cachedUrl = data.signedUrl;
      cachedAt = Date.now();
      return cachedUrl;
    }
  } catch { /* non-fatal */ }
  return null;
}

/** Best-effort playback of the recording notice. Never throws, never blocks. */
export async function playRecordingNotice(): Promise<void> {
  try {
    const url = await getNoticeUrl();
    if (!url) return;
    const el = new Audio(url);
    el.volume = 0.9;
    // Do not steal the call's audio session on iOS: keep it inline.
    (el as any).playsInline = true;
    await el.play().catch(() => {});
  } catch { /* non-fatal — never break a call for the notice */ }
}
