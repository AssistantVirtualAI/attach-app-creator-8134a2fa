import { parseModels } from "./models.ts";
import { corsHeaders, jsonResponse, nsBrokerFetch, requirePlanipretAdmin } from "../_shared/ns-broker.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await requirePlanipretAdmin(req);
    if ("error" in auth) return auth.error;
    const { admin, profile } = auth;
    const parsed = parseModels(await req.json().catch(() => ({})));
    if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

    // NS cannot send custom headers on subscription posts, so the shared secret
    // travels in the post-url query string (validated by ns-webhook-receiver).
    const secret = Deno.env.get("NS_WEBHOOK_SECRET") ?? "";
    const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ns-webhook-receiver`;
    const target = secret ? `${base}?secret=${encodeURIComponent(secret)}` : base;
    // NS rejects subscriptions without an explicit domain under a Reseller
    // scope ("Please include a domain using a Reseller scope").
    const nsDomain = String((profile as any)?.ns_domain ?? (profile as any)?.domain ?? "").trim();
    if (!nsDomain) return jsonResponse({ success: false, error: "ns_domain_missing" }, 200);

    // NS-API v2 models (docs/netsapiens/webhooks.md). `call` is REQUIRED to wake
    // the mobile app via VoIP push while it is suspended in the background.
    const desired = parsed.models;


    // FIX 5 — check existing subscriptions first
    const listRes = await nsBrokerFetch(admin, profile, "/subscriptions", { method: "GET" });
    const listData = await listRes.json().catch(() => ({}));
    const existing: any[] = Array.isArray(listData) ? listData : (listData.subscriptions ?? listData.data ?? []);

    const urlOf = (s: any) => String(s["post-url"] ?? s.post_url ?? s.target_url ?? s.url ?? s.callback_url ?? "");
    const modelOf = (s: any) => s.model ?? s.event ?? s.event_type ?? s.type;
    // `subscriber` posts are tagged so the receiver routes them without guessing.
    const targetFor = (ev: string) => ev === "subscriber" ? `${target}${target.includes("?") ? "&" : "?"}model=subscriber` : target;
    const matches = (s: any, ev: string) => modelOf(s) === ev && urlOf(s) === targetFor(ev);
    // Same model + our receiver but WITHOUT the secret → stale, must be replaced.
    const stale = (s: any, ev: string) =>
      modelOf(s) === ev && urlOf(s).startsWith(base) && urlOf(s) !== targetFor(ev);

    const created: any[] = [];
    const kept: any[] = [];
    const replaced: any[] = [];
    for (const event of desired) {
      const hit = existing.find((s) => matches(s, event));
      if (hit) { kept.push({ event, id: hit.id ?? null }); continue; }
      for (const old of existing.filter((s) => stale(s, event))) {
        if (!old?.id) continue;
        const del = await nsBrokerFetch(admin, profile, `/subscriptions/${old.id}`, { method: "DELETE" });
        replaced.push({ event, id: old.id, deleted: del.ok });
      }

      const res = await nsBrokerFetch(admin, profile, "/subscriptions", {
        method: "POST",
        // Documented v2 payload: model + post-url (+ scope filters).
        body: JSON.stringify({
          model: event,
          "post-url": targetFor(event),
          "subscription-geo-support": "yes",
          domain: nsDomain,
          user: "*",
        }),

      });
      const data = await res.json().catch(() => ({}));
      // 409 = subscription already exists → treat as present, not an error.
      if (res.status === 409) { kept.push({ event, id: data?.id ?? null, existing: true }); continue; }
      created.push({ event, ok: res.ok, status: res.status, id: data?.id ?? null });
    }


    console.log("ns-webhook-setup", { existing: kept.length, created: created.length, replaced: replaced.length });
    return jsonResponse({
      success: true,
      requested_models: desired,
      existing: kept.length,
      created: created.length,
      replaced,
      secret_in_url: !!secret,
      subscriptions: [...kept, ...created],
    });

  } catch (e) {
    console.error("ns-webhook-setup error", e);
    return jsonResponse({ success: false, error: "Connexion perdue", code: 0 }, 200);
  }
});
