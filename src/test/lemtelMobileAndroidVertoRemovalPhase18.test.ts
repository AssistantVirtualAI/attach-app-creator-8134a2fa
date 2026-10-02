import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const BASE = "8f444cbee";
const APP = "apps/ava-softphone-mobile";
const JAVA = `${APP}/android/app/src/main/java/com/lemtel/softphone`;
const SVC = `${JAVA}/SipConnectionService.kt`;
const PLUGIN = `${JAVA}/CapacitorPjsip.kt`;
const MAIN = `${JAVA}/MainActivity.kt`;
const RECV = `${JAVA}/CallActionReceiver.kt`;
const MANIFEST = `${APP}/android/app/src/main/AndroidManifest.xml`;
const HOOK = `${APP}/src/hooks/useSoftphone.ts`;
const PROVIDER = `${APP}/src/lib/sip/nativeSipProvider.ts`;
const BRIDGE = `${APP}/src/lib/sip/useCallActionBridge.ts`;
const APPTSX = `${APP}/src/MobileApp.tsx`;
const BASE_18B2 = "2d933df2f";
const PHASE18B2_END = "7708653c4";
const PHASE18B2_CHANGED_FILES = [
  "apps/ava-softphone-mobile/android/app/src/main/java/com/lemtel/softphone/CapacitorPjsip.kt",
  "apps/ava-softphone-mobile/src/MobileApp.tsx",
  "apps/ava-softphone-mobile/src/hooks/useSoftphone.ts",
  "docs/lemtel-mobile/phase-18b1-android-verto-removal.md",
  "src/test/lemtelMobileAndroidVertoRemovalPhase18.test.ts",
];
const PHASE18B1_END = "a1ecca276";
const PHASE18B1_CHANGED_FILES = [
  "apps/ava-softphone-mobile/android/app/src/main/AndroidManifest.xml",
  "apps/ava-softphone-mobile/android/app/src/main/java/com/lemtel/softphone/BootReceiver.kt",
  "apps/ava-softphone-mobile/android/app/src/main/java/com/lemtel/softphone/CallActionReceiver.kt",
  "apps/ava-softphone-mobile/android/app/src/main/java/com/lemtel/softphone/CapacitorPjsip.kt",
  "apps/ava-softphone-mobile/android/app/src/main/java/com/lemtel/softphone/MainActivity.kt",
  "apps/ava-softphone-mobile/android/app/src/main/java/com/lemtel/softphone/SipConnectionService.kt",
  "apps/ava-softphone-mobile/src/MobileApp.tsx",
  "apps/ava-softphone-mobile/src/hooks/useSoftphone.runtime.test.tsx",
  "apps/ava-softphone-mobile/src/hooks/useSoftphone.ts",
  "apps/ava-softphone-mobile/src/hooks/useSoftphoneVerto.ts",
  "apps/ava-softphone-mobile/src/lib/sip/audioOutput.ts",
  "apps/ava-softphone-mobile/src/lib/sip/iceServers.ts",
  "apps/ava-softphone-mobile/src/lib/sip/jssipProvider.ts",
  "apps/ava-softphone-mobile/src/lib/sip/nativeSipProvider.ts",
  "apps/ava-softphone-mobile/src/lib/sip/vertoProvider.test.ts",
  "apps/ava-softphone-mobile/src/lib/sip/vertoProvider.ts",
  "apps/ava-softphone-mobile/src/screens/DialerScreen.tsx",
  "apps/ava-softphone-mobile/src/screens/SipDebugScreen.tsx",
  "docs/lemtel-mobile/phase-18b1-android-verto-removal.md",
  "src/test/lemtelMobileAndroidVertoRemovalPhase18.test.ts",
];

