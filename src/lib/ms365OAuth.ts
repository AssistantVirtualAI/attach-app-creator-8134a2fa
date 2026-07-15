import { Capacitor } from "@capacitor/core";

export const MS365_DELEGATED_SCOPES =
  "openid profile email offline_access User.Read Mail.ReadWrite Mail.Send MailboxSettings.Read Calendars.ReadWrite";

export const MS365_WEB_CALLBACK_PATH = "/auth/microsoft/callback";
export const MS365_NATIVE_REDIRECT_URI = "planipret://auth/microsoft/callback";

const REDIRECT_STORAGE_KEY = "pp_ms365_redirect_uri";

export function getMs365RedirectUri(): string {
  if (Capacitor.isNativePlatform()) return MS365_NATIVE_REDIRECT_URI;
  return `${window.location.origin}${MS365_WEB_CALLBACK_PATH}`;
}

export function rememberMs365RedirectUri(redirectUri: string): void {
  try { sessionStorage.setItem(REDIRECT_STORAGE_KEY, redirectUri); } catch {}
  try { localStorage.setItem(REDIRECT_STORAGE_KEY, redirectUri); } catch {}
}

export function getRememberedMs365RedirectUri(): string {
  try {
    return sessionStorage.getItem(REDIRECT_STORAGE_KEY) || localStorage.getItem(REDIRECT_STORAGE_KEY) || getMs365RedirectUri();
  } catch {
    return getMs365RedirectUri();
  }
}

export function clearRememberedMs365RedirectUri(): void {
  try { sessionStorage.removeItem(REDIRECT_STORAGE_KEY); } catch {}
  try { localStorage.removeItem(REDIRECT_STORAGE_KEY); } catch {}
}

export function buildMs365AuthorizeUrl(cfg: {
  clientId: string;
  tenant?: string | null;
  state?: string | null;
  prompt?: "select_account" | "consent" | "none";
  scopes?: string;
}): string {
  const redirectUri = getMs365RedirectUri();
  rememberMs365RedirectUri(redirectUri);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: cfg.scopes ?? MS365_DELEGATED_SCOPES,
    prompt: cfg.prompt ?? "select_account",
  });
  if (cfg.state) params.set("state", cfg.state);
  return `https://login.microsoftonline.com/${cfg.tenant || "common"}/oauth2/v2.0/authorize?${params.toString()}`;
}

export function openMs365Authorize(cfg: {
  clientId: string;
  tenant?: string | null;
  state?: string | null;
  prompt?: "select_account" | "consent" | "none";
  scopes?: string;
}): void {
  window.location.href = buildMs365AuthorizeUrl(cfg);
}