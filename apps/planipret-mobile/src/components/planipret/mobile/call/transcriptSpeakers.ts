// Transcript speaker display: turns raw SIP labels into readable names.
// Identity comes only from the explicit source label (never inferred turns).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SpeakerCtx = {
  brokerExt?: string | null;
  brokerName?: string | null;
  contactsByPhone?: Record<string, string>;
  internalByExt?: Record<string, string>;
};

/** Undo literal escape sequences such as \' \" \n left by some providers. */
export function unescapeTranscript(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\\(['"\\])/g, "$1");
}

/** Extract the user part of a SIP label: "sip:1284M@planipret.ca" -> "1284M". */
export function parseSipSpeaker(speaker?: string | null): string | null {
  const m = (speaker ?? "").trim().match(/^<?sips?:([^@>;\s]+)(?:@[^>\s]*)?>?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

const digits = (s: string) => s.replace(/\D/g, "");
const phoneKey = (s: string) => { const d = digits(s); return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; };
const extOf = (user: string) => { const m = user.match(/^(\d{2,6})[a-z]?$/i); return m ? m[1] : null; };

export function formatPhone(raw: string): string {
  const d = phoneKey(raw);
  return d.length === 10 ? `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}

/** Returns a readable name for a SIP speaker, or null when not a SIP label. */
export function resolveSpeakerName(speaker: string | null | undefined, ctx: SpeakerCtx): string | null {
  const user = parseSipSpeaker(speaker);
  if (!user) return null;
  const ext = extOf(user);
  if (ext) {
    if (ctx.brokerExt && ext === ctx.brokerExt) return ctx.brokerName || `Poste ${ext}`;
    return ctx.internalByExt?.[ext] || `Poste ${ext}`;
  }
  const key = phoneKey(user);
  if (key.length >= 7) return ctx.contactsByPhone?.[key] || formatPhone(user);
  return user;
}

let cached: Promise<SpeakerCtx> | null = null;
async function loadCtx(): Promise<SpeakerCtx> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return {};
  const [me, internal, contacts] = await Promise.all([
    supabase.from("planipret_profiles").select("extension,full_name").eq("user_id", uid).maybeSingle(),
    supabase.from("planipret_profiles").select("extension,full_name").not("extension", "is", null).limit(500),
    supabase.from("planipret_contacts").select("full_name,phone,mobile,phone_normalized").eq("user_id", uid).limit(5000),
  ]);
  const internalByExt: Record<string, string> = {};
  for (const p of (internal.data ?? []) as any[]) if (p.extension && p.full_name) internalByExt[String(p.extension)] = p.full_name;
  const contactsByPhone: Record<string, string> = {};
  for (const c of (contacts.data ?? []) as any[]) {
    if (!c.full_name) continue;
    for (const n of [c.phone_normalized, c.phone, c.mobile]) if (n) { const k = phoneKey(String(n)); if (k.length >= 7) contactsByPhone[k] ??= c.full_name; }
  }
  return { brokerExt: (me.data as any)?.extension ?? null, brokerName: (me.data as any)?.full_name ?? null, internalByExt, contactsByPhone };
}

export function useSpeakerCtx(enabled: boolean): SpeakerCtx {
  const [ctx, setCtx] = useState<SpeakerCtx>({});
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (cached ??= loadCtx().catch(() => { cached = null; return {}; })).then((c) => { if (alive) setCtx(c); });
    return () => { alive = false; };
  }, [enabled]);
  return ctx;
}