// Read-only historical helper: only git cat-file, merge-base and diff --name-only --no-renames.
const histGit = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const frozenRange = (base: string, end: string): string[] => {
  for (const c of [base, end]) expect(histGit("cat-file", "-t", c).trim(), `missing commit ${c}`).toBe("commit");
  expect(() => histGit("merge-base", "--is-ancestor", base, end), `${base} not ancestor of ${end}`).not.toThrow();
  return [...new Set(histGit("diff", "--name-only", "--no-renames", `${base}..${end}`).split("
").map((x) => x.trim()).filter(Boolean))].sort();
};
const isProtectedPath = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const permanentGuardPasses = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { encoding: "utf8" });
const read = (p: string) => readFileSync(p, "utf8");

const ALLOWED = new Set([
  `${APP}/src/hooks/useSoftphone.ts`,
  `${APP}/src/hooks/useSoftphoneVerto.ts`,
  `${APP}/src/lib/sip/vertoProvider.ts`,
  `${APP}/src/lib/sip/vertoProvider.test.ts`,
  `${APP}/src/lib/sip/nativeSipProvider.ts`,
  `${APP}/src/lib/sip/jssipProvider.ts`,
  `${APP}/src/lib/sip/audioOutput.ts`,
  `${APP}/src/lib/sip/androidCallNotif.ts`,
  `${APP}/src/lib/sip/useCallActionBridge.ts`,
  `${APP}/src/lib/sip/iceServers.ts`, // one stale comment only (documented deviation)
  `${APP}/src/screens/SipDebugScreen.tsx`,
  `${APP}/src/screens/DialerScreen.tsx`,
  `${APP}/src/MobileApp.tsx`,
  MANIFEST,
  `${APP}/android/app/proguard-rules.pro`,
  SVC, PLUGIN, RECV, MAIN,
  `${JAVA}/BootReceiver.kt`,
  `${APP}/src/hooks/useSoftphone.runtime.test.tsx`,
  "src/test/lemtelMobileAndroidVertoRemovalPhase18.test.ts",
  "src/test/lemtelMobileVertoRuntimePhase18.test.ts",
  "docs/lemtel-mobile/phase-18b1-android-verto-removal.md",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "build" || n === "dist") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|kt|java|xml)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

const FORBIDDEN = [
  /verto/i, /connectVerto/, /80{1}82/, /SSLSocket/, /ACTION_NATIVE_VERTO/, /ACTION_VERTO_SERVER_MESSAGE/,
  /registerOutboundCall/, /answerNativeCall/, /hangupNativeCall/, /onAndroidVertoServerMessage/,
];

describe("Phase 18B-1 — dormant Android Verto stack removed", () => {
  it("no Lemtel Android runtime source contains Verto artifacts", () => {
    const files = [...walk(`${APP}/src`), ...walk(`${APP}/android/app/src/main`)];
    const hits: string[] = [];
    for (const f of files) {
      const s = read(f);
      for (const re of FORBIDDEN) if (re.test(s)) hits.push(`${f}: ${re}`);
    }
    expect(hits).toEqual([]);
  });

  it("Verto modules and BootReceiver are deleted", () => {
    for (const p of [`${APP}/src/hooks/useSoftphoneVerto.ts`, `${APP}/src/lib/sip/vertoProvider.ts`, `${JAVA}/BootReceiver.kt`]) {
      expect(existsSync(p), p).toBe(false);
    }
  });

  it("Android dispatch selects JsSIP and imports no Verto code", () => {
    const s = read(HOOK);
    expect(s).not.toMatch(/useSoftphoneVerto|vertoProvider/);
    const body = s.slice(s.indexOf("export function useSoftphone("));
    const android = body.slice(body.indexOf("platform === 'android'"));
    expect(android.slice(0, android.indexOf("}"))).toContain("return useSoftphoneJsSip(config, opts)");
  });

  it("foreground service is a JsSIP-support helper: never emits registered, START_NOT_STICKY, no boot start", () => {
    const s = read(SVC);
    expect(s).toContain('emitStatus("running", "foreground_helper_started")');
    expect(s).not.toMatch(/"registered"|"connecting"|"reconnecting"|"incoming"|"active"|"disconnected"/);
    expect(s).toContain("START_NOT_STICKY");
    expect(s).not.toContain("START_STICKY\n");
    expect(s).not.toMatch(/registered|connected|ready to receive|Prêt à recevoir|Connecté/i);
    expect(s).toContain("Background call support active");
    const m = read(MANIFEST);
    expect(m).not.toMatch(/RECEIVE_BOOT_COMPLETED|BootReceiver|BOOT_COMPLETED/);
    expect(m).toContain('android:foregroundServiceType="phoneCall"');
  });

  it("no native foreground helper API accepts or stores SIP credentials", () => {
    const svc = read(SVC);
    expect(svc).not.toMatch(/password|saveCredentials|KEY_HOST|KEY_PORT|KEY_LOGIN|KEY_DOMAIN|sdp/i);
    const plugin = read(PLUGIN);
    const start = plugin.slice(plugin.indexOf("fun startSipService"), plugin.indexOf("fun getSipServiceStatus"));
    expect(start).not.toMatch(/getString|getInt|password|host|login/);
    const p = read(PROVIDER);
    expect(p).toContain("export async function startAndroidSipService(): Promise<AndroidSipServiceStatus | null>");
    expect(p).toContain("startSipService?.({})");
  });

  it("notification action flow is present and contains no native SIP signaling", () => {
    const r = read(RECV);
    expect(r).toContain("ACTION_CALL_ACTION_EVENT");
    expect(read(PLUGIN)).toContain('notifyListeners("sipCallAction"');
    expect(read(BRIDGE)).toContain("sipCallAction");
    expect(read(MAIN)).not.toContain("reEmitIncomingStatus");
    for (const f of [RECV, SVC, MAIN]) expect(read(f)).not.toMatch(/answerNativeCall|hangupNativeCall|bye|invite/i);
  });

  it("call audio bridge is used on outgoing, answer and terminal JsSIP paths", () => {
    const s = read(HOOK);
    expect(s).toMatch(/beginAndroidCallAudio\(\);\s*\n\s*uaRef\.current\.call\(/);
    expect(s).toMatch(/beginAndroidCallAudio\(\);\s*\n\s*sessionRef\.current\?\.answer\(/);
    expect((s.match(/endCallAudio\(\);/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(s).toContain("void endAndroidCallAudio()");
    const plugin = read(PLUGIN);
    expect(plugin).toContain("fun beginCallAudio");
    expect(plugin).toContain("fun endCallAudio");
  });

  it("frozen Phase 18B-1 interval is exact and the permanent Planiprêt guard passes", () => {
    expect(permanentGuardPasses()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(PHASE18B1_CHANGED_FILES).toHaveLength(20);
    expect([...PHASE18B1_CHANGED_FILES].sort()).toEqual(PHASE18B1_CHANGED_FILES);
    const hist = frozenRange(BASE, PHASE18B1_END);
    expect(hist).toEqual(PHASE18B1_CHANGED_FILES);
    expect(hist.filter(isProtectedPath)).toEqual([]);
    expect(hist.filter((p) => p.startsWith(`${APP}/`) && !ALLOWED.has(p))).toEqual([]);
  }, 30000);
});

describe("Phase 18B-2 — Android plugin is helper-only", () => {
  it("CapacitorPjsip.kt declares no account or call-signaling method", () => {
    const k = read(PLUGIN);
    for (const m of ["initAccount", "makeCall", "startCall", "hangup", "answer", "disconnect", "sendDTMF", "transfer", "park", "addCall",
      "microphonePermissionCallback", "setMute", "setHold", "setHeld", "getSnapshot", "snapshot", "startRecord", "stopRecord",
      "startRecording", "stopRecording", "setLiveTranscriptionEnabled", "getRtpStats", "setLogLevel"]) {
      expect(k, m).not.toMatch(new RegExp(`fun\\s+${m}\\s*\\(`));
    }
    expect(k).toContain("fun micPermCallback(");
    expect(k).toContain('name = "CapacitorPjsip"');
  });

  it("CapacitorPjsip.kt reads no SIP account configuration", () => {
    const k = read(PLUGIN);
    for (const key of ["server", "password", "username", "extension", "domain", "transport", "target", "number", "callId", "sdp"]) {
      expect(k, key).not.toContain(`getString("${key}"`);
    }
    expect(k).not.toContain('getInt("port"');
    expect(k).not.toMatch(/wss:\/\/|Socket\(|REGISTER|INVITE/);
  });

  it("startSipService takes no options and only starts the helper", () => {
    const k = read(PLUGIN);
    const body = k.slice(k.indexOf("fun startSipService"), k.indexOf("fun getSipServiceStatus"));
    expect(body).toContain("SipConnectionService.start(context)");
    expect(body).not.toMatch(/call\.get(String|Int|Boolean|Object|Array)/);
  });

  it("TypeScript Android bridge exposes no account/call helpers", () => {
    const p = read(PROVIDER);
    const bridge = p.slice(p.indexOf("interface AndroidSipServiceBridge"), p.indexOf("export interface AndroidSipServiceStatus"));
    expect(bridge).not.toMatch(/initAccount|makeCall|startCall|hangup|answer|disconnect|sendDTMF|transfer|park|addCall/);
    expect(p).toMatch(/export async function startAndroidSipService\(\)/);
    expect(p).toContain("never set by Android");
  });

  it("helper starts only after JsSIP registered and stops on hook cleanup", () => {
    const s = read(HOOK);
    const starts = [...s.matchAll(/\bstartAndroidSipService\(\)/g)].length;
    expect(starts).toBe(1);
    const reg = s.slice(s.indexOf("ua.on('registered'"));
    expect(reg.slice(0, reg.indexOf("});"))).toContain("startAndroidSipService()");
    expect(s).toMatch(/uaRef\.current = null;\s*\n\s*\/\/[^\n]*\n\s*if \(Capacitor\.getPlatform\(\) === 'android'\) void stopAndroidSipService\(\);/);
  });

  it("MobileApp.tsx does not claim the helper keeps a WebSocket alive", () => {
    const s = read(APPTSX);
    expect(s).not.toMatch(/keeps the WebView WebSocket alive/i);
    expect(s).toContain("JsSIP is the only WebSocket and registration owner");
  });

  it("frozen Phase 18B-2 interval is exact and the permanent Planiprêt guard passes", () => {
    expect(permanentGuardPasses()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(PHASE18B2_CHANGED_FILES).toHaveLength(5);
    expect([...PHASE18B2_CHANGED_FILES].sort()).toEqual(PHASE18B2_CHANGED_FILES);
    const hist = frozenRange(BASE_18B2, PHASE18B2_END);
    expect(hist).toEqual(PHASE18B2_CHANGED_FILES);
    expect(hist.filter(isProtectedPath)).toEqual([]);
  }, 30000);
});
