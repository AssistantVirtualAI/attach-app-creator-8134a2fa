import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hosted = vi.hoisted(() => {
  class MockLemtelError extends Error {
    constructor(public readonly key: string) {
      super(key);
    }
  }

  return {
    MockLemtelError,
    getUser: vi.fn(),
    getConfig: vi.fn(),
    listOrganizations: vi.fn(),
    listDomains: vi.fn(),
  };
});

vi.mock("../lemtelHostedApi", () => ({
  LEMTEL_BACKEND_CONFIGURED: true,
  LEMTEL_ONBOARDING_ENABLED: true,
  LemtelError: hosted.MockLemtelError,
  lemtelClient: () => ({
    auth: {
      getUser: hosted.getUser,
      signOut: vi.fn(),
    },
  }),
  portalApi: {
    getConfig: hosted.getConfig,
    listOrganizations: hosted.listOrganizations,
    listDomains: hosted.listDomains,
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import LemtelPortalApp from "../LemtelPortalApp";

const STAGING = {
  id: "organization-staging",
  displayName: "Lemtel : Staging",
  slug: "lemtel-staging",
  defaultLocale: "fr" as const,
  memberCount: 1,
  pendingInvitations: 0,
};
const PRODUCTION = {
  id: "organization-production",
  displayName: "Lemtel : Production",
  slug: "lemtel-production",
  defaultLocale: "fr" as const,
  memberCount: 1,
  pendingInvitations: 0,
};

function renderDomains() {
  return render(
    <MemoryRouter initialEntries={["/lemtel-portal/domains"]}>
      <LemtelPortalApp />
    </MemoryRouter>,
  );
}

async function organizationSelector() {
  await waitFor(() => {
    expect(document.getElementById("lemtel-organization")).not.toBeDisabled();
  });
  return document.getElementById("lemtel-organization") as HTMLSelectElement;
}

beforeEach(() => {
  window.sessionStorage.clear();
  hosted.getUser.mockReset();
  hosted.getConfig.mockReset();
  hosted.listOrganizations.mockReset();
  hosted.listDomains.mockReset();
  hosted.getUser.mockResolvedValue({ data: { user: { email: "admin@lemtel.example", app_metadata: {} } } });
  hosted.getConfig.mockResolvedValue({ downloads: {} });
  hosted.listOrganizations.mockResolvedValue({ organizations: [STAGING, PRODUCTION] });
  hosted.listDomains.mockImplementation((organizationId: string) => Promise.resolve({
    domains: organizationId === STAGING.id
      ? [{ id: "domain-staging", hostname: "staging.lemtel.example", status: "active" as const, verificationStatus: "verified" as const }]
      : [{ id: "domain-production", hostname: "production.lemtel.example", status: "active" as const, verificationStatus: "verified" as const }],
  }));
});

describe("LemtelPortalApp organization context", () => {
  it("propagates the selected server organization to Domains and replaces the previous tenant list", async () => {
    renderDomains();
    const selector = await organizationSelector();

    fireEvent.change(selector, { target: { value: STAGING.id } });
    await waitFor(() => expect(hosted.listDomains).toHaveBeenLastCalledWith(STAGING.id));
    expect(await screen.findByText("staging.lemtel.example")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("lemtel-portal-active-organization")).toBe(STAGING.id);

    fireEvent.change(selector, { target: { value: PRODUCTION.id } });
    await waitFor(() => expect(hosted.listDomains).toHaveBeenLastCalledWith(PRODUCTION.id));
    expect(await screen.findByText("production.lemtel.example")).toBeInTheDocument();
    expect(screen.queryByText("staging.lemtel.example")).not.toBeInTheDocument();
  });

  it("rejects a forged selector value to All organizations without loading an unrecognized tenant", async () => {
    renderDomains();
    const selector = await organizationSelector();

    fireEvent.change(selector, { target: { value: STAGING.id } });
    await waitFor(() => expect(hosted.listDomains).toHaveBeenLastCalledWith(STAGING.id));
    selector.append(new Option("Forged organization", "organization-forged"));
    fireEvent.change(selector, { target: { value: "organization-forged" } });

    await waitFor(() => expect(selector.value).toBe(""));
    expect(window.sessionStorage.getItem("lemtel-portal-active-organization")).toBeNull();
    expect(hosted.listDomains).not.toHaveBeenLastCalledWith("organization-forged");
    expect(screen.getByText("Select an organization to manage its domains.")).toBeInTheDocument();
  });

  it("clears a stored organization that is absent from the authoritative server list and makes no tenant request", async () => {
    window.sessionStorage.setItem("lemtel-portal-active-organization", "organization-retired");
    renderDomains();

    await organizationSelector();
    await waitFor(() => expect(window.sessionStorage.getItem("lemtel-portal-active-organization")).toBeNull());
    expect(hosted.listDomains).not.toHaveBeenCalled();
    expect(screen.getByText("Select an organization to manage its domains.")).toBeInTheDocument();
  });

  it("does not expose a persisted tenant scope before that organization has been recognized by the server", async () => {
    let resolveOrganizations: ((value: { organizations: typeof STAGING[] }) => void) | undefined;
    hosted.listOrganizations.mockReturnValueOnce(new Promise((resolve) => { resolveOrganizations = resolve; }));
    window.sessionStorage.setItem("lemtel-portal-active-organization", STAGING.id);

    renderDomains();
    await waitFor(() => expect(hosted.listOrganizations).toHaveBeenCalledOnce());
    expect(hosted.listDomains).not.toHaveBeenCalled();

    resolveOrganizations?.({ organizations: [STAGING] });
    await waitFor(() => expect(hosted.listDomains).toHaveBeenLastCalledWith(STAGING.id));
  });

  it("shows an explicit recoverable Domains error instead of treating a failed tenant request as an empty list", async () => {
    hosted.listDomains.mockRejectedValueOnce(new hosted.MockLemtelError("unavailable"));
    renderDomains();
    const selector = await organizationSelector();

    fireEvent.change(selector, { target: { value: STAGING.id } });
    expect(await screen.findByRole("alert")).toHaveTextContent("This organization’s domains are temporarily unavailable.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
