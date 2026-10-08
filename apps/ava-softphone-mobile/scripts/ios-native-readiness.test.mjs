import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const repoRoot = resolve(root, "..", "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const readRepo = (path) => readFileSync(resolve(repoRoot, path), "utf8");

test("iOS presents Lemtel while retaining AVA attribution", () => {
  const info = read("ios/App/App/Info.plist");
  assert.match(
    info,
    /<key>CFBundleDisplayName<\/key>\s*<string>Lemtel<\/string>/,
  );
  assert.match(info, /Lemtel, powered by AVA/);
  assert.match(info, /Lemtel, propulsé par AVA/);
  assert.doesNotMatch(info, /<string>AVA Softphone<\/string>/);
});

test("iOS release metadata permits Hostinger Auth without hard-coding a PBX change", () => {
  const info = read("ios/App/App/Info.plist");
  assert.match(info, /<string>lemtel\.avastatistic\.ca<\/string>/);
  assert.doesNotMatch(info, /<key>UIRequiresPersistentWiFi<\/key>/);

  const capacitor = read("capacitor.config.ts");
  assert.match(capacitor, /webContentsDebuggingEnabled:\s*false/);
});

test("APNs entitlement is configuration-specific for device tests and TestFlight", () => {
  const entitlements = read("ios/App/App/App.entitlements");
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.match(entitlements, /<string>\$\(APS_ENVIRONMENT\)<\/string>/);
  assert.doesNotMatch(entitlements, /com\.apple\.developer\.pushkit\.unrestricted-voip/);
  assert.match(project, /APS_ENVIRONMENT = development;[\s\S]*?name = Debug;/);
  assert.match(project, /APS_ENVIRONMENT = production;[\s\S]*?name = Release;/);
  assert.match(project, /CURRENT_PROJECT_VERSION = 3;/);
  assert.match(project, /MARKETING_VERSION = 1\.1;/);
  assert.match(project, /CODE_SIGN_IDENTITY = "Apple Distribution";[\s\S]*?name = Release;/);
  assert.match(project, /CODE_SIGN_STYLE = Manual;[\s\S]*?PROVISIONING_PROFILE_SPECIFIER = "\$\(LEMTEL_APP_STORE_PROFILE_UUID\)";[\s\S]*?name = Release;/);
});

test("TestFlight delivery is signed, internal, Hostinger-bound, and Lemtel-tag controlled", () => {
  const workflow = readRepo(".github/workflows/lemtel-ios-testflight.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /confirm_testflight_upload/);
  assert.match(
    workflow,
    /push:\s*\n\s+tags:\s*\n\s+- "lemtel-ios-testflight-v\*"/,
  );
  assert.match(workflow, /github\.event_name == 'push' \|\| inputs\.confirm_testflight_upload == true/);
  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /name: Validate Apple upload SDK/);
  assert.match(workflow, /test "\$xcode_major" -ge 26/);
  assert.match(workflow, /environment: lemtel-ios-testflight/);
  assert.match(workflow, /VITE_LEMTEL_EMAIL_ONLY_SIGNIN: approved/);
  assert.match(workflow, /apple-actions\/import-codesign-certs@v7/);
  assert.match(workflow, /apple-actions\/download-provisioning-profiles@v6/);
  assert.match(workflow, /apple-actions\/upload-testflight-build@v5/);
  assert.match(workflow, /bundle-id: com\.lemtel\.softphone/);
  assert.match(workflow, /profile-type: IOS_APP_STORE/);
  assert.match(workflow, /id: app_store_profile/);
  assert.match(workflow, /steps\.app_store_profile\.outputs\.profiles/);
  assert.match(workflow, /LEMTEL_APP_STORE_PROFILE_UUID/);
  assert.match(workflow, /signingStyle<\/key><string>manual<\/string>/);
  assert.doesNotMatch(workflow, /uses-non-exempt-encryption:/);
  assert.doesNotMatch(workflow, /apps\/planipret-mobile/);
  assert.doesNotMatch(workflow, /branches:\s*\n\s+- "Planipret"/);
});
