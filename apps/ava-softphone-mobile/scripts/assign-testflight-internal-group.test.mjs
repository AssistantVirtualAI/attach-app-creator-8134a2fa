import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const repoRoot = resolve(root, "..", "..");
const assignmentScript = readFileSync(
  resolve(root, "scripts/assign-testflight-internal-group.mjs"),
  "utf8",
);
const workflow = readFileSync(
  resolve(repoRoot, ".github/workflows/lemtel-ios-testflight-internal-group.yml"),
  "utf8",
);

test("TestFlight assignment is restricted to the processed Lemtel internal build", () => {
  assert.match(assignmentScript, /appId !== "6786177551"/);
  assert.match(assignmentScript, /groupName !== "Lemtel Internal"/);
  assert.match(assignmentScript, /marketingVersion !== "1\.1"/);
  assert.match(assignmentScript, /"filter\[version\]": buildVersion/);
  assert.match(
    assignmentScript,
    /"filter\[preReleaseVersion\.version\]": marketingVersion/,
  );
  assert.match(assignmentScript, /"filter\[processingState\]": "VALID"/);
  assert.doesNotMatch(assignmentScript, /filter\[buildVersion\]/);
  assert.match(assignmentScript, /processingState !== "VALID"/);
  assert.match(assignmentScript, /\/v1\/betaGroups\/\$\{group\.id\}\/relationships\/builds/);
  assert.match(assignmentScript, /type: "builds"/);
  assert.match(assignmentScript, /Lemtel Internal assignment did not verify/);
  assert.doesNotMatch(assignmentScript, /Planipret/i);
});

test("TestFlight assignment is explicitly gated in the protected iOS environment", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /marketing_version:\n        description: "Existing iOS marketing version\."\n        required: true\n        default: "1\.1"\n        type: string/,
  );
  assert.match(
    workflow,
    /push:\s*\n\s+tags:\s*\n\s+- "lemtel-ios-testflight-group-v1\.1\.5-r\*"/,
  );
  assert.match(workflow, /environment: lemtel-ios-testflight/);
  assert.match(workflow, /TESTFLIGHT_APP_ID: "6786177551"/);
  assert.match(workflow, /TESTFLIGHT_GROUP_NAME: "Lemtel Internal"/);
  assert.match(workflow, /github\.event_name == 'push' && '5'/);
  assert.match(workflow, /github\.event_name == 'push' && '1\.1'/);
  assert.match(workflow, /APPSTORE_API_PRIVATE_KEY: \$\{\{ secrets\.APPSTORE_API_PRIVATE_KEY \}\}/);
  assert.match(workflow, /assign-testflight-internal-group\.mjs/);
  assert.doesNotMatch(workflow, /planipret/i);
});
