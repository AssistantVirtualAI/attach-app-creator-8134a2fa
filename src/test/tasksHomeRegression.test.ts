import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("MHome — tasks replace the recent calls block", () => {
  const home = read("src/pages/planipret/mobile/MHome.tsx");

  it("renders the tasks section", () => {
    expect(home).toContain("TasksSection");
  });

  it("no longer renders a recent-calls block on the home screen", () => {
    expect(home).not.toMatch(/recentCalls/);
    expect(home).not.toMatch(/Appels récents/);
  });
});

describe("regression — the Calls tab and VoIP stack are untouched", () => {
  const app = read("src/App.tsx");

  it("keeps the mobile calls route", () => {
    expect(app).toContain('import("./pages/planipret/mobile/MCalls")');
    expect(app).toMatch(/path="calls"[\s\S]{0,120}MCalls/);
  });

  it("keeps the call history page available", () => {
    const calls = read("src/pages/planipret/mobile/MCalls.tsx");
    expect(calls.length).toBeGreaterThan(100);
  });
});

describe("security — no Planiprêt/Maestro secret reaches the client bundle", () => {
  const clientFiles = [
    "src/lib/planipret/tasks.ts",
    "src/hooks/planipret/usePlanipretTasks.ts",
    "src/components/planipret/mobile/TasksSection.tsx",
    "src/components/planipret/mobile/TaskComposerSheet.tsx",
  ].map(read).join("\n");

  it("never calls client.planipret.com directly", () => {
    expect(clientFiles).not.toContain("client.planipret.com");
  });

  it("never handles a bearer token or service role key", () => {
    expect(clientFiles).not.toMatch(/Bearer\s/);
    expect(clientFiles).not.toMatch(/service_role|SERVICE_ROLE|PLANIPRET_ACCESS_TOKEN|MACHINE_KEY/);
  });

  it("routes every task operation through the edge function gateway", () => {
    // Goes through the shared auth guard, which is the only edge caller.
    expect(read("src/lib/planipret/tasks.ts")).toContain('invokeEdge("planipret-task-api"');
    expect(read("src/lib/planipret/edgeAuth.ts")).toContain("supabase.functions.invoke(functionName");
  });
});
