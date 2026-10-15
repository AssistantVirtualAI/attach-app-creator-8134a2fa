import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

test("every server-owned telephony readiness capability has a visible Lemtel navigation section", () => {
  const catalog = source("infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/lemtelTelephonyReadiness.ts");
  const control = source("src/pages/lemtel/onboarding/LemtelTelephonyControl.tsx");
  const keys = [...catalog.matchAll(/^\s*\["([a-z_]+)",/gm)].map((match) => match[1]);

  assert.ok(keys.length >= 40, "the server-owned catalog must stay comprehensive");
  for (const key of keys) {
    assert.ok(control.includes(`"${key}"`), `telephony capability ${key} must remain reachable from the portal navigation`);
  }

  for (const label of ["Inventaire téléphonie", "Routage et IVR", "Centre d’appels", "Médias et analytique", "Communications", "Supervision", "Administration téléphonie"]) {
    assert.ok(control.includes(label), `missing navigation domain ${label}`);
  }
  assert.match(control, /portalApi\.getTelephonyReadiness/);
  assert.doesNotMatch(control, /fetch\s*\(/);
  assert.doesNotMatch(control, /avastatistic|planiprêt/i);
});

test("telephony subroutes stay below the namespaced Lemtel portal route", () => {
  const app = source("src/pages/lemtel/onboarding/LemtelPortalApp.tsx");
  assert.match(app, /path=\{`\$\{BASE\}\/telephony\/\*`\}/);
  assert.match(app, /basePath=\{`\$\{BASE\}\/telephony`\}/);
});
