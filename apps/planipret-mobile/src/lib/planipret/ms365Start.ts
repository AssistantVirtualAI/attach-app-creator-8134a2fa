import { rememberMs365ReturnTo } from "@/lib/planipret/ms365ReturnTo";
import { buildMs365AuthorizeUrl, openMs365Authorize } from "@/lib/ms365OAuth";

/**
 * Single entry point for standard Microsoft 365 connect/reconnect.
 * Remembers only a whitelisted internal return path (current route), then
 * launches authorization. The destination is never caller-supplied.
 */
export async function startMs365Authorize(
  cfg: { clientId: string; tenant: string; state?: string; prompt?: string },
  mode: "open" | "redirect" = "open",
): Promise<void> {
  rememberMs365ReturnTo(typeof window !== "undefined" ? window.location.pathname : null);
  if (mode === "redirect") {
    window.location.href = await buildMs365AuthorizeUrl(cfg as any);
    return;
  }
  await openMs365Authorize(cfg as any);
}
