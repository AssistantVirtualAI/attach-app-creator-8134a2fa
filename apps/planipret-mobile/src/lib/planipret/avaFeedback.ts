// AVA feedback helper: capture the broker's current screen and upload it to the
// private feedback bucket so AVA (chat or voice) can attach it to a report.
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "pp-feedback-screenshots";
const LAST_PAGE_KEY = "pp_last_page_before_ava";

/** Remember the last non-AVA page so AVA knows which screen the issue is about. */
export function rememberPageForAva(path: string) {
  try { if (!/\/ava/i.test(path)) sessionStorage.setItem(LAST_PAGE_KEY, path); } catch { /* ignore */ }
}
export function lastPageBeforeAva(): string {
  try { return sessionStorage.getItem(LAST_PAGE_KEY) || window.location.pathname; } catch { return window.location.pathname; }
}

/** Screenshot of what is on screen. Elements with data-html2canvas-ignore (AVA overlay) are skipped. */
export async function captureScreenBlob(): Promise<Blob | null> {
  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(document.body, {
      useCORS: true, logging: false, backgroundColor: null,
      scale: Math.min(2, window.devicePixelRatio || 1),
      width: window.innerWidth, height: window.innerHeight,
      x: window.scrollX, y: window.scrollY,
    });
    return await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.85));
  } catch (e) {
    console.warn("[avaFeedback] capture failed", e);
    return null;
  }
}

/** Capture + upload. Returns the storage path (or null when capture fails). */
export async function captureAndUploadScreenshot(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const blob = await captureScreenBlob();
  if (!blob) return null;
  const path = `${user.id}/${Date.now()}-ava-screen.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) { console.warn("[avaFeedback] upload failed", error.message); return null; }
  return path;
}
