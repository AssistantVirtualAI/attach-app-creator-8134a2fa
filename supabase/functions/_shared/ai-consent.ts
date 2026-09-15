// Consentement IA persistant côté serveur (Planiprêt Mobile 1.4.8).
//
// Règle : aucune requête vers un fournisseur IA (OpenAI, Gemini, Anthropic,
// ElevenLabs, Lovable AI Gateway) ne part tant que le courtier authentifié n'a
// pas accepté la version courante du consentement. Une valeur locale stockée
// dans l'application mobile n'est jamais une preuve suffisante : la vérité vit
// dans planipret_profiles.

export const AI_CONSENT_VERSION = "2026-09-15-v3";

export type ConsentState = {
  granted: boolean;
  version: string | null;
  consented_at: string | null;
  revoked_at: string | null;
  required_version: string;
  reason?: "missing" | "revoked" | "outdated";
};

export function evaluateConsent(row: {
  ai_consent_at?: string | null;
  ai_consent_version?: string | null;
  ai_consent_revoked_at?: string | null;
} | null | undefined): ConsentState {
  const at = row?.ai_consent_at ?? null;
  const version = row?.ai_consent_version ?? null;
  const revoked = row?.ai_consent_revoked_at ?? null;

  let granted = false;
  let reason: ConsentState["reason"];
  if (!at) reason = "missing";
  else if (revoked && Date.parse(revoked) >= Date.parse(at)) reason = "revoked";
  else if (version !== AI_CONSENT_VERSION) reason = "outdated";
  else granted = true;

  return {
    granted,
    version,
    consented_at: at,
    revoked_at: revoked,
    required_version: AI_CONSENT_VERSION,
    ...(granted ? {} : { reason }),
  };
}

/** Lit l'état de consentement du courtier (client service-role obligatoire). */
export async function getAiConsent(admin: any, userId: string): Promise<ConsentState> {
  const { data } = await admin
    .from("planipret_profiles")
    .select("ai_consent_at, ai_consent_version, ai_consent_revoked_at")
    .eq("user_id", userId)
    .maybeSingle();
  return evaluateConsent(data);
}

export function consentRequiredBody(state: ConsentState) {
  return {
    error: "ai_consent_required",
    ai_consent_required: true,
    consent: state,
    message:
      "Le consentement à l'utilisation de l'IA est requis avant d'utiliser cette fonction. " +
      "Ouvre AVA > Confidentialité pour l'accepter.",
  };
}

/**
 * Garde à appeler AVANT tout appel fournisseur.
 * Retourne `null` si le consentement est valide, sinon une Response 403 prête.
 */
export async function requireAiConsent(
  admin: any,
  userId: string,
  headers: Record<string, string>,
): Promise<Response | null> {
  const state = await getAiConsent(admin, userId);
  if (state.granted) return null;
  return new Response(JSON.stringify(consentRequiredBody(state)), {
    status: 403,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
