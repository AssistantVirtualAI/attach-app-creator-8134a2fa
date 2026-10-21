// pp-ns-voicemail-audit — Planipret admin only. Reads every linked broker's own
// NetSapiens inbox, mirrors it into that broker's rows only, and reports counts
// (no audio URLs, caller names or numbers in the response). Never touches routing.
import { corsHeaders, jsonResponse, nsFetch } from "../_shared/planipret-ns.ts";
import { requirePlanipretAdmin } from "../_shared/ns-broker.ts";
import { readVoicemailList } from "./read.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requirePlanipretAdmin(req);
  if ("error" in auth) return auth.error;
  const supabase = auth.admin;
  const { data: profiles, error } = await supabase.from("planipret_profiles")
    .select("id,extension,ns_domain,full_name,user_id").not("user_id", "is", null).not("extension", "is", null).not("ns_domain", "is", null);
  if (error) return jsonResponse({ error: "profile_read_failed" }, 500);
  const results: unknown[] = [];
  const now = new Date().toISOString();
  for (const p of profiles ?? []) {
    try {
      const items = await readVoicemailList((path, init) => nsFetch(path, init), p.ns_domain, p.extension, "inbox", now);
      let syncFailed = 0;
      for (const item of items) {
        const { vm_id: _v, created_at: _c, ...values } = item;
        const { data: existing } = await supabase.from("planipret_voicemails").select("id,is_read,transcript,from_number,from_name")
          .eq("user_id", p.id).eq("ns_vm_id", item.ns_vm_id).maybeSingle();
        const row = { ...values, user_id: p.id, from_number: item.from_number ?? existing?.from_number ?? null,
          from_name: item.from_name ?? existing?.from_name ?? null, is_read: existing?.is_read ?? item.is_read,
          transcript: item.transcript ?? existing?.transcript ?? null };
        const r = existing
          ? await supabase.from("planipret_voicemails").update(row).eq("id", existing.id).eq("user_id", p.id)
          : await supabase.from("planipret_voicemails").insert(row);
        if (r.error) syncFailed++;
      }
      results.push({ extension: p.extension, name: p.full_name, ok: true, count: items.length,
        with_caller: items.filter((i) => i.from_number || i.from_name).length, sync_failed: syncFailed });
    } catch (e) {
      results.push({ extension: p.extension, name: p.full_name, ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return jsonResponse({ ok: true, brokers: results.length, results });
});
