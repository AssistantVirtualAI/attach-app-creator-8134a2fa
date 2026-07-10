// mobile-recordings: list of calls that have recordings.
// - Admins (domain admins) see all recordings for the organization/domain.
// - Regular users see only recordings tied to their own extension.
// - Optional ?extension=NNN filter (admin-only).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const { data: __mobileAllowed } = await sb.rpc("my_platform_access_allowed", { _platform: "mobile" });
    if (__mobileAllowed === false) return json({ error: "MOBILE_ACCESS_DISABLED", message: "Mobile access not granted." }, 403);

    const { data: sp } = await admin.from("pbx_softphone_users")
      .select("organization_id, extension, domain_uuid")
      .eq("portal_user_id", u.user.id).maybeSingle();
    if (!sp?.organization_id) return json({ items: [], noSoftphone: true });

    // Resolve admin status the same way mobile-calls does.
    const [{ data: roleRow }, { data: orgMember }, { data: superAdmin }, { data: lemtelAdmin }] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("organization_id", sp.organization_id).maybeSingle(),
      admin.from("org_members").select("role, can_manage_extensions, can_listen_calls").eq("user_id", u.user.id).eq("org_id", sp.organization_id).maybeSingle(),
      (async () => { try { return await admin.rpc("is_super_admin", { _user_id: u.user.id }).maybeSingle(); } catch { return { data: false } as any; } })(),
      (async () => { try { return await admin.rpc("is_lemtel_admin", { _user_id: u.user.id }).maybeSingle(); } catch { return { data: false } as any; } })(),
    ]);
    const orgMemberRole = (orgMember as any)?.role || "";
    const appRole = (roleRow as any)?.role || "agent";
    const isDomainAdmin = !!superAdmin || !!lemtelAdmin
      || ["master_admin", "ava_admin", "reseller_admin", "customer_admin"].includes(orgMemberRole)
      || ["super_admin", "admin", "org_admin", "manager"].includes(appRole)
      || !!(orgMember as any)?.can_manage_extensions
      || !!(orgMember as any)?.can_listen_calls;

    const url = new URL(req.url);
    const extParam = url.searchParams.get("extension");
    const brokerOnly = ["1", "true", "yes"].includes(String(url.searchParams.get("broker_only") ?? "").toLowerCase());
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 30);
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    sinceDate.setHours(0, 0, 0, 0);
    const since = sinceDate.toISOString();
    const ext = sp.extension;

    let q = admin.from("pbx_call_records")
      .select("id, pbx_uuid, caller_name, caller_number, destination_number, extension, start_at, duration_seconds, transcribed, ai_summary, recording_path, recording_name, recording_url, domain_uuid, domain_name, organization_id")
      .eq("organization_id", sp.organization_id)
      .eq("has_recording", true)
      .gte("start_at", since);

    if (sp.domain_uuid) q = q.or(`domain_uuid.eq.${sp.domain_uuid},domain_uuid.is.null`);

    // broker_only forces per-extension scoping even for domain admins so the
    // mobile app only ever sees the current broker's own recordings.
    if (!isDomainAdmin || brokerOnly) {
      if (!ext) return json([]);
      q = q.or(`extension.eq.${ext},caller_number.eq.${ext},source_number.eq.${ext},destination_number.eq.${ext}`);
    } else if (extParam && extParam !== "all") {
      q = q.or(`extension.eq.${extParam},caller_number.eq.${extParam},source_number.eq.${extParam},destination_number.eq.${extParam}`);
    }


    const { data: rows, error } = await q.order("start_at", { ascending: false }).limit(200);
    if (error) throw error;

    const out = (rows ?? []).map((r: any) => ({
      id: r.id,
      from: r.caller_number || "",
      to: r.destination_number || "",
      extension: r.extension || undefined,
      customer: r.caller_name || undefined,
      startedAt: r.start_at,
      durationSec: Number(r.duration_seconds || 0),
      hasTranscript: !!r.transcribed,
      summary: r.ai_summary || undefined,
      pbx_uuid: r.pbx_uuid || undefined,
      xml_cdr_uuid: r.pbx_uuid || r.id,
      record_path: r.recording_path || undefined,
      record_name: r.recording_name || undefined,
      recording_url: r.recording_url || undefined,
      domain_uuid: r.domain_uuid || undefined,
      domain_name: r.domain_name || undefined,
      organization_id: r.organization_id || undefined,
    }));
    return json(out);
  } catch (e: any) {
    console.error("[mobile-recordings]", e);
    return json({ error: e?.message || "error" }, 500);
  }
});
