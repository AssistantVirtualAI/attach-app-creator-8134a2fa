// pp-portal-2fa — SMS two-factor for the Planiprêt portal.
//
// Only Planiprêt organization members signing in with email + password are
// challenged. Microsoft (azure) sign-ins are exempt.
//
// POST { action: "status" }                 → { required, verified, phone_masked }
// POST { action: "start" }                  → sends a 6-digit SMS code
// POST { action: "verify", code: "123456" } → marks the current session verified
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, nsFetch } from "../_shared/planipret-ns.ts";

const AVA_ORG_ID = "17d6507f-a9ca-409d-8e49-371d50332615";
const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeE164(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

function maskPhone(e164: string) {
  return `••• ••• ${e164.slice(-4)}`;
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newMessageSessionId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Best-effort lookup of an SMS-capable DID for this broker. */
async function resolveFromNumber(admin: any, extension: string, domain: string): Promise<string | null> {
  try {
    const res = await nsFetch(
      `/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(extension)}/smsnumbers`,
      { method: "GET" },
    );
    if (res.ok) {
      const raw = await res.json();
      const list = Array.isArray(raw) ? raw : (raw?.smsnumbers ?? raw?.data ?? []);
      for (const n of list) {
        const e164 = normalizeE164(
          typeof n === "string" ? n : (n?.["from-number"] ?? n?.number ?? n?.phone_number_e164 ?? n?.did),
        );
        if (e164) return e164;
      }
    }
  } catch (_e) { /* fall through */ }

  const { data } = await admin
    .from("planipret_did_assignments")
    .select("phone_number_e164, phone_number_digits")
    .eq("extension", extension)
    .limit(1)
    .maybeSingle();
  return normalizeE164(data?.phone_number_e164 ?? data?.phone_number_digits ?? null);
}

async function sendSms(from: string, to: string, message: string, extension: string, domain: string) {
  const path = `/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(extension)}/messagesessions/${newMessageSessionId()}/messages`;
  const res = await nsFetch(path, {
    method: "POST",
    body: JSON.stringify({ type: "sms", destination: to, message, "from-number": from }),
  });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: text.slice(0, 300) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.slice(7);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    // Session id + provider come from the JWT itself.
    let claims: any = {};
    try {
      claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch { /* ignore */ }
    const sessionId: string = String(claims?.session_id ?? claims?.sid ?? "no-session");
    const provider: string = String(
      claims?.app_metadata?.provider ?? (user.app_metadata as any)?.provider ?? "email",
    );
    const amr: string[] = Array.isArray(claims?.amr)
      ? claims.amr.map((a: any) => String(a?.method ?? a))
      : [];
    const viaMicrosoft = provider === "azure" || amr.includes("oauth") || amr.includes("sso/saml");

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "status");

    // Planiprêt scope only — everyone else is never challenged.
    const { data: isMember } = await admin.rpc("is_planipret_member", { _user_id: user.id });
    const { data: profile } = await admin
      .from("planipret_profiles")
      .select("id, phone, extension, ns_extension, ns_domain, organization_id, full_name")
      .eq("user_id", user.id)
      .maybeSingle();

    const inScope = isMember === true && profile?.organization_id === AVA_ORG_ID;
    if (!inScope || viaMicrosoft) {
      return json({ ok: true, required: false, verified: true, reason: !inScope ? "out_of_scope" : "microsoft_sso" });
    }

    const { data: verifiedRow } = await admin
      .from("planipret_portal_2fa_sessions")
      .select("id, expires_at")
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    const verified = !!verifiedRow;

    const phone = normalizeE164(profile?.phone);

    if (action === "status") {
      return json({
        ok: true,
        required: !verified,
        verified,
        has_phone: !!phone,
        phone_masked: phone ? maskPhone(phone) : null,
      });
    }

    if (action === "start") {
      if (verified) return json({ ok: true, required: false, verified: true });
      if (!phone) {
        return json({
          ok: false,
          error: "Aucun numéro de mobile enregistré pour ce compte — contactez un administrateur.",
          code: "no_phone",
        }, 400);
      }
      const extension = String(profile?.extension ?? profile?.ns_extension ?? "").trim();
      const domain = String(profile?.ns_domain ?? Deno.env.get("NS_API_DOMAIN") ?? "").trim();
      if (!extension || !domain) {
        return json({ ok: false, error: "Configuration téléphonie manquante pour ce compte.", code: "no_extension" }, 400);
      }

      // Throttle: max 1 code / 45 s
      const { data: recent } = await admin
        .from("planipret_portal_2fa_challenges")
        .select("created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recent?.created_at && Date.now() - new Date(recent.created_at).getTime() < 45_000) {
        return json({ ok: false, error: "Un code vient d'être envoyé. Réessayez dans quelques secondes.", code: "throttled" }, 429);
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const from = await resolveFromNumber(admin, extension, domain);
      if (!from) {
        return json({ ok: false, error: "Aucun numéro SMS (DID) disponible pour envoyer le code.", code: "no_did" }, 400);
      }

      const sent = await sendSms(
        from,
        phone,
        `Planiprêt — votre code de connexion est ${code}. Valide 10 minutes. Ne le partagez jamais.`,
        extension,
        domain,
      );
      if (!sent.ok) {
        console.error("[pp-portal-2fa] sms failed", sent);
        return json({ ok: false, error: "Échec de l'envoi du code par texto. Réessayez.", code: "sms_failed" }, 502);
      }

      await admin.from("planipret_portal_2fa_challenges").insert({
        user_id: user.id,
        session_id: sessionId,
        phone_e164: phone,
        code_hash: await sha256(code),
        sent_via: "netsapiens",
        expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      });

      return json({ ok: true, sent: true, phone_masked: maskPhone(phone) });
    }

    if (action === "verify") {
      if (verified) return json({ ok: true, verified: true });
      const code = String(body?.code ?? "").replace(/\D/g, "");
      if (code.length !== 6) return json({ ok: false, error: "Code invalide.", code: "bad_code" }, 400);

      const { data: challenge } = await admin
        .from("planipret_portal_2fa_challenges")
        .select("id, code_hash, attempts, expires_at, consumed_at")
        .eq("user_id", user.id)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!challenge) return json({ ok: false, error: "Code expiré — demandez-en un nouveau.", code: "expired" }, 400);
      if ((challenge.attempts ?? 0) >= MAX_ATTEMPTS) {
        return json({ ok: false, error: "Trop de tentatives — demandez un nouveau code.", code: "locked" }, 429);
      }

      if (await sha256(code) !== challenge.code_hash) {
        await admin
          .from("planipret_portal_2fa_challenges")
          .update({ attempts: (challenge.attempts ?? 0) + 1 })
          .eq("id", challenge.id);
        return json({ ok: false, error: "Code incorrect.", code: "mismatch" }, 400);
      }

      await admin
        .from("planipret_portal_2fa_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", challenge.id);

      await admin
        .from("planipret_portal_2fa_sessions")
        .upsert({
          user_id: user.id,
          session_id: sessionId,
          verified_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        }, { onConflict: "user_id,session_id" });

      return json({ ok: true, verified: true });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e: any) {
    console.error("[pp-portal-2fa] error", e);
    return json({ ok: false, error: e?.message ?? "Internal error" }, 500);
  }
});
