/**
 * pp-did-assign — assignation et RE-SYNCHRONISATION ciblée d'un DID.
 *
 * Actions :
 *   verify      { e164?, extension? }  — lecture seule : recharge la config de
 *                 routage depuis NetSapiens et vérifie que la destination
 *                 correspond bien au bon `user_XXXX`. Sans `e164`, vérifie
 *                 tous les numéros assignés dans le portail.
 *   assign      { e164, extension }    — écrit le routage d'UN numéro (payload
 *                 complet + relecture obligatoire), met à jour le miroir DB.
 *   auto_assign { extension }          — choisit le premier numéro disponible
 *                 et l'assigne au poste (utilisé à la création d'un poste).
 *
 * Portée : un numéro à la fois. Les réécritures en masse restent interdites.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requirePlanipretAdmin } from "../_shared/ns-broker.ts";
import {
  NS_DEFAULT_DOMAIN,
  assignDidToExtension,
  e164Of,
  pbxNumberId,
  verifyDidRouting,
  listLiveExtensions,
  releaseDid,
} from "../_shared/pp-did-routing.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const isService = !!SERVICE_KEY && authHeader === `Bearer ${SERVICE_KEY}`;
    if (!isService) {
      const auth = await requirePlanipretAdmin(req);
      if ("error" in auth) return auth.error;
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "verify");
    const domain = String(body?.domain ?? NS_DEFAULT_DOMAIN);
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    /* ---------------- verify (re-synchronisation lecture seule) ---------------- */
    if (action === "verify") {
      const single = String(body?.e164 ?? body?.phone_number ?? "").trim();
      let targets: { pn: string; ext: string | null }[] = [];

      if (single) {
        let ext = String(body?.extension ?? "").trim() || null;
        if (!ext) {
          const { data: row } = await db
            .from("planipret_did_assignments")
            .select("extension")
            .eq("phone_number_digits", pbxNumberId(single))
            .maybeSingle();
          ext = (row as any)?.extension ?? null;
        }
        targets = [{ pn: pbxNumberId(single), ext }];
      } else {
        const { data: rows } = await db
          .from("planipret_did_assignments")
          .select("phone_number_digits, phone_number_e164, extension")
          .eq("domain", domain)
          .eq("status", "assigned")
          .order("phone_number_digits")
          .limit(Math.min(Number(body?.limit ?? 60), 120));
        targets = (rows ?? []).map((r: any) => ({
          pn: pbxNumberId(r.phone_number_digits || r.phone_number_e164),
          ext: r.extension ?? null,
        }));
      }

      const results = [];
      for (const t of targets) {
        const v = await verifyDidRouting(domain, t.pn, t.ext);
        results.push({ e164: e164Of(t.pn), ...v });
      }

      const drift = results.filter((r) => !r.matches);
      if (results.length) {
        await db.from("planipret_did_routing_snapshots").insert(
          results.map((r) => ({
            domain,
            phone_number: r.phone_number,
            destination_user: r.live.destination_user,
            dial_rule_application: r.live.dial_rule_application,
            dial_rule_parameter: r.live.dial_rule_parameter,
            description: r.live.description,
            enabled: r.live.enabled,
            source: isService ? "cron" : "admin_resync",
          })),
        );
      }

      return json({
        success: true,
        action,
        domain,
        checked: results.length,
        matching: results.length - drift.length,
        drift_count: drift.length,
        verdict: drift.length ? "fail" : "ok",
        summary: drift.length
          ? `${drift.length} numéro(s) sur ${results.length} ne pointent pas vers le bon poste.`
          : `Les ${results.length} numéro(s) vérifiés pointent vers le bon user_XXXX.`,
        results,
      });
    }

    /* ---------------- assign / auto_assign (écriture ciblée) ---------------- */
    if (action === "assign" || action === "auto_assign") {
      const extension = String(body?.extension ?? "").trim();
      if (!/^[0-9]{2,10}$/.test(extension)) {
        return json({ success: false, error: "extension_invalide" }, 400);
      }

      let e164 = String(body?.e164 ?? body?.phone_number ?? "").trim();

      if (action === "auto_assign") {
        // Déjà un numéro pour ce poste ? On ne double pas.
        const { data: existing } = await db
          .from("planipret_did_assignments")
          .select("phone_number_e164")
          .eq("domain", domain)
          .eq("extension", extension)
          .eq("status", "assigned")
          .maybeSingle();
        if (existing) {
          return json({
            success: true, action, skipped: "already_assigned",
            e164: (existing as any).phone_number_e164, extension,
          });
        }
        if (!e164) {
          const { data: free } = await db
            .from("planipret_did_assignments")
            .select("phone_number_e164")
            .eq("domain", domain)
            .eq("status", "available")
            .is("extension", null)
            .order("phone_number_digits")
            .limit(1)
            .maybeSingle();
          e164 = String((free as any)?.phone_number_e164 ?? "");
        }
        if (!e164) {
          return json({
            success: false, action, extension,
            error: "no_available_did",
            diagnostic: "Aucun numéro disponible dans l'inventaire : ajouter des DID avant de créer d'autres postes.",
          }, 409);
        }
      }

      if (!e164) return json({ success: false, error: "e164_requis" }, 400);

      const result = await assignDidToExtension(domain, e164, extension);

      if (result.verified) {
        const { data: prof } = await db
          .from("planipret_profiles")
          .select("full_name")
          .eq("extension", extension)
          .maybeSingle();
        await db.from("planipret_did_assignments")
          .update({
            status: "assigned",
            extension,
            display_name: (prof as any)?.full_name ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("domain", domain)
          .eq("phone_number_digits", result.phone_number);
      }

      await db.from("planipret_did_routing_snapshots").insert({
        domain,
        phone_number: result.phone_number,
        destination_user: result.live.destination_user,
        dial_rule_application: result.live.dial_rule_application,
        dial_rule_parameter: result.live.dial_rule_parameter,
        description: result.live.description,
        enabled: result.live.enabled,
        source: isService ? "auto_assign" : "admin_assign",
      });

      return json({
        success: result.verified,
        action,
        domain,
        e164: e164Of(result.phone_number),
        extension,
        verified: result.verified,
        diagnostic: result.diagnostic,
        live: result.live,
      }, result.verified ? 200 : 502);
    }

    return json({ success: false, error: `unknown action ${action}` }, 400);
  } catch (e) {
    return json({ success: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
