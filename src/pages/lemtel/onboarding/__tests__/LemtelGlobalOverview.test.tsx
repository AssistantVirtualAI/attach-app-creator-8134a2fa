import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getPlatformOverview: vi.fn() }));
vi.mock("../lemtelHostedApi", () => ({ portalApi: api, LemtelError: class extends Error { key = "unavailable"; } }));

import LemtelGlobalOverview, { normalizePlatformOverview } from "../LemtelGlobalOverview";
import { LEMTEL_DICT } from "../lemtelI18n";

const overview = {
  schemaVersion: "lemtel-platform-overview/v2" as const,
  observation: "observed" as const,
  aggregates: { activeOrganizations: 0, activeDomains: 0, activeUsers: 0, platformAdministrators: 1 },
  telephony: {
    provisioning: "not_provisioned" as const,
    metrics: {
      totalCalls: "unavailable" as const, incomingCalls: "unavailable" as const, outgoingCalls: "unavailable" as const,
      missedCalls: "unavailable" as const, activeCalls: "unavailable" as const, voicemail: "unavailable" as const,
    },
  },
};

beforeEach(() => api.getPlatformOverview.mockReset().mockResolvedValue(overview));
afterEach(() => cleanup());

describe("Lemtel business overview", () => {
  it("renders organization aggregates and unprovisioned telephony without server or traffic data", async () => {
    render(<LemtelGlobalOverview t={LEMTEL_DICT.fr} lang="fr" readonly={false} />);
    expect(await screen.findByRole("heading", { name: "Aperçu global" })).toBeInTheDocument();
    expect(screen.getByText("Domaines actifs")).toBeInTheDocument();
    expect(screen.getByText("Utilisateurs actifs")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Système téléphonique" })).toBeInTheDocument();
    expect(screen.getByText("Non provisionné")).toBeInTheDocument();
    expect(screen.getByText("Appels entrants")).toBeInTheDocument();
    expect(screen.getAllByText("Aucune donnée")).toHaveLength(6);
    expect(screen.queryByText("Santé des services")).toBeNull();
    expect(screen.queryByText("Trafic serveur")).toBeNull();
    expect(screen.queryByText(/0 octet/)).toBeNull();
    expect(api.getPlatformOverview).toHaveBeenCalledTimes(1);
  });

  it("renders the English business labels", async () => {
    render(<LemtelGlobalOverview t={LEMTEL_DICT.en} lang="en" readonly={false} />);
    expect(await screen.findByRole("heading", { name: "Global overview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Telephone system" })).toBeInTheDocument();
    expect(screen.getByText("Incoming calls")).toBeInTheDocument();
    expect(screen.getByText("Not provisioned")).toBeInTheDocument();
    expect(screen.queryByText("Server traffic")).toBeNull();
  });

  it("normalizes malformed counters and discards untrusted telephony metrics", () => {
    const normalized = normalizePlatformOverview({
      aggregates: { activeOrganizations: "3", activeDomains: -1, activeUsers: 4.5, platformAdministrators: 2 },
      telephony: { provisioning: "provisioned", metrics: { totalCalls: 9000 } },
      operational: { topology: { automaticFailover: true } },
      traffic: { observation: "observed" },
    });
    expect(normalized.aggregates.activeOrganizations).toBeUndefined();
    expect(normalized.aggregates.activeDomains).toBeUndefined();
    expect(normalized.aggregates.activeUsers).toBeUndefined();
    expect(normalized.aggregates.platformAdministrators).toBe(2);
    expect(normalized.telephony.provisioning).toBe("not_provisioned");
    expect(normalized.telephony.metrics.totalCalls).toBe("unavailable");
    expect("operational" in normalized).toBe(false);
    expect("traffic" in normalized).toBe(false);
  });
});
