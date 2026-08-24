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
const CODE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 45_000;
const RESEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const BACKUP_CODE_COUNT = 8;

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

/** Human-friendly one-time recovery codes, e.g. "4F7K-2QD9". */
function newBackupCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const s = Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Replaces every backup code of a user with a fresh set; returns plaintext (shown once). */
async function regenerateBackupCodes(admin: any, userId: string): Promise<string[]> {
  await admin.from("planipret_portal_2fa_backup_codes").delete().eq("user_id", userId);
  const codes: string[] = [];
  const rows: { user_id: string; code_hash: string }[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = newBackupCode();
    codes.push(code);
    rows.push({ user_id: userId, code_hash: await sha256(`${userId}:${code.replace("-", "")}`) });
  }
  await admin.from("planipret_portal_2fa_backup_codes").insert(rows);
  return codes;
}



const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

function maskEmail(addr: string) {
  const [local, domain] = addr.split("@");
  if (!domain) return addr;
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(2, local.length - 2))}@${domain}`;
}

function otpHtml(code: string, name: string) {
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1e">
    <div style="max-width:520px;margin:0 auto;padding:24px">
      <p>Bonjour ${name || ""},</p>
      <p>Voici votre code de vérification pour accéder au portail Planiprêt :</p>
      <div style="font-size:32px;letter-spacing:10px;font-weight:800;text-align:center;padding:18px;background:#f4f5f7;border-radius:10px">${code}</div>
      <p style="font-size:13px;color:#6b7280">Ce code expire dans 5 minutes. Si vous n'avez pas demandé ce code, ignorez ce courriel.</p>
    </div></body></html>`;
}

