// Single active mobile device per broker. Pure helpers + DB guard shared by
// pp-mobile-device-claim, pp-voip-push-token and mobile-register-push.

export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function normalizeDeviceId(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return DEVICE_ID_RE.test(s) ? s : null;
}

/** A token may be stored only when no other device is the active one. */
export function canRegisterToken(activeDeviceId: string | null, deviceId: string | null): boolean {
  if (!activeDeviceId) return true; // no claim yet (older app versions): legacy behaviour
  return deviceId === activeDeviceId;
}

export async function readActiveDevice(admin: any, userId: string): Promise<string | null> {
  const { data } = await admin
    .from("planipret_mobile_active_device")
    .select("device_id")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.device_id as string | undefined) ?? null;
}
