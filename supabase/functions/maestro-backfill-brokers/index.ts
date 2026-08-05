// POST /functions/v1/maestro-backfill-brokers
// Body: { from?: number, to?: number, dry_run?: boolean }
// Scans Maestro telecom user ids once and links every Planiprêt profile
// (extension / phone match) to its maestro_broker_id.
import { adminClient, corsHeaders, getMaestroConfig, json, verifyTelecomUserId } from "../_shared/maestro.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return json({ error: "Unauthorized" }, 401);

  const admin = adminClient();
  if (token !== SERVICE_ROLE) {
    const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userData, error } = await anon.auth.getUser(token);
    if (error || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const { data: isAdmin } = await admin.rpc("is_planipret_admin", { _user_id: userData.user.id });
    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: userData.user.id });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const from = Math.max(1, Number(body?.from ?? 1));
  const to = Math.min(Math.max(from, Number(body?.to ?? 300)), from + 400);
  const dryRun = !!body?.dry_run;

  const cfg = await getMaestroConfig(admin);
  if (!cfg.url || !cfg.key) return json({ error: "maestro_not_configured" }, 400);

  // 1. Build the telecom directory once.
  const ids = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const directory: { id: string; ext: string; nums: string[] }[] = [];
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const sips = await Promise.all(chunk.map(async (id) => {
      const sip = await verifyTelecomUserId(cfg, String(id));
      if (!sip) return null;
      const pu = sip.provider_user ?? {};
      return {
        id: String(id),
        ext: String(sip.sip_username ?? pu.provider_external_user_id ?? "").trim(),
        nums: [digits(pu.phone_number), digits(pu.sms_number)].filter(Boolean) as string[],
      };
    }));
    for (const s of sips) if (s) directory.push(s);
  }

  // 2. Match unlinked profiles.
  const { data: profiles } = await admin
    .from("planipret_profiles")
    .select("id, full_name, email, extension, phone, maestro_broker_id");

  const linked: any[] = [];
  const unmatched: any[] = [];
  for (const p of (profiles ?? []) as any[]) {
    if (p.maestro_broker_id) continue;
    const ext = String(p.extension ?? "").trim();
    const phone = digits(p.phone);
    const hit = directory.find((d) =>
      (ext && d.ext === ext) ||
      (phone && d.nums.some((n) => n.endsWith(phone.slice(-10))))
    );
    if (!hit) { unmatched.push({ email: p.email, ext, phone }); continue; }
    if (!dryRun) {
      await admin.from("planipret_profiles").update({ maestro_broker_id: hit.id }).eq("id", p.id);
    }
    linked.push({ email: p.email, maestro_broker_id: hit.id, matched_ext: ext || null });
  }

  return json({
    success: true,
    scanned_range: [from, to],
    telecom_users_found: directory.length,
    profiles: profiles?.length ?? 0,
    linked: linked.length,
    unmatched: unmatched.length,
    dry_run: dryRun,
    linked_sample: linked.slice(0, 20),
    unmatched_sample: unmatched.slice(0, 20),
  });
});