/** Sends the OTP by email (Resend), with a sender-domain fallback. */
async function sendOtpEmail(to: string, code: string, name: string) {
  if (!RESEND_API_KEY) return { ok: false, status: 500, body: "resend_not_configured" };
  const payload = {
    to: [to],
    subject: `Planiprêt — code de vérification ${code}`,
    html: otpHtml(code, name),
  };
  const send = (from: string) =>
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, ...payload }),
    });
  let r = await send("Planiprêt <noreply@ava-telecom.ca>");
  if (!r.ok && (r.status === 403 || r.status === 422)) {
    r = await send("Planiprêt <noreply@assistantvirtualai.com>");
  }
  const text = await r.text().catch(() => "");
  return { ok: r.ok, status: r.status, body: text.slice(0, 300) };
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

    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? req.headers.get("cf-connecting-ip") ?? null;
    const userAgent = req.headers.get("user-agent") ?? null;

    const logAccess = async (
      event: string,
      reason: string | null,
      extra: Record<string, unknown> = {},
    ) => {
      try {
        await admin.from("planipret_portal_access_log").insert({
          user_id: user.id,
          email: user.email ?? null,
          event,
          reason,
          provider: String((user.app_metadata as any)?.provider ?? "email"),
          portal: String((extra as any)?.portal ?? "planipret"),
          ip: clientIp,
          user_agent: userAgent,
          metadata: extra,
        });
      } catch (e) {
        console.warn("[pp-portal-2fa] access log failed", e);
      }
    };

    // Hard lock: only @planipret accounts (or platform super admins) may use the portal.
    {
      const addr = String(user.email ?? "").toLowerCase();
      const domain = addr.split("@")[1] ?? "";
      const planipretEmail = domain === "planipret.com" || domain === "planipret.ca"
        || domain.endsWith(".planipret.com") || domain.endsWith(".planipret.ca");
      if (!planipretEmail) {
        const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: user.id });
        if (isSuper !== true) {
          console.warn("[pp-portal-2fa] blocked non-planipret account", { user: user.id, addr });
          await logAccess("blocked", "domain_not_allowed", { domain });
          return json({ error: "Portail réservé aux comptes @planipret", code: "domain_blocked", blocked: true }, 403);
        }
      }
    }


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

    /** One "session opened" row per portal session (deduped on session_id). */
    const logSessionOnce = async (reason: string) => {
      if (action !== "status" || sessionId === "no-session") return;
      const { data: seen } = await admin
        .from("planipret_portal_access_log")
        .select("id")
        .eq("user_id", user.id)
        .eq("event", "session_opened")
        .contains("metadata", { session_id: sessionId })
        .limit(1)
        .maybeSingle();
      if (seen) return;
      await logAccess("session_opened", reason, { session_id: sessionId, via: viaMicrosoft ? "microsoft" : "password" });
    };

    // Planiprêt scope only — everyone else is never challenged.
    const { data: isMember } = await admin.rpc("is_planipret_member", { _user_id: user.id });
    const { data: profile } = await admin
      .from("planipret_profiles")
      .select("id, phone, extension, ns_extension, ns_domain, organization_id, full_name")
      .eq("user_id", user.id)
      .maybeSingle();

    const inScope = isMember === true && profile?.organization_id === AVA_ORG_ID;
    if (!inScope || viaMicrosoft) {
      await logSessionOnce(!inScope ? "out_of_scope" : "microsoft_sso");
      return json({ ok: true, required: false, verified: true, reason: !inScope ? "out_of_scope" : "microsoft_sso" });
    }
    await logSessionOnce("password_2fa_scope");



    const { data: verifiedRow } = await admin
      .from("planipret_portal_2fa_sessions")
      .select("id, expires_at")
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    const verified = !!verifiedRow;

    const phone = normalizeE164(profile?.phone);

    const markVerified = async (via: string) => {
      await admin
        .from("planipret_portal_2fa_sessions")
        .upsert({
          user_id: user.id,
          session_id: sessionId,
          verified_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        }, { onConflict: "user_id,session_id" });
      console.log("[pp-portal-2fa] verified", { user: user.id, via });
    };

    // Sends in the last hour (used for cooldown + hourly cap).
    const sendsWindow = async () => {
      const { data } = await admin
        .from("planipret_portal_2fa_challenges")
        .select("created_at")
        .eq("user_id", user.id)
        .gt("created_at", new Date(Date.now() - RESEND_WINDOW_MS).toISOString())
        .order("created_at", { ascending: false });
      const list = (data ?? []) as { created_at: string }[];
      const last = list[0]?.created_at ? new Date(list[0].created_at).getTime() : 0;
      return {
        count: list.length,
        cooldownLeft: last ? Math.max(0, Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - last)) / 1000)) : 0,
      };
    };

    if (action === "status") {
      const { count, cooldownLeft } = await sendsWindow();
      const { count: backupLeft } = await admin
        .from("planipret_portal_2fa_backup_codes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("used_at", null);
      return json({
        ok: true,
        required: !verified,
        verified,
        has_phone: !!phone,
        phone_masked: phone ? maskPhone(phone) : null,
        backup_codes_remaining: backupLeft ?? 0,
        cooldown_seconds: cooldownLeft,
        sends_remaining: Math.max(0, MAX_SENDS_PER_HOUR - count),
      });
    }

    if (action === "start") {
      if (verified) return json({ ok: true, required: false, verified: true });
      if (!phone) {
        return json({
          ok: false,
          error: "Aucun numéro de mobile enregistré pour ce compte — utilisez un code de secours ou contactez un administrateur.",
          code: "no_phone",
        }, 400);
      }
      const extension = String(profile?.extension ?? profile?.ns_extension ?? "").trim();
      const domain = String(profile?.ns_domain ?? Deno.env.get("NS_API_DOMAIN") ?? "").trim();
      if (!extension || !domain) {
        return json({ ok: false, error: "Configuration téléphonie manquante pour ce compte.", code: "no_extension" }, 400);
      }

      const { count, cooldownLeft } = await sendsWindow();
      if (count >= MAX_SENDS_PER_HOUR) {
        return json({
          ok: false,
          error: `Limite de renvois atteinte (${MAX_SENDS_PER_HOUR} par heure). Utilisez un code de secours ou réessayez plus tard.`,
          code: "rate_limited",
          cooldown_seconds: 0,
          sends_remaining: 0,
        }, 429);
      }
      if (cooldownLeft > 0) {
        return json({
          ok: false,
          error: `Un code vient d'être envoyé. Réessayez dans ${cooldownLeft} s.`,
          code: "throttled",
          cooldown_seconds: cooldownLeft,
        }, 429);
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const from = await resolveFromNumber(admin, extension, domain);
      if (!from) {
        return json({ ok: false, error: "Aucun numéro SMS (DID) disponible pour envoyer le code.", code: "no_did" }, 400);
      }

      // Only the newest code is ever valid: kill every pending challenge first.
      await admin
        .from("planipret_portal_2fa_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("consumed_at", null);

      // Persist before sending so the code works the instant the texto lands.
      await admin.from("planipret_portal_2fa_challenges").insert({
        user_id: user.id,
        session_id: sessionId,
        phone_e164: phone,
        code_hash: await sha256(code),
        sent_via: "netsapiens",
        expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      });

      const sent = await sendSms(
        from,
        phone,
        `Planiprêt — code ${code} (valide 5 min). Ignorez les codes précédents.`,
        extension,
        domain,
      );
      if (!sent.ok) {
        console.error("[pp-portal-2fa] sms failed", sent);
        return json({ ok: false, error: "Échec de l'envoi du code par texto. Réessayez ou utilisez un code de secours.", code: "sms_failed" }, 502);
      }


      return json({
        ok: true,
        sent: true,
        phone_masked: maskPhone(phone),
        cooldown_seconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
        sends_remaining: Math.max(0, MAX_SENDS_PER_HOUR - (count + 1)),
      });
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
        const attempts = (challenge.attempts ?? 0) + 1;
        await admin
          .from("planipret_portal_2fa_challenges")
          .update({ attempts })
          .eq("id", challenge.id);
        const left = Math.max(0, MAX_ATTEMPTS - attempts);
        return json({
          ok: false,
          error: left > 0 ? `Code incorrect — ${left} tentative(s) restante(s).` : "Trop de tentatives — demandez un nouveau code.",
          code: left > 0 ? "mismatch" : "locked",
          attempts_left: left,
        }, left > 0 ? 400 : 429);
      }

      await admin
        .from("planipret_portal_2fa_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", challenge.id);

      await markVerified("sms");
      await logAccess("2fa_verified", "sms");
      return json({ ok: true, verified: true });
    }

    // ---- Recovery: one-time backup code (no phone needed) ----
    if (action === "verify_backup") {
      if (verified) return json({ ok: true, verified: true });
      const raw = String(body?.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (raw.length < 8) return json({ ok: false, error: "Code de secours invalide.", code: "bad_backup" }, 400);

      const hash = await sha256(`${user.id}:${raw}`);
      const { data: match } = await admin
        .from("planipret_portal_2fa_backup_codes")
        .select("id")
        .eq("user_id", user.id)
        .eq("code_hash", hash)
        .is("used_at", null)
        .maybeSingle();
      if (!match) {
        await logAccess("2fa_failed", "backup_invalid");
        return json({ ok: false, error: "Code de secours invalide ou déjà utilisé.", code: "backup_invalid" }, 400);
      }
      await admin
        .from("planipret_portal_2fa_backup_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("id", match.id);
      await markVerified("backup_code");
      await logAccess("2fa_verified", "backup_code");
      const { count: left } = await admin
        .from("planipret_portal_2fa_backup_codes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("used_at", null);
      return json({ ok: true, verified: true, backup_codes_remaining: left ?? 0 });
    }

    // ---- Generate a fresh set of backup codes for myself (must be verified) ----
    if (action === "generate_backup_codes") {
      if (!verified) return json({ ok: false, error: "Vérification requise avant de générer des codes de secours.", code: "not_verified" }, 403);
      const codes = await regenerateBackupCodes(admin, user.id);
      return json({ ok: true, codes });
    }

    // ---- Admin reset: issue new backup codes for another Planiprêt user ----
    if (action === "admin_reset") {
      const { data: isAdmin } = await admin.rpc("is_planipret_admin", { _user_id: user.id });
      if (isAdmin !== true) return json({ ok: false, error: "Réservé aux administrateurs Planiprêt.", code: "forbidden" }, 403);

      const targetEmail = String(body?.email ?? "").trim().toLowerCase();
      const targetUserId = String(body?.user_id ?? "").trim();
      let targetId = targetUserId;
      if (!targetId && targetEmail) {
        const { data: prof } = await admin
          .from("planipret_profiles")
          .select("user_id, organization_id")
          .ilike("email", targetEmail)
          .maybeSingle();
        targetId = String(prof?.user_id ?? "");
      }
      if (!targetId) return json({ ok: false, error: "Utilisateur introuvable.", code: "not_found" }, 404);

      // Clear challenges + verified sessions so the user must re-verify.
      await admin.from("planipret_portal_2fa_sessions").delete().eq("user_id", targetId);
      await admin.from("planipret_portal_2fa_challenges").delete().eq("user_id", targetId);
      const codes = await regenerateBackupCodes(admin, targetId);
      console.log("[pp-portal-2fa] admin_reset", { by: user.id, target: targetId });
      return json({ ok: true, user_id: targetId, codes });
    }


    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e: any) {
    console.error("[pp-portal-2fa] error", e);
    return json({ ok: false, error: e?.message ?? "Internal error" }, 500);
  }
});
