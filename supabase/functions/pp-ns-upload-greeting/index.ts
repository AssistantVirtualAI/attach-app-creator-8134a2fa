// Upload an audio announcement (e.g. "cet appel sera enregistré") to NetSapiens
// as a user/domain greeting via NS-API v2 Media/Greetings.
// Explicitly authorized by the user (media upload only — no DID / phonenumber writes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { nsFetch, getEnv, jsonResponse } from "../_shared/planipret-ns.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_BUCKET = "pbx-audio";
const DEFAULT_OBJECT = "call-recording-notice.wav";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const {
      user: nsUser,
      domain: nsDomain,
      index = "1",
      bucket = DEFAULT_BUCKET,
      object = DEFAULT_OBJECT,
      description = "Avis d'enregistrement d'appel (AVA)",
      dryRun = false,
    } = body ?? {};

    const { NS_DEFAULT_DOMAIN } = getEnv();
    const domain = nsDomain || NS_DEFAULT_DOMAIN;
    if (!nsUser) {
      return new Response(JSON.stringify({ error: "missing_user", hint: "Provide { user: '<extension>' }" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const dl = await admin.storage.from(bucket).download(object);
    if (dl.error || !dl.data) {
      return new Response(JSON.stringify({ error: "audio_not_found", details: dl.error?.message }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const base64 = toBase64(bytes);

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, dryRun: true, bytes: bytes.length, domain, user: nsUser, index }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await nsFetch(
      `/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(nsUser)}/greetings`,
      {
        method: "POST",
        body: JSON.stringify({
          synchronous: "yes",
          convert: "yes",
          index: String(index),
          description,
          filename: object,
          file: base64,
        }),
      },
      { functionName: "pp-ns-upload-greeting" },
    );

    const text = await res.text();
    console.log("[pp-ns-upload-greeting] NS status", res.status, text.slice(0, 500));

    return new Response(
      JSON.stringify({ ok: res.ok, status: res.status, domain, user: nsUser, index, response: text.slice(0, 2000) }),
      { status: res.ok ? 200 : res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[pp-ns-upload-greeting] error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
