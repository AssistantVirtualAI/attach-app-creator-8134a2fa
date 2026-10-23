// Single active mobile device per broker. Pure helpers + DB guard shared by
// pp-mobile-device-claim, pp-voip-push-token and mobile-register-push.

export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;

export const ACTIVE_CALL_SESSION_STATES = ["ringing", "active"] as const;

export function deviceClaimMustDefer(callState: unknown): boolean {
  return ACTIVE_CALL_SESSION_STATES.includes(
    String(callState) as (typeof ACTIVE_CALL_SESSION_STATES)[number],
  );
}

export function normalizeDeviceId(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return DEVICE_ID_RE.test(s) ? s : null;
}

/** A token may be stored only when no other device is the active one.
 *  Exception: an installed app without device id (older release) may register
 *  while the claimed active device has never stored a live token — otherwise the
 *  broker's only working phone is locked out of calls, voicemail and alerts. */
export function canRegisterToken(
  activeDeviceId: string | null,
  deviceId: string | null,
  activeDeviceHasToken = true,
): boolean {
  if (!activeDeviceId) return true; // no claim yet (older app versions): legacy behaviour
  if (!deviceId && !activeDeviceHasToken) return true;
  return deviceId === activeDeviceId;
}

export async function activeDeviceHasLiveToken(admin: any, userId: string, activeDeviceId: string | null): Promise<boolean> {
  if (!activeDeviceId) return false;
  const { count } = await admin
    .from("mobile_push_tokens")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("device_id", activeDeviceId)
    .is("revoked_at", null);
  return (count ?? 0) > 0;
}

export async function canUserRegisterToken(admin: any, userId: string, deviceId: string | null): Promise<boolean> {
  const active = await readActiveDevice(admin, userId);
  if (!active || deviceId) return canRegisterToken(active, deviceId);
  return canRegisterToken(active, deviceId, await activeDeviceHasLiveToken(admin, userId, active));
}

export async function readActiveDevice(admin: any, userId: string): Promise<string | null> {
  const { data } = await admin
    .from("planipret_mobile_active_device")
    .select("device_id")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.device_id as string | undefined) ?? null;
}
