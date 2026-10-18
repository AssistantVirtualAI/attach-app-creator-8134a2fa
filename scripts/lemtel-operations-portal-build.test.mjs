import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Lemtel Operations portal has its own deployable entrypoint", () => {
  const entry = read("src/lemtel-portal-main.tsx");
  const config = read("vite.config.lemtel-portal.ts");
  const html = read("lemtel-portal.html");
  assert.match(entry, /LemtelPortalApp/);
  assert.doesNotMatch(entry, /from "\.\/App/);
  assert.match(config, /base:\s*"\/lemtel-portal\/"/);
  assert.match(config, /publicDir:\s*false/);
  assert.match(config, /outDir:\s*"dist-lemtel-portal"/);
  assert.match(html, /Lemtel — Administration/);
  assert.match(html, /noindex, nofollow/);
});

test("private Operations portal build uses only the canonical Lemtel configuration", () => {
  const workflow = read(".github/workflows/lemtel-operations-portal-build.yml");
  for (const expected of [
    "branches: [lemtel/integration]",
    "src/lemtel-portal-main.tsx",
    "src/pages/lemtel/onboarding/**",
    "workflow_dispatch",
    "environment: lemtel-hostinger-staging",
    "VITE_LEMTEL_TARGET",
    "VITE_LEMTEL_API_URL",
    "VITE_LEMTEL_PRIVATE_DIRECTORY",
    "VITE_LEMTEL_EMAIL_ONLY_SIGNIN: approved",
    "VITE_LEMTEL_PUBLISHABLE_KEY",
    "VITE_LEMTEL_HOSTED_ONBOARDING: approved",
    "lemtel-hostinger-client-config-filter.mjs",
    "vite.config.lemtel-portal.ts",
    "lemtel-operations-portal",
    "retention-days: 3",
    "id-token: write",
    "attestations: write",
    "id: portal_artifact",
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4",
    "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4",
    "subject-name: lemtel-operations-portal-${{ github.run_id }}",
    "subject-digest: sha256:${{ steps.portal_artifact.outputs.artifact-digest }}",
  ]) assert.match(workflow, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(workflow, /uses:\s*actions\/(?:checkout|setup-node|upload-artifact|attest)@v4\b/i);
  assert.doesNotMatch(workflow, /\b(?:ssh|scp|rsync|curl)\b/i);
  assert.doesNotMatch(workflow, /(?:cloudflare|digitalocean).*?(?:request|action)/i);
});
