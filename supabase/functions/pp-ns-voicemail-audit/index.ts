// pp-ns-voicemail-audit — Planipret admin only. Reads every linked broker's own
// NetSapiens inbox/saved folders, mirrors missing rows into that broker's cache,
// and reports only aggregate counts/audio availability. Never returns audio URLs,
// caller names or caller numbers, and never touches routing or deletes history.
import { corsHeaders, jsonResponse, nsFetch } from "../_shared/planipret-ns.ts";
import { requirePlanipretAdmin } from "../_shared/ns-broker.ts";
import { readVoicemailAudio, readVoicemailList } from "./read.ts";

const MIRRORED_FOLDERS = ["inbox", "saved"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requirePlanipretAdmin(req);
  if ("error" in auth) return auth.error;
  const supabase = auth.admin;
  const { data: profiles, error } = await supabase.from("planipret_profiles")
    .select("id,extension,ns_domain,user_id")
    .not("user_id", "is", null)
    .not("extension", "is", null)
    .not("ns_domain", "is", null);
  if (error) return jsonResponse({ error: "profile_read_failed" }, 500);

  const results: unknown[] = [];
  const now = new Date().toISOString();
  for (const profile of profiles ?? []) {
    try {
      const entry: Record<string, unknown> = { extension: profile.extension, ok: true };
      for (const folder of MIRRORED_FOLDERS) {
        const items = await readVoicemailList(
          (path, init) => nsFetch(path, init),
          profile.ns_domain,
          profile.extension,
          folder,
          now,
        );
        let syncFailed = 0;
        let newlyMirrored = 0;
        let audioAvailable = 0;
        let audioUnavailable = 0;

        for (const item of items) {
          const { vm_id: _vmId, created_at: _createdAt, ...values } = item;
          const { data: existing, error: lookupError } = await supabase.from("planipret_voicemails")
            .select("id,is_read,transcript,from_number,from_name")
            .eq("user_id", profile.id)
            .eq("ns_vm_id", item.ns_vm_id)
            .maybeSingle();
          if (lookupError) { syncFailed++; continue; }
          if (!existing) newlyMirrored++;
          const row = {
            ...values,
            user_id: profile.id,
            from_number: item.from_number ?? existing?.from_number ?? null,
            from_name: item.from_name ?? existing?.from_name ?? null,
            is_read: existing?.is_read ?? item.is_read,
            transcript: item.transcript ?? existing?.transcript ?? null,
          };
          const result = existing
            ? await supabase.from("planipret_voicemails").update(row).eq("id", existing.id).eq("user_id", profile.id)
            : await supabase.from("planipret_voicemails").insert(row);
          if (result.error) syncFailed++;

          try {
            const audioUrl = await readVoicemailAudio(
              (path, init) => nsFetch(path, init),
              profile.ns_domain,
              profile.extension,
              folder,
              item.ns_vm_id,
            );
            if (audioUrl) audioAvailable++; else audioUnavailable++;
          } catch {
            audioUnavailable++;
          }
        }

        // Retain cache history. Entries no longer provided by NetSapiens are
        // reported for review; a provider delay or retention rule never deletes
        // a broker's locally stored transcript/history during an audit.
        const { data: cached, error: cacheError } = await supabase.from("planipret_voicemails")
          .select("ns_vm_id")
          .eq("user_id", profile.id)
          .eq("folder", folder);
        const providerIds = new Set(items.map((item) => item.ns_vm_id));
        const localNotOnProvider = cacheError
          ? 0
          : (cached ?? []).filter((row: any) => row.ns_vm_id && !providerIds.has(row.ns_vm_id)).length;
        if (cacheError) syncFailed++;

        entry[folder] = {
          provider_count: items.length,
          local_count: (cached ?? []).length,
          newly_mirrored: newlyMirrored,
          local_not_on_provider: localNotOnProvider,
          sync_failed: syncFailed,
          audio_available: audioAvailable,
          audio_unavailable: audioUnavailable,
        };
        if (syncFailed || audioUnavailable || localNotOnProvider) entry.ok = false;
      }
      results.push(entry);
    } catch {
      results.push({ extension: profile.extension, ok: false, error: "provider_read_failed" });
    }
  }

  return jsonResponse({ ok: true, brokers: results.length, results });
});
