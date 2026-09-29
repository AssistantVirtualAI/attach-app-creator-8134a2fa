// Thin wrappers around @capacitor/core so callers don't need lazy imports.
export async function isNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function getPlatform(): Promise<"ios" | "android" | "web"> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.getPlatform() as "ios" | "android" | "web";
  } catch {
    return "web";
  }
}

export type PermStatus = "granted" | "denied" | "prompt" | "unavailable";

export async function setPref(key: string, value: string) {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value });
  } catch { /* web: ignore */ }
}

export async function getPref(key: string): Promise<string | null> {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key });
    return value ?? null;
  } catch { return null; }
}

export async function openAppSettings() {
  try {
    const { Capacitor } = await import("@capacitor/core");
    const platform = Capacitor.getPlatform();
    if (platform === "ios") {
      window.open("app-settings:", "_system");
    } else if (platform === "android") {
      // Never navigate the WebView to a pseudo-URL (it resolved to
      // https://localhost/... and showed "Web page not available").
      window.alert("Ouvrez Réglages Android > Applications > Planiprêt > Autorisations pour activer l'accès.");
    }
  } catch { /* ignore */ }
}
