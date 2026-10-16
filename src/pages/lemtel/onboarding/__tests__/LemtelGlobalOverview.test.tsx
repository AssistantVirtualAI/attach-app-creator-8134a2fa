import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getPlatformOverview: vi.fn() }));
vi.mock("../lemtelHostedApi", () => ({ portalApi: api, LemtelError: class extends Error { key = "unavailable"; } }));

import LemtelGlobalOverview, { normalizePlatformOverview } from "../LemtelGlobalOverview";
import { LEMTEL_DICT } from "../lemtelI18n";

const noObservation = {
  schemaVersion: "lemtel-platform-overview/v1" as const,
  observation: "no_observation" as const,
  aggregates: { activeOrganizations: 0, activeMemberships: 0, platformAdministrators: 1 },
  operational: { telemetry: "not_configured" as const, overall: "unknown" as const, topology: { writer: "unknown" as const, standby: "unknown" as const, route: "unknown" as const, automaticFailover: true }, services: { runtime: "unknown" as const, database: "unknown" as const, auth: "unknown" as const, rest: "unknown" as const, storage: "unknown" as const, accountRecovery: "unknown" as const }, replication: { database: "unknown" as const, storage: "unknown" as const } },
  standby: { schemaVersion: "lemtel-node-status/v1" as const, observation: "no_observation" as const, roles: [] },
  traffic: { observation: "no_observation" as const, trend: { windowStart: "2026-10-14T12:00:00Z", windowEnd: "2026-10-15T12:00:00Z", bucketSeconds: 300, roles: [{ nodeRole: "do_writer" as const, collectorState: "pending" as const, samples: [] }, { nodeRole: "hostinger_standby" as const, collectorState: "pending" as const, samples: [] }] } },
  clientAccess: [{ client: "desktop" as const, state: "pending" as const }, { client: "ios" as const, state: "pending" as const }, { client: "android" as const, state: "pending" as const }],
};

beforeEach(() => api.getPlatformOverview.mockReset().mockResolvedValue(noObservation));
afterEach(() => cleanup());

describe("Lemtel global administrator overview", () => {
  it("renders missing observations as unknown/pending and never trusts automatic failover", async () => {
    render(<LemtelGlobalOverview t={LEMTEL_DICT.fr} lang="fr" readonly={false} />);
    expect(await screen.findByText("Observations en attente")).toBeInTheDocument();
    expect(screen.getAllByText("Désactivée — gates non attestés")).toHaveLength(2);
    expect(screen.getAllByText("Canal en attente")).toHaveLength(3);
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.queryByText(/0 octet/)).toBeNull();
    expect(api.getPlatformOverview).toHaveBeenCalledTimes(1);
  });

  it("renders only server-configured HTTPS distribution channels and English copy", async () => {
    api.getPlatformOverview.mockResolvedValueOnce({ ...noObservation, clientAccess: [{ client: "desktop", state: "configured", url: "https://downloads.example.test/lemtel" }, { client: "ios", state: "pending" }, { client: "android", state: "pending" }] });
    render(<LemtelGlobalOverview t={LEMTEL_DICT.en} lang="en" readonly={false} />);
    expect(await screen.findByRole("heading", { name: "Global overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Configured channel/ })).toHaveAttribute("href", "https://downloads.example.test/lemtel");
    expect(screen.getAllByText("Channel pending")).toHaveLength(2);
  });

  it("normalizes malformed responses to unknown states and absent counters instead of invented values", () => {
    const normalized = normalizePlatformOverview({ aggregates: { activeOrganizations: "3" }, operational: { topology: { automaticFailover: true } }, standby: { observation: "observed", roles: [{ nodeRole: "do_writer", runtimeState: "ready" }] } });
    expect(normalized.aggregates.activeOrganizations).toBeUndefined();
    expect(normalized.aggregates.activeMemberships).toBeUndefined();
    expect(normalized.operational.topology.automaticFailover).toBe(false);
    expect(normalized.standby.roles[0]).toMatchObject({ nodeRole: "do_writer", runtimeState: "ready", agentState: "unknown" });
  });
});
