import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const workflow = readFileSync(
  resolve(root, ".github/workflows/release-desktop.yml"),
  "utf8",
);
const runbook = readFileSync(
  resolve(root, "apps/ava-softphone-desktop/RELEASE.md"),
  "utf8",
);
const builderConfig = readFileSync(
  resolve(root, "apps/ava-softphone-desktop/electron-builder.yml"),
  "utf8",
);

test("Desktop public-release tags are accepted only from Lemtel integration", () => {
  assert.match(workflow, /git fetch --no-tags origin lemtel\/integration/);
  assert.match(
    workflow,
    /git merge-base --is-ancestor "\$GITHUB_SHA" FETCH_HEAD/,
  );
  assert.match(workflow, /must be merged into lemtel\/integration first/);
  assert.doesNotMatch(workflow, /git fetch --no-tags origin Planipret/);
});

test("Windows release preserves explicit signing state and a working unsigned path", () => {
  assert.match(workflow, /windows_signed/);
  assert.match(
    workflow,
    /Windows signed build disabled: Authenticode secrets are absent/,
  );
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY = 'false'/);
  assert.match(
    workflow,
    /Windows installer intentionally unsigned; SmartScreen warning is expected/,
  );
  assert.match(workflow, /may trigger Microsoft SmartScreen/);
  assert.match(workflow, /needs\.build-windows\.result == 'success'/);
});

test("Public macOS and Windows releases require the approved Hostinger profile", () => {
  const macBlock = workflow.slice(
    workflow.indexOf("  build-mac:"),
    workflow.indexOf("  build-windows:"),
  );
  const windowsBlock = workflow.slice(
    workflow.indexOf("  build-windows:"),
    workflow.indexOf("  publish:"),
  );
  const requiredProfileFields = [
    "environment: lemtel-hostinger-staging",
    "VITE_LEMTEL_TARGET: ${{ vars.VITE_LEMTEL_TARGET }}",
    "VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}",
    "VITE_LEMTEL_PRIVATE_DIRECTORY: ${{ vars.VITE_LEMTEL_PRIVATE_DIRECTORY }}",
    "VITE_LEMTEL_EMAIL_ONLY_SIGNIN: ${{ vars.VITE_LEMTEL_EMAIL_ONLY_SIGNIN }}",
    "VITE_LEMTEL_AUTH_REDIRECT_URL: ${{ vars.VITE_LEMTEL_AUTH_REDIRECT_URL }}",
    "VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}",
    "node scripts/lemtel-hostinger-client-config-filter.mjs",
  ];

  for (const field of requiredProfileFields) {
    assert.ok(macBlock.includes(field), `macOS build must include ${field}`);
    assert.ok(
      windowsBlock.includes(field),
      `Windows build must include ${field}`,
    );
  }
});

test("Release manifests reference stable artifact names on every platform", () => {
  assert.match(
    builderConfig,
    /artifactName: "Lemtel-Telecom-\$\{version\}-\$\{arch\}\.\$\{ext\}"/,
  );
  assert.match(
    builderConfig,
    /artifactName: "Lemtel-Telecom-Setup-\$\{version\}\.\$\{ext\}"/,
  );
});

test("Desktop release documentation preserves the Lemtel-only release boundary", () => {
  assert.match(runbook, /déjà fusionné dans `lemtel\/integration`/);
  assert.match(runbook, /fusionner le commit dans `lemtel\/integration`/);
  assert.match(runbook, /non signé/);
  assert.doesNotMatch(runbook, /fusionner le commit dans `Planipret`/);
});
