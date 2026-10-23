import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isAllowedRef,
  isAllowedWorkflow,
  isDuplicateBuild,
  isRateLimited,
  refType,
  sanitizeBuildStatus,
} from "./index.ts";

Deno.test("workflows: seuls les 3 workflows allowlistés passent", () => {
  assertEquals(isAllowedWorkflow("planipret-ios-artifact"), true);
  assertEquals(isAllowedWorkflow("planipret-android-artifact"), true);
  assertEquals(isAllowedWorkflow("planipret-release-artifacts"), true);
  assertEquals(isAllowedWorkflow("upload-to-store"), false);
  assertEquals(isAllowedWorkflow("../../etc"), false);
  assertEquals(isAllowedWorkflow(undefined), false);
});

Deno.test("refs: release/* et pp-v* seulement", () => {
  assertEquals(isAllowedRef("release/1.5.2"), true);
  assertEquals(isAllowedRef("pp-v1.5.2"), true);
  assertEquals(isAllowedRef("pp-v1.5.2-rc1"), true);
  assertEquals(isAllowedRef("main"), false);
  assertEquals(isAllowedRef("release/../../etc"), false);
  assertEquals(isAllowedRef("release/$(rm -rf /)"), false);
  assertEquals(isAllowedRef(""), false);
  assertEquals(refType("pp-v1.5.2"), "tag");
  assertEquals(refType("release/1.5.2"), "branch");
});

Deno.test("rate limit: 3 démarrages par heure maximum", () => {
  assertEquals(isRateLimited(0), false);
  assertEquals(isRateLimited(2), false);
  assertEquals(isRateLimited(3), true);
  assertEquals(isRateLimited(10), true);
});

Deno.test("anti-double-build: même workflow + même SHA actif = refusé", () => {
  const active = [{ workflow: "planipret-ios-artifact", sha: "abc", status: "building" }];
  assertEquals(isDuplicateBuild(active, "planipret-ios-artifact", "abc"), true);
  assertEquals(isDuplicateBuild(active, "planipret-android-artifact", "abc"), false);
  assertEquals(isDuplicateBuild(active, "planipret-ios-artifact", "def"), false);
  const finished = [{ workflow: "planipret-ios-artifact", sha: "abc", status: "finished" }];
  assertEquals(isDuplicateBuild(finished, "planipret-ios-artifact", "abc"), false);
});

Deno.test("sanitizeBuildStatus ne renvoie aucun champ sensible", () => {
  const raw = {
    _id: "a".repeat(24),
    status: "finished",
    workflowId: "planipret-ios-artifact",
    branch: "release/1.5.2",
    startedAt: "2026-10-23T00:00:00Z",
    finishedAt: "2026-10-23T01:00:00Z",
    artifacts: [{ name: "App.ipa", url: "https://cdn/example.ipa", size: 123 }],
    environment: { CM_KEYSTORE_PASSWORD: "secret" },
    config: { apiToken: "secret" },
    logs: "token=secret",
  };
  const clean = sanitizeBuildStatus(raw);
  const text = JSON.stringify(clean);
  assertEquals(text.includes("secret"), false);
  assertEquals(clean.status, "finished");
  assertEquals((clean.artifacts as any[]).length, 1);
  assertEquals("environment" in clean, false);
  assertEquals("config" in clean, false);
  assertEquals("logs" in clean, false);
});
