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
    "workflow_dispatch",
    "environment: lemtel-hostinger-staging",
    "VITE_LEMTEL_TARGET",
    "VITE_SUPABASE_URL",
    "VITE_LEMTEL_PRIVATE_DIRECTORY",
    "VITE_LEMTEL_EMAIL_ONLY_SIGNIN: approved",
    "VITE_LEMTEL_HOSTED_ONBOARDING: disabled",
    "lemtel-hostinger-client-config-filter.mjs",
    "vite.config.lemtel-portal.ts",
    "lemtel-operations-portal",
    "retention-days: 3",
  ]) assert.match(workflow, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(workflow, /\b(?:ssh|scp|rsync|curl)\b/i);
  assert.doesNotMatch(workflow, /(?:cloudflare|digitalocean).*?(?:request|action)/i);
});
