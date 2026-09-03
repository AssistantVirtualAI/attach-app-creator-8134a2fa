/**
 * Version affichée dans l'app mobile.
 *
 * Source de vérité : la build native (`@capacitor/app` → MARKETING_VERSION /
 * CURRENT_PROJECT_VERSION). Après une soumission App Store / Play, la nouvelle
 * version s'affiche automatiquement — plus rien n'est codé en dur.
 * Si un paquet OTA plus récent est actif, sa version est ajoutée.
 */
import { Capacitor } from "@capacitor/core";

export type AppVersionInfo = { label: string; native: string; build: string; ota?: string };

export async function getAppVersionInfo(): Promise<AppVersionInfo> {
  if (!Capacitor.isNativePlatform()) {
    return { label: "Web", native: "web", build: "—" };
  }
  let native = import.meta.env.VITE_APP_VERSION || "—";
  let build = import.meta.env.VITE_NATIVE_BUILD || "—";
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    native = info.version || "—";
    build = info.build || "—";
  } catch { /* ignore */ }

  // Le plugin OTA n'est présent que dans le paquet mobile natif.
  let ota: string | undefined;
  try {
    const spec = "@capgo/capacitor-updater";
    const mod: any = await import(/* @vite-ignore */ spec);
    const updater = mod?.CapacitorUpdater;
    const current = await updater?.current?.();
    const v = current?.bundle?.version;
    if (v && v !== "builtin" && v !== native) ota = v;
  } catch { /* ignore */ }

  const label = `v${native} (build ${build})${ota ? ` · OTA ${ota}` : ""}`;
  return { label, native, build, ota };
}
