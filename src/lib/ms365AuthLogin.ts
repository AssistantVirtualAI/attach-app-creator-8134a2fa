import { supabase } from "@/integrations/supabase/client";
import { openMs365Authorize } from "@/lib/ms365OAuth";
import { markMs365Pending } from "@/lib/ms365Pending";
import { Capacitor } from "@capacitor/core";

const INTENT_KEY = "pp_ms365_auth_intent";
const NEXT_KEY = "pp_ms365_auth_next";

async function nativeSet(key: string, value: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value });
  } catch {}
}

async function nativeGet(key: string): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key });
    return value ?? null;
  } catch {
    return null;
  }
}

async function nativeRemove(key: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key });
  } catch {}
}

/**
 * Fetches Microsoft SSO start configuration from the versioned
 * `pp-ms-auth-start` edge function. Falls back to `ms365-public-config`
 * for backward compatibility if the new function is not yet deployed.
 */
async function fetchStartConfig(): Promise<any | null> {
  const start = await supabase.functions.invoke("pp-ms-auth-start", { body: {} });
  if (!start.error && (start.data as any)?.configured) return start.data;
  const legacy = await supabase.functions.invoke("ms365-public-config", { body: {} });
  if (!legacy.error && (legacy.data as any)?.configured) return legacy.data;
  return null;
}

export async function isMs365LoginConfigured(): Promise<boolean> {
  const cfg = await fetchStartConfig();
  return Boolean(cfg?.configured && cfg?.client_id);
}

/** Encode/décode le chemin de retour dans le paramètre `state` OAuth. */
function encodeNext(nextPath: string): string {
  try {
    return btoa(nextPath).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    return "";
  }
}

/**
 * Extrait le chemin de retour d'un `state` OAuth (`login:<b64next>:<nonce>`).
 * Le state est la seule source fiable quand le stockage local est perdu
 * (cold start natif, nouvel onglet, navigation privée) — sans lui, on retombe
 * sur la page d'auth et l'utilisateur boucle.
 */
export function decodeNextFromState(state?: string | null): string | null {
  if (!state) return null;
  const parts = String(state).split(":");
  if (parts[0] !== "login" || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const path = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}

export async function startMicrosoftSignIn(
  nextPath = "/post-login",
  opts?: { loginHint?: string; prompt?: "select_account" | "consent" | "login" | "none" },
): Promise<void> {
  const cfg = await fetchStartConfig();
  if (!cfg?.configured || !cfg?.client_id) {
    throw new Error("Microsoft SSO n'est pas configuré.");
  }
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/post-login";
  try {
    localStorage.setItem(INTENT_KEY, "login");
    localStorage.setItem(NEXT_KEY, safeNext);
  } catch {}
  await nativeSet(INTENT_KEY, "login");
  await nativeSet(NEXT_KEY, safeNext);
  markMs365Pending();
  await openMs365Authorize({
    clientId: cfg.client_id,
    tenant: cfg.tenant_id || "common",
    state: `login:${encodeNext(safeNext)}`,
    prompt: opts?.prompt,
    loginHint: opts?.loginHint,
  });
}


export function getMicrosoftSignInIntent(): string | null {
  try { return localStorage.getItem(INTENT_KEY); } catch { return null; }
}

export async function getMicrosoftSignInIntentAsync(): Promise<string | null> {
  return getMicrosoftSignInIntent() || (await nativeGet(INTENT_KEY));
}

export function getMicrosoftSignInNext(defaultPath = "/post-login"): string {
  try {
    const next = localStorage.getItem(NEXT_KEY) || defaultPath;
    return next.startsWith("/") && !next.startsWith("//") ? next : defaultPath;
  } catch {
    return defaultPath;
  }
}

export async function getMicrosoftSignInNextAsync(defaultPath = "/post-login"): Promise<string> {
  const next = getMicrosoftSignInNext(defaultPath);
  if (next !== defaultPath) return next;
  const nativeNext = await nativeGet(NEXT_KEY);
  return nativeNext && nativeNext.startsWith("/") && !nativeNext.startsWith("//") ? nativeNext : defaultPath;
}

export function clearMicrosoftSignInIntent(): void {
  try { localStorage.removeItem(INTENT_KEY); } catch {}
  try { localStorage.removeItem(NEXT_KEY); } catch {}
  void nativeRemove(INTENT_KEY);
  void nativeRemove(NEXT_KEY);
}

export async function clearMicrosoftSignInIntentAsync(): Promise<void> {
  clearMicrosoftSignInIntent();
  await nativeRemove(INTENT_KEY);
  await nativeRemove(NEXT_KEY);
}

/**
 * Full sign-out: clears the Supabase session, drops the pending Microsoft
 * intent, then ends the Microsoft 365 session and returns to `returnPath`.
 */
export async function signOutMicrosoft(returnPath = "/planipret/admin"): Promise<void> {
  try { await supabase.auth.signOut(); } catch {}
  await clearMicrosoftSignInIntentAsync();
  try { localStorage.removeItem("pp_ms365_callback_url"); } catch {}

  const safePath = returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/planipret/admin";
  if (Capacitor.isNativePlatform()) {
    window.location.replace(safePath);
    return;
  }
  let tenant = "common";
  try {
    const cfg = await fetchStartConfig();
    if (cfg?.tenant_id) tenant = cfg.tenant_id;
  } catch {}
  const post = `${window.location.origin}${safePath}`;
  window.location.replace(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(post)}`,
  );
}
