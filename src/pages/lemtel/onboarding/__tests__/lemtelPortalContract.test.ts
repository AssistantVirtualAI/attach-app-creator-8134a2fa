import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAssignExistingUserBody, buildCreateOrganizationBody, buildProvisionUsersBody, buildResendWelcomeBody, buildSetMembershipRoleBody, portalApi, resolveLemtelPortalBackend, toLemtelErrorKey } from "../lemtelHostedApi";
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

  it("uses exact organization-scoped bodies for existing-account assignment and role changes", () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const recipientUserId = "22222222-2222-4222-8222-222222222222";
    expect(buildAssignExistingUserBody(organizationId, { email: " Existing@Example.com ", role: "member" })).toEqual({
      action: "assign_existing_user", organizationId, user: { email: "existing@example.com", role: "member" },
    });
    expect(buildSetMembershipRoleBody(organizationId, recipientUserId, "admin")).toEqual({
      action: "set_membership_role", organizationId, recipientUserId, role: "admin",
    });
    expect(typeof portalApi.assignExistingUser).toBe("function");
    expect(typeof portalApi.setMembershipRole).toBe("function");
  });

  it("keeps user-domain access derived from organization membership", () => {
    const governance = readFileSync(resolve(process.cwd(), "docs/lemtel-portal/TENANT_MEMBERSHIP_GOVERNANCE.md"), "utf8");
    const memberControl = readFileSync(resolve(process.cwd(), "src/pages/lemtel/onboarding/LemtelMembershipControls.tsx"), "utf8");
    expect(governance).toContain("membership actif");
    expect(governance).toContain("Il n’existe pas de liaison directe utilisateur–domaine");
    expect(memberControl).toContain("t.membership.assignNotice");
    expect(memberControl).not.toMatch(/fusionpbx|sip:|turn:|wss:/i);
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
    expect(source).toContain('path={`${BASE}/operations/*`} element={<Navigate to={`${BASE}/operations`} replace />}');
    expect(source).toContain('Route path={BASE} element={<Navigate to={`${BASE}/operations`} replace />}');
    expect(source).toContain('Route path={`${BASE}/*`} element={<Navigate to={`${BASE}/operations`} replace />}');
    expect(source).toContain('Route path={`${BASE}/overview`} element={<Overview {...context} />}');
    expect(source).not.toContain('Route path="*" element={<Navigate to="overview" replace />}');
  });

  it("renders independent, server-configured download channels for Windows, macOS, iOS and Android", () => {
    const client = readFileSync(resolve(process.cwd(), "src/pages/lemtel/onboarding/lemtelHostedApi.ts"), "utf8");
    const app = readFileSync(resolve(process.cwd(), "src/pages/lemtel/onboarding/LemtelPortalApp.tsx"), "utf8");
    const server = readFileSync(resolve(process.cwd(), "infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.ts"), "utf8");
    expect(client).toContain('windows?: string; macosApple?: string; macosIntel?: string');
    expect(app).toContain('key: "windows"');
    expect(app).toContain('key: "macosApple"');
    expect(app).toContain('key: "macosIntel"');
    expect(app).toContain('key: "ios"');
    expect(app).toContain('key: "android"');
    expect(server).toContain('function distributionUrls()');
    expect(server).toContain('LEMTEL_DOWNLOAD_WINDOWS_URL');
    expect(server).toContain('LEMTEL_DOWNLOAD_MACOS_APPLE_URL');
    expect(server).toContain('LEMTEL_DOWNLOAD_MACOS_INTEL_URL');
    expect(server).toContain('https://testflight.apple.com');
    expect(client).not.toMatch(/resend_api_key|service_role_key/i);
  });

  it("uses the canonical Lemtel mark and the AVA attribution in the portal chrome", () => {
    const app = readFileSync(resolve(process.cwd(), "src/pages/lemtel/onboarding/LemtelPortalApp.tsx"), "utf8");
    const ui = readFileSync(resolve(process.cwd(), "src/pages/lemtel/onboarding/LemtelUi.tsx"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "src/pages/lemtel/onboarding/lemtel-portal.css"), "utf8");
    expect(ui).toContain('import lemtelIcon from "./assets/lemtel-icon.png"');
    expect(app).toContain('href="https://assistantvirtualai.com"');
    expect(app).toContain("Powered by AVA");
    expect(app).toContain("lt-sidebar");
    expect(css).toContain("Brand refresh");
  });
});
