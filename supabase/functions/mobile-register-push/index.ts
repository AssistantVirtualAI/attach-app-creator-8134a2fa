// mobile-register-push: persist the device push token for the authenticated user.
// Token values are never echoed in responses, logs or audit metadata.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { canRegisterToken, normalizeDeviceId, readActiveDevice } from "../_shared/pp-active-device.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Client = any;
export type Deps = {
  userClient: (authHeader: string) => Client;
  adminClient: () => Client;
  canRegister: (admin: Client, userId: string, deviceId: string | null) => Promise<boolean>;
  log: (msg: string, meta?: Record<string, unknown>) => void;
};

const defaultDeps: Deps = {
  userClient: (authHeader) =>
    createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    }),
  adminClient: () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
  canRegister: async (admin, userId, deviceId) => canRegisterToken(await readActiveDevice(admin, userId), deviceId),
  log: (msg, meta) => console.warn(msg, meta ?? {}),
};

export async function handle(req: Request, deps: Deps = defaultDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const sb = deps.userClient(authHeader);
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: __mobileAllowed } = await sb.rpc("my_platform_access_allowed", { _platform: "mobile" });
    if (__mobileAllowed === false) return json({ error: "MOBILE_ACCESS_DISABLED", message: "Mobile access not granted by Lemtel administrators." }, 403);

    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "");
    const platformRaw = String(body.platform || "").toLowerCase();
    const platform = ["ios", "android", "web"].includes(platformRaw) ? platformRaw : "web";
    const extension = String(body.extension || "");
    if (!token || !platform) return json({ error: "missing_fields" }, 400);

    const admin = deps.adminClient();
    const deviceId = normalizeDeviceId(body.device_id);
    if (platform !== "web" && !(await deps.canRegister(admin, u.user.id, deviceId))) {
      return json({ error: "device_not_active" }, 409);
    }
    const { error: upErr } = await admin
      .from("mobile_push_tokens")
      .upsert(
        {
          user_id: u.user.id,
          token,
          platform,
          extension: extension || null,
          device_id: deviceId,
          revoked_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,token" },
      );
    if (upErr) {
      deps.log("[mobile-register-push] persist failed", { platform, code: upErr.code ?? null });
      return json({ error: "token_persist_failed" }, 500);
    }

    const { data: sp } = await sb.from("pbx_softphone_users")
      .select("organization_id").eq("portal_user_id", u.user.id).maybeSingle();

    await sb.from("audit_logs").insert({
      organization_id: sp?.organization_id || null,
      user_id: u.user.id,
      action: "mobile_push_token_registered",
      resource_type: "mobile_device",
      metadata: { platform, extension },
    });

    return json({ ok: true });
  } catch (_e) {
    deps.log("[mobile-register-push] unexpected error");
    return json({ error: "internal_error" }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req));
