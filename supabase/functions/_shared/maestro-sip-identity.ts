// Resolves the telecom extension owned by the Maestro CRM user behind a
// broker's own access token (Maestro is authoritative for who signed in):
//   GET /telecom/api/v1/user              -> CRM user id
//   GET /telecom/api/v1/users/{id}/sips   -> sips[].sip_username (e.g. 110x)
// Passwords are never returned to callers.
import { getMaestroTelecomConfig, maestroTelecomFetch } from "./maestro-telecom.ts";

export function baseExtensionFromSips(sips: unknown): string | null {
  if (!Array.isArray(sips)) return null;
  const bases = new Set<string>();
  for (const s of sips) {
    const u = String((s as any)?.sip_username ?? "").trim();
    const m = u.match(/^(\d{2,6})[A-Za-z]{0,3}$/);
    if (m) bases.add(m[1]);
  }
  // Ambiguous (several different extensions) never proves an identity.
  return bases.size === 1 ? [...bases][0] : null;
}

export async function resolveMaestroSipExtension(
  admin: any,
  accessToken: string,
): Promise<{ crmUserId: string | null; extension: string | null; devices: string[] }> {
  const cfg = await getMaestroTelecomConfig(admin);
  const me = await maestroTelecomFetch<any>(cfg, "/user", { token: accessToken, maxAttempts: 1, timeoutMs: 5000 });
  const id = me.ok ? (me.data?.id ?? me.data?.data?.id ?? null) : null;
  if (id == null) return { crmUserId: null, extension: null, devices: [] };
  const r = await maestroTelecomFetch<any>(cfg, `/users/${encodeURIComponent(String(id))}/sips`, {
    token: accessToken, maxAttempts: 1, timeoutMs: 5000,
  });
  const sips = r.ok ? (r.data?.sips ?? r.data?.data?.sips ?? []) : [];
  return {
    crmUserId: String(id),
    extension: baseExtensionFromSips(sips),
    devices: Array.isArray(sips) ? sips.map((s: any) => String(s?.sip_username ?? "")).filter(Boolean) : [],
  };
}
