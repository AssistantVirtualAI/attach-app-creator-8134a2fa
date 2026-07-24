#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const appDir = path.resolve(path.dirname(__filename), "..");

const IOS_URL_TYPES = `
\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>com.planipret.mobile.oauth</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>planipret</string>
\t\t\t\t<string>capacitor</string>
\t\t\t</array>
\t\t</dict>
\t</array>
`;

const IOS_URL_TYPES_DICT = `
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>com.planipret.mobile.oauth</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>planipret</string>
\t\t\t\t<string>capacitor</string>
\t\t\t</array>
\t\t</dict>
`;

const ANDROID_INTENT_FILTERS = `
            <!-- Planiprêt OAuth deep links: Maestro + Microsoft mobile callbacks -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="planipret" android:host="auth" android:pathPrefix="/maestro/callback" />
            </intent-filter>

            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="capacitor" android:host="localhost" android:pathPrefix="/auth/microsoft/callback" />
                <data android:scheme="capacitor" android:host="localhost" android:pathPrefix="/auth/ms365/callback" />
            </intent-filter>
`;

function writeIfChanged(file, next) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (prev === next) return false;
  fs.writeFileSync(file, next);
  return true;
}

function patchIosInfoPlist() {
  const file = path.join(appDir, "ios", "App", "App", "Info.plist");
  if (!fs.existsSync(file)) {
    console.log("[native-config] iOS Info.plist not found — run npx cap add ios first.");
    return;
  }

  let xml = fs.readFileSync(file, "utf8");
  if (xml.includes("<string>planipret</string>") && xml.includes("<string>capacitor</string>")) {
    console.log("[native-config] iOS URL schemes already present.");
    return;
  }

  if (xml.includes("<key>CFBundleURLTypes</key>")) {
    xml = xml.replace(/(<key>CFBundleURLTypes<\/key>\s*<array>)/, `$1${IOS_URL_TYPES_DICT}`);
  } else {
    xml = xml.replace(/\n<\/dict>\s*\n<\/plist>\s*$/, `${IOS_URL_TYPES}\n</dict>\n</plist>\n`);
  }

  writeIfChanged(file, xml);
  console.log("[native-config] iOS URL schemes applied: planipret, capacitor.");
}

function patchAndroidManifest() {
  const file = path.join(appDir, "android", "app", "src", "main", "AndroidManifest.xml");
  if (!fs.existsSync(file)) {
    console.log("[native-config] AndroidManifest.xml not found — run npx cap add android first.");
    return;
  }

  let xml = fs.readFileSync(file, "utf8");
  const hasPlanipret = xml.includes('android:scheme="planipret"');
  const hasCapacitor = xml.includes('android:scheme="capacitor"') && xml.includes('android:host="localhost"');
  if (hasPlanipret && hasCapacitor) {
    console.log("[native-config] Android deep links already present.");
    return;
  }

  const mainActivityClose = /\n\s*<\/activity>/;
  if (!mainActivityClose.test(xml)) {
    console.warn("[native-config] Android MainActivity close tag not found; skipped.");
    return;
  }

  xml = xml.replace(mainActivityClose, `${ANDROID_INTENT_FILTERS}\n        </activity>`);
  writeIfChanged(file, xml);
  console.log("[native-config] Android deep links applied: planipret, capacitor://localhost.");
}

patchIosInfoPlist();
patchAndroidManifest();