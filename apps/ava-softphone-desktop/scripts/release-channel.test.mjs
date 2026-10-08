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

test("Desktop release documentation preserves the Lemtel-only release boundary", () => {
  assert.match(runbook, /déjà fusionné dans `lemtel\/integration`/);
  assert.match(runbook, /fusionner le commit dans `lemtel\/integration`/);
  assert.match(runbook, /non signé/);
  assert.doesNotMatch(runbook, /fusionner le commit dans `Planipret`/);
});
