import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCreateOrganizationBody, buildProvisionUsersBody, buildResendWelcomeBody, portalApi, resolveLemtelPortalBackend, toLemtelErrorKey } from "../lemtelHostedApi";
import { csvTemplate, parseLemtelCsv, resultsCsv } from "../lemtelCsv";
import LemtelPortalApp from "../LemtelPortalApp";
import { needsPersonalPassword } from "../lemtelAuthAuthority";
import { normalizeOperationalStatus } from "../LemtelOperationalStatus";

describe("Lemtel portal contract", () => {
  it("loads the complete Lemtel-only portal module", () => {
    expect(typeof LemtelPortalApp).toBe("function");
  });

  it("requires a personal password only from authoritative Lemtel metadata", () => {
    expect(needsPersonalPassword({ app_metadata: { lemtel_onboarding_required: true, lemtel_email_only_signin: true } })).toBe(true);
    expect(needsPersonalPassword({ app_metadata: { must_change_password: true, lemtel_email_only_signin: true } })).toBe(false);
    expect(needsPersonalPassword({ app_metadata: { lemtel_onboarding_required: true, lemtel_email_only_signin: false } })).toBe(false);
  });

  it("uses only Lemtel-namespaced public backend variables", () => {
    expect(resolveLemtelPortalBackend({
      VITE_SUPABASE_URL: "https://planipret.example.invalid",
      VITE_SUPABASE_PUBLISHABLE_KEY: "planipret-key",
    })).toEqual({ url: "", publishableKey: "" });
    expect(resolveLemtelPortalBackend({
      VITE_LEMTEL_API_URL: "https://lemtel.example.invalid/",
      VITE_LEMTEL_ANON_KEY: "lemtel-public-key",
    })).toEqual({ url: "https://lemtel.example.invalid", publishableKey: "lemtel-public-key" });
  });

  it("uses a direct Vite build flag for approved administrative writes", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/lemtel/onboarding/lemtelHostedApi.ts"), "utf8");
    expect(source).toContain("import.meta.env.VITE_LEMTEL_HOSTED_ONBOARDING");
    expect(source).toContain('hostedOnboardingApproval === "approved"');
  });

  it("keeps the admin session only in browser session storage across a reload", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/lemtel/onboarding/lemtelHostedApi.ts"), "utf8");
    expect(source).toContain("window.sessionStorage");
    expect(source).toContain('storageKey: "lemtel-portal-session"');
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("lemtel-portal-session-memory");
  });

  it("uses only the exact create-organization body accepted by the Lemtel Edge function", () => {
    expect(buildCreateOrganizationBody({ displayName: "Lemtel : Staging", slug: "lemtel-staging", defaultLocale: "fr", owner: { email: "owner@example.com", displayName: "Owner", locale: "fr" } })).toEqual({
      action: "create_organization",
      organization: { displayName: "Lemtel : Staging", slug: "lemtel-staging", defaultLocale: "fr" },
      owner: { email: "owner@example.com", displayName: "Owner", role: "owner", locale: "fr" },
      users: [],
    });
  });

  it("uses Lemtel admin/member roles and exact user provisioning keys", () => {
    expect(buildProvisionUsersBody("11111111-1111-4111-8111-111111111111", [{ email: "member@example.com", displayName: "Member", role: "member", locale: "en" }])).toEqual({
      action: "provision_users", organizationId: "11111111-1111-4111-8111-111111111111", users: [{ email: "member@example.com", displayName: "Member", role: "member", locale: "en" }],
    });
    expect(buildResendWelcomeBody("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "fr")).toEqual({
      action: "resend_welcome", organizationId: "11111111-1111-4111-8111-111111111111", recipientUserId: "22222222-2222-4222-8222-222222222222", locale: "fr",
    });
  });

  it("validates Lemtel CSV rows without deprecated Lovable roles", () => {
    const parsed = parseLemtelCsv("first_name,last_name,email,language,role\nA,B,a@example.com,fr,member\nC,,bad,de,manager\nE,F,a@example.com,,admin");
    expect(parsed.headerError).toBe(false);
    expect(parsed.rows[0].errors).toEqual([]);
    expect(parsed.rows[1].errors).toEqual(expect.arrayContaining(["missing_name", "invalid_email", "invalid_language", "invalid_role"]));
    expect(parsed.rows[2].errors).toContain("duplicate_email");
    expect(parsed.rows[2].warnings).toContain("language_inherited");
    expect(csvTemplate().split("\n")[0]).toBe("first_name,last_name,email,language,role");
  });

  it("never includes a password or token in an exported result", () => {
    expect(resultsCsv([{ email: "member@example.com", status: "sent" }])).not.toMatch(/password|token/i);
  });

  it("maps technical errors to controlled categories", () => {
    expect(toLemtelErrorKey("Edge Function returned a non-2xx status code", 500)).toBe("unavailable");
    expect(toLemtelErrorKey("first_password_change_not_required", 409)).toBe("already_personalized");
    expect(toLemtelErrorKey("TypeError: Failed to fetch")).toBe("network");
  });

  it("keeps operational status behind the authoritative portal API", () => {
    expect(typeof portalApi.getOperationalStatus).toBe("function");
  });

  it("includes only a redacted account-recovery health signal in Operations", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/lemtel/onboarding/LemtelOperationalStatus.tsx"), "utf8");
    expect(source).toContain("services.accountRecovery");
    expect(source).not.toMatch(/resend_api_key|service_role_key|temporary_password/i);
  });

  it("normalizes a partial Operations response into a safe, renderable status", () => {
    expect(normalizeOperationalStatus({ telemetry: "live" })).toEqual({
      telemetry: "live",
      overall: "unknown",
      topology: { writer: "unknown", standby: "unknown", route: "unknown", automaticFailover: false },
      services: { runtime: "unknown", database: "unknown", auth: "unknown", rest: "unknown", storage: "unknown", accountRecovery: "unknown" },
      replication: { database: "unknown", storage: "unknown" },
    });
  });

  it("uses absolute fallback routes so malformed operations URLs cannot recurse", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/lemtel/onboarding/LemtelPortalApp.tsx"), "utf8");
    expect(source).toContain('path="operations/*" element={<Navigate to={`${BASE}/operations`} replace />}');
    expect(source).toContain('Route index element={<Navigate to={`${BASE}/operations`} replace />}');
    expect(source).toContain('Route path="*" element={<Navigate to={`${BASE}/operations`} replace />}');
    expect(source).not.toContain('Route path="*" element={<Navigate to="overview" replace />}');
  });
});
