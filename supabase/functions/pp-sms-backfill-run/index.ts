// Rattrapage ponctuel : pousse vers Maestro tous les SMS non synchronisés.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? "500");
  const admin = createClient(SB_URL, SR);
  const { data: rows } = await admin
    .from("planipret_phone_messages")
    .select("id")
    .eq("maestro_synced", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  let ok = 0, fail = 0;
  const errors: Record<string, number> = {};
  for (const r of rows ?? []) {
    try {
      const res = await fetch(`${SB_URL}/functions/v1/maestro-sync-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SR}` },
        body: JSON.stringify({ message_id: r.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (j?.success) ok++;
      else {
        fail++;
        const k = `${j?.error ?? "unknown"}:${j?.status ?? ""}`;
        errors[k] = (errors[k] ?? 0) + 1;
      }
    } catch (_) { fail++; }
  }
  return Response.json({ total: rows?.length ?? 0, ok, fail, errors });
});
