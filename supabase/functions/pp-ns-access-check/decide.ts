// Pure decision: may this broker use the portal / mobile app?
// Denied only on proof (no extension, NS says the user does not exist or is disabled).
// An unreachable NS never locks everyone out; the existing local DID gate still applies.
export type NsAccess = { allowed: boolean; reason: "ok" | "super_admin" | "no_extension" | "ns_missing" | "ns_inactive" | "ns_unavailable" };

export function decideNsAccess(input: {
  isSuperAdmin: boolean;
  extension: string | null | undefined;
  nsStatus: number | null;
  nsUser: Record<string, unknown> | null;
}): NsAccess {
  if (input.isSuperAdmin) return { allowed: true, reason: "super_admin" };
  if (!String(input.extension ?? "").trim()) return { allowed: false, reason: "no_extension" };
  if (input.nsStatus === 404) return { allowed: false, reason: "ns_missing" };
  if (input.nsStatus === null || input.nsStatus >= 500 || input.nsStatus === 429) return { allowed: true, reason: "ns_unavailable" };
  if (input.nsStatus < 200 || input.nsStatus >= 300) return { allowed: true, reason: "ns_unavailable" };
  const u = input.nsUser ?? {};
  const flags = [u["status"], u["user-status"], u["account-status"]].map((v) => String(v ?? "").toLowerCase());
  if (flags.some((f) => ["disabled", "inactive", "suspended", "deleted"].includes(f))) return { allowed: false, reason: "ns_inactive" };
  if (!u["user"] && !u["name-first-name"] && !u["login-username"] && !u["email"]) return { allowed: false, reason: "ns_missing" };
  return { allowed: true, reason: "ok" };
}
