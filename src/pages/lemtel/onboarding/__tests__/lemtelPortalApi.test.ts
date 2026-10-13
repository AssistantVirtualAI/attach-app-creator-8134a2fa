import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const dir = join(__dirname, "..");
const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f));
const src = (f: string) => readFileSync(join(dir, f), "utf8");

describe("Lemtel portal API boundary", () => {
  it("portal screens call the backend only through portalApi", () => {
    for (const f of ["LemtelPortalApp.tsx", "LemtelOnboardingDialogs.tsx"]) {
      expect(src(f)).not.toMatch(/\bonboarding[<(]/);
      expect(src(f)).toMatch(/portalApi\./);
    }
  });
  it("no public sign-up, no direct table access, no password persistence", () => {
    for (const f of files) {
      const s = src(f);
      expect(s).not.toMatch(/signUp|auth\/v1\/signup/);
      expect(s).not.toMatch(/\.from\(["']/);
      expect(s).not.toMatch(/localStorage|sessionStorage/);
    }
  });
  it("writes are blocked when onboarding is not enabled", async () => {
    const { portalApi, LemtelError } = await import("../lemtelHostedApi");
    await expect(portalApi.createOrganization({})).rejects.toBeInstanceOf(LemtelError);
    await expect(portalApi.revokeAccess("x")).rejects.toMatchObject({ key: "readonly" });
    expect(portalApi.getOperationalStatus().telephony.status).toBe("not_provisioned");
  });
});
