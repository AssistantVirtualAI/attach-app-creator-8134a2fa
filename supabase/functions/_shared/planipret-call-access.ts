// Accès à un appel Planiprêt : identité + propriété + consentement post-appel.
//
// Aucune lecture d'enregistrement / transcription et aucun traitement IA ne
// peut se faire sans :
//   1. un appelant identifié (JWT courtier, ou vrai bearer service role pour
//      les appels internes — jamais un en-tête personnalisé) ;
//   2. la propriété de l'appel (ou un administrateur Planiprêt) ;
//   3. save_consent = "approved" et appel non supprimé.

export type CallAccess =
  | { error: Response }
  | { call: any; userId: string | null; isService: boolean; isAdmin: boolean };

export async function requireCallAccess(
  req: Request,
  admin: any,
  callId: string,
  opts: { headers: Record<string, string>; requireConsent?: boolean; select?: string } = { headers: {} },
): Promise<CallAccess> {
  const headers = { ...(opts.headers ?? {}), "Content-Type": "application/json" };
  const fail = (status: number, body: unknown) =>
    ({ error: new Response(JSON.stringify(body), { status, headers }) });

  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return fail(401, { success: false, error: "unauthorized" });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const isService = !!serviceKey && bearer === serviceKey;

  let userId: string | null = null;
  if (!isService) {
    const { data } = await admin.auth.getUser(bearer);
    userId = data?.user?.id ?? null;
    if (!userId) return fail(401, { success: false, error: "unauthorized" });
  }

  const { data: call } = await admin
    .from("planipret_phone_calls")
    .select(opts.select ?? "*")
    .eq("id", callId)
    .maybeSingle();
  if (!call) return fail(404, { success: false, error: "call_not_found" });

  let isAdmin = false;
  if (userId) {
    const { data: adminFlag } = await admin.rpc("is_planipret_admin", { _user_id: userId });
    isAdmin = adminFlag === true;
    if (!isAdmin && !(await ownsCall(admin, userId, (call as any).user_id))) {
      return fail(403, { success: false, error: "forbidden" });
    }
  }

  if ((call as any).deleted_at) return fail(403, { success: false, error: "call_deleted" });

  if (opts.requireConsent !== false) {
    const consent = String((call as any).save_consent ?? "pending");
    if (consent !== "approved") {
      return fail(403, {
        success: false,
        error: "post_call_consent_required",
        save_consent: consent,
        message: "Le courtier doit approuver la sauvegarde de cet appel avant tout traitement.",
      });
    }
  }

  return { call, userId, isService, isAdmin };
}

export async function ownsCall(admin: any, authUserId: string, callUserId: string | null): Promise<boolean> {
  if (!callUserId) return false;
  if (callUserId === authUserId) return true;
  const { data } = await admin
    .from("planipret_profiles")
    .select("id, user_id")
    .or(`id.eq.${callUserId},user_id.eq.${callUserId}`)
    .limit(5);
  return (data ?? []).some((p: any) => p.user_id === authUserId || p.id === authUserId);
}
