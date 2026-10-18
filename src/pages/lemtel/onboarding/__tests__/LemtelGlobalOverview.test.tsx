import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getPlatformOverview: vi.fn() }));
vi.mock("../lemtelHostedApi", () => ({ portalApi: api, LemtelError: class extends Error { key = "unavailable"; } }));

import LemtelGlobalOverview from "../LemtelGlobalOverview";
import { LEMTEL_DICT } from "../lemtelI18n";

const overview = {
  schemaVersion: "lemtel-platform-overview/v3" as const,
  observation: "observed" as const,
  aggregates: { activeOrganizations: 2, activeDomains: 4, activeUsers: 3, platformAdministrators: 1 },
  clientPresence: {
    observation: "observed" as const,
    observedConnections: { total: 4, desktop: 2, mobile: 1, portal: 1, client: 0 },
    accessControls: { explicitlyRevoked: 1 },
  },
  telephony: {
    provisioning: "not_provisioned" as const,
    metrics: { cdr: "unavailable" as const, activeCalls: "unavailable" as const, extensions: "unavailable" as const, trunks: "unavailable" as const, voicemail: "unavailable" as const },
  },
};

beforeEach(() => api.getPlatformOverview.mockReset().mockResolvedValue(overview));
afterEach(() => cleanup());

describe("Lemtel business overview", () => {
  it("renders only authoritative business aggregates, an instant distribution and unprovisioned telephony", async () => {
    render(<LemtelGlobalOverview t={LEMTEL_DICT.fr} lang="fr" readonly={false} />);
    expect(await screen.findByRole("heading", { name: "Aperçu global" })).toBeInTheDocument();
    expect(screen.getAllByText("Domaines actifs")).toHaveLength(2);
    expect(screen.getAllByText("Utilisateurs actifs")).toHaveLength(2);
    expect(screen.getAllByText("Connexions observées")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Répartition instantanée des indicateurs Lemtel autoritaires" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Système téléphonique" })).toBeInTheDocument();
    expect(screen.getByText("CDR / appels")).toBeInTheDocument();
    expect(screen.getByText("Trunks")).toBeInTheDocument();
    expect(screen.getAllByText("Non provisionné")).toHaveLength(6);
    expect(screen.getAllByText("Aucune observation")).toHaveLength(5);
    expect(screen.queryByText("Santé des services")).toBeNull();
    expect(screen.queryByText("Trafic serveur")).toBeNull();
    expect(screen.queryByText(/0 octet/)).toBeNull();
    expect(api.getPlatformOverview).toHaveBeenCalledTimes(1);
  });

  it("renders English labels for observed applications and telephone preparation", async () => {
    render(<LemtelGlobalOverview t={LEMTEL_DICT.en} lang="en" readonly={false} />);
    expect(await screen.findByRole("heading", { name: "Global overview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Applications and access" })).toBeInTheDocument();
    expect(screen.getAllByText("Observed connections")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Telephone system" })).toBeInTheDocument();
    expect(screen.getByText("Call records (CDR)")).toBeInTheDocument();
    expect(screen.getAllByText("Not provisioned")).toHaveLength(6);
    expect(screen.queryByText("Server traffic")).toBeNull();
  });

  it("fails closed for malformed connection totals and untrusted telephony fields", async () => {
    api.getPlatformOverview.mockResolvedValueOnce({
      schemaVersion: "lemtel-platform-overview/v3",
      observation: "observed",
      aggregates: { activeOrganizations: "3", activeDomains: -1, activeUsers: 4.5, platformAdministrators: -2 },
      clientPresence: { observation: "observed", observedConnections: { total: 9, desktop: 1, mobile: 1, portal: 1, client: 1 }, accessControls: { explicitlyRevoked: 1 } },
      telephony: { provisioning: "provisioned", metrics: { cdr: 9000 } },
      operational: { topology: { automaticFailover: true } },
      traffic: { observation: "observed" },
    });
    render(<LemtelGlobalOverview t={LEMTEL_DICT.fr} lang="fr" readonly={false} />);
    expect(await screen.findByText("Aucun agrégat autoritaire n’est disponible pour la comparaison.")).toBeInTheDocument();
    expect(screen.getAllByText("Aucune observation")).toHaveLength(6);
    expect(screen.getAllByText("Non provisionné")).toHaveLength(6);
    expect(screen.queryByText("99")).toBeNull();
    expect(screen.queryByText("9000")).toBeNull();
    expect(screen.queryByText("automaticFailover")).toBeNull();
  });
});
