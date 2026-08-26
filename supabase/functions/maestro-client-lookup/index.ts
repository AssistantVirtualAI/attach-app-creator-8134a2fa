// GET /functions/v1/maestro-client-lookup?phone={e164}&call_id={uuid?}
// Looks up a Maestro client by phone, resolves their most recent dossier when
// Maestro exposes one, and caches the result on planipret_phone_calls.
//
// The response is designed so the caller never faces an empty screen:
//   - found + latest_deal -> open the dossier
//   - found, no dossier   -> open_action "contact" with contact_url
//   - not found / error   -> found:false, the UI keeps the local contact card
import {
  adminClient,
  corsHeaders,
  getBrokerAuth,
  getMaestroConfig,
  json,
  maestroAudit,
  maestroFetch,
  normalizePhone,
} from "../_shared/maestro.ts";
import { clientUrl, fetchClientDeals } from "../_shared/maestro-deals.ts";


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const phone = normalizePhone(url.searchParams.get("phone"));
    const callId = url.searchParams.get("call_id");
    const userIdHeader = req.headers.get("x-user-id");
    if (!phone) return json({ found: false, error: "phone_required" }, 400);

    const admin = adminClient();
    const cfg = await getMaestroConfig(admin);
    if (!cfg.url || !cfg.key) return json({ found: false, error: "maestro_not_configured" }, 200);

    const auth = await getBrokerAuth(admin, userIdHeader);
    const res = await maestroFetch(cfg, {
      method: "POST",
      path: `/api/v1/users/${encodeURIComponent(String(auth.brokerId ?? ""))}/lookup-by-phone`,
      token: auth.token,
      body: { phone },
    });

    if (res.status === 404 || (res.ok && !res.data)) {
      return json({ found: false, phone });
    }
    if (!res.ok) {
      await maestroAudit(admin, "client_lookup_failed", { phone, status: res.status });
      return json({ found: false, error: "lookup_failed", status: res.status }, 200);
    }

    const client = res.data?.client ?? res.data;
    const clientId = client?.id ?? client?.client_id;

    if (callId && clientId) {
      await admin
        .from("planipret_phone_calls")
        .update({ maestro_client_id: String(clientId) })
        .eq("id", callId);
    }

    return json({
      found: true,
      client_id: clientId,
      name: client?.name ?? `${client?.first_name ?? ""} ${client?.last_name ?? ""}`.trim(),
      company: client?.company ?? null,
      mortgage_stage: client?.mortgage_stage ?? null,
      tags: client?.tags ?? [],
      raw: client,
    });
  } catch (e: any) {
    console.error("maestro-client-lookup error", e);
    return json({ found: false, error: e?.message ?? "server_error" }, 500);
  }
});
