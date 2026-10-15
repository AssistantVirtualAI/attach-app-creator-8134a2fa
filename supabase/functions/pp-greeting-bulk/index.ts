// Planiprêt admin — regenerate every broker's voicemail greeting with a Québec
// voice (female Caroline / male Alexandre Boutin) and push it as the active
// NetSapiens greeting (index 1). Admin-only, batched via offset/limit.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { nsFetch, getEnv } from "../_shared/planipret-ns.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const FEMALE = "bBRsDJSAcL1ubkrtJ3hM"; // Caroline
const MALE = "IPgYtHTNLjC7Bq7IPHrm"; // Alexandre Boutin
const MALE_NAMES = new Set(("carlo ryan stéphane stephane charles-antoine mark karim guillaume richard jean-eric alexandre etienne " +
  "francois françois martin marc-antoine scott regis gilles antoine mohamad pierre-alain marc jimmy karl francis nicolas mathieu " +
  "felix maxime jean-philippe peter sébastien sebastien jean-françois jean-francois andrew luca thomas michaël michael olivier jonathan").split(" "));

export function isMale(first: string): boolean {
  return MALE_NAMES.has(first.trim().toLowerCase());
}
function cleanName(first: string, last: string): string {
  const l = last.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  return `${first.trim()} ${l}`.trim();
}
export function greetingText(name: string, male: boolean): string {
  return `Bonjour, vous avez joint ${name}, ${male ? "courtier hypothécaire" : "courtière hypothécaire"} chez Planiprêt. ` +
    `Je ne suis pas disponible pour le moment. Laissez-moi votre nom, votre numéro et un court message, ` +
    `et je vous rappellerai dans les plus brefs délais. Merci et bonne journée!`;
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ ok: false, error: "unauthorized" }, 401);
    const { data: isAdm } = await admin.rpc("is_planipret_admin", { _user_id: u.user.id });
    if (!isAdm) return json({ ok: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const offset = Math.max(0, Number(body.offset) || 0);
    const limit = Math.min(Math.max(1, Number(body.limit) || 5), 8);
    const dryRun = !!body.dryRun;
    const elKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!elKey) return json({ ok: false, error: "elevenlabs_not_configured" });

    const { data: rows } = await admin.from("planipret_profiles")
      .select("id,user_id,organization_id,first_name,last_name,extension,ns_extension,ns_domain")
      .not("first_name", "is", null).order("extension");
    const all = (rows ?? []).filter((p: any) => {
      const ext = String(p.ns_extension ?? p.extension ?? "");
      const f = String(p.first_name ?? "").trim();
      return /^\d{3,4}$/.test(ext) && ext !== "1999" && f && !/^(demo|test)$/i.test(f);
    });
    const batch = all.slice(offset, offset + limit);
    const out: any[] = [];
    for (const p of batch as any[]) {
      const ext = String(p.ns_extension ?? p.extension);
      const male = isMale(p.first_name);
      const text = greetingText(cleanName(p.first_name, p.last_name ?? ""), male);
      if (dryRun) { out.push({ ext, male, text }); continue; }
      const voice = male ? MALE : FEMALE;
      const tts = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": elKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true } }),
      });
      if (!tts.ok) { out.push({ ext, ok: false, step: "tts", status: tts.status }); continue; }
      const bytes = new Uint8Array(await tts.arrayBuffer());
      const domain = p.ns_domain || getEnv().NS_DEFAULT_DOMAIN;
      const path = `${p.organization_id}/${p.user_id ?? p.id}/greeting_bulk_${Date.now()}.mp3`;
      await admin.storage.from("voicemail-greetings").upload(path, bytes, { contentType: "audio/mpeg", upsert: false });
      const r = await nsFetch(`/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(ext)}/greetings`, {
        method: "POST",
        body: JSON.stringify({ synchronous: "yes", convert: "yes", index: 1, script: "Message d'accueil AVA",
          encoding: "audio/mpeg", base64_file: b64(bytes) }),
      }, { functionName: "pp-greeting-bulk" });
      if (!r.ok) {
        // Slot 1 may already exist: replace it.
        const r2 = await nsFetch(`/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(ext)}/greetings/1`, {
          method: "PUT",
          body: JSON.stringify({ synchronous: "yes", convert: "yes", script: "Message d'accueil AVA",
            encoding: "audio/mpeg", base64_file: b64(bytes) }),
        }, { functionName: "pp-greeting-bulk" });
        if (!r2.ok) { out.push({ ext, ok: false, step: "ns", status: r.status, status2: r2.status }); continue; }
      }
      const act = await nsFetch(`/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(ext)}`, {
        method: "PATCH", body: JSON.stringify({ "voicemail-greeting-index": 1 }),
      }, { functionName: "pp-greeting-bulk" });
      await admin.from("planipret_profiles").update({
        voicemail_greeting_text: text, voicemail_greeting_voice_id: voice, voicemail_greeting_audio_url: path,
        voicemail_greeting_updated_at: new Date().toISOString(), voicemail_greeting_active: true,
      }).eq("id", p.id);
      out.push({ ext, ok: true, male, activated: act.status });
    }
    return json({ ok: true, total: all.length, offset, next: offset + batch.length < all.length ? offset + batch.length : null, results: out });
  } catch (e) {
    console.error("[pp-greeting-bulk]", (e as Error).message);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
