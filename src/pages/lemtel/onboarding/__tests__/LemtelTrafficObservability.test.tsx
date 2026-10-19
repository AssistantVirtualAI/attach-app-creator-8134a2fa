import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LemtelTrafficTrend } from "../lemtelHostedApi";
const api = vi.hoisted(() => ({ getTrafficTrend: vi.fn(), getOperationalStatus: vi.fn(), getOperationalTrend: vi.fn(), getNodeStatus: vi.fn(), getDoWriterResources: vi.fn(), getHostingerStandbyResources: vi.fn() }));
vi.mock("../lemtelHostedApi", () => ({ portalApi: api, LemtelError: class extends Error { key = "unavailable"; } }));
import LemtelOperationalStatus, { TRAFFIC_READ_DEADLINE_MS } from "../LemtelOperationalStatus";
import LemtelTrafficPanel from "../LemtelTrafficPanel";
import { LEMTEL_DICT } from "../lemtelI18n";

const sample = { observedAt: "2026-10-15T11:00:00Z", periodSeconds: 60, rxBytes: 2048, txBytes: 4096, tcpEstablished: 7 };
const empty: LemtelTrafficTrend = { windowStart: "2026-10-14T12:00:00Z", windowEnd: "2026-10-15T12:00:00Z", bucketSeconds: 300,
  roles: [{ nodeRole: "do_writer", collectorState: "pending", samples: [] }, { nodeRole: "hostinger_standby", collectorState: "pending", samples: [] }] };
const measured: LemtelTrafficTrend = { ...empty, roles: [{ nodeRole: "do_writer", collectorState: "collecting", latest: sample,
  samples: [sample, { ...sample, observedAt: "2026-10-15T11:05:00Z", rxBytes: 0 }, { ...sample, observedAt: "2026-10-15T11:20:00Z" }] }, empty.roles[1]] };
function operations(readonly = false) { return render(<LemtelOperationalStatus t={LEMTEL_DICT.fr} lang="fr" config={{ downloads: {} }} readonly={readonly} />); }
beforeEach(() => {
  api.getTrafficTrend.mockReset().mockResolvedValue(empty);
  api.getOperationalStatus.mockReset().mockResolvedValue({ telemetry: "not_configured" });
  api.getOperationalTrend.mockReset().mockResolvedValue({ samples: [] });
  api.getNodeStatus.mockReset().mockResolvedValue({ telemetry: "not_configured", roles: [] });
  api.getDoWriterResources.mockReset().mockResolvedValue({ schemaVersion: "lemtel-do-writer-resources/v1", observation: "no_observation" });
  api.getHostingerStandbyResources.mockReset().mockResolvedValue({ schemaVersion: "lemtel-hostinger-standby-resources/v1", trust: "signed_publication_not_enrolled", observation: "no_observation" });
});
afterEach(() => cleanup());

describe("Lemtel private traffic observability", () => {
  it("uses the exact empty message, two pending cards and no fictional counters/charts", async () => {
    operations();
    expect(await screen.findByText("Aucun collecteur de trafic n’est encore provisionné : aucun chiffre n’est inventé.")).toBeInTheDocument();
    expect(api.getTrafficTrend).toHaveBeenCalledTimes(1);
    const section = screen.getByRole("region", { name: "Trafic serveur" });
    expect(within(section).getAllByRole("article")).toHaveLength(2);
    expect(within(section).getAllByText("Collecte en attente")).toHaveLength(1);
    expect(within(section).getByText("Enrôlement sécurisé requis")).toBeInTheDocument();
    expect(section.querySelector("svg[role='img']")).toBeNull();
    expect(within(section).queryByText(/0 octet/)).toBeNull();
    expect(within(section).getAllByText("—")).toHaveLength(6);
  });
  it("shows observed RX/TX, aggregate TCP, accessible SVGs and gaps without interpolation", () => {
    const { container } = render(<LemtelTrafficPanel t={LEMTEL_DICT.fr} lang="fr" trend={measured} loading={false} unavailable={false} />);
    expect(screen.getByText("2 KiB")).toBeInTheDocument(); expect(screen.getAllByText("4 KiB").length).toBeGreaterThan(0);
    expect(screen.getByText("7")).toBeInTheDocument(); expect(screen.getByText("Collecte active")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /DigitalOcean.*Volumes reçus/ })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-series="rxBytes"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-series="txBytes"]')).toHaveLength(2);
    expect(container.querySelectorAll('path[stroke-dasharray="5 4"]')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/secret|userId|deviceId|http|SNI/);
    expect(screen.queryByText(LEMTEL_DICT.fr.operations.traffic.empty)).toBeNull();
  });
  it("renders real zeros but not a fictional chart from one sample, with EN translations", () => {
    const zero = { ...sample, rxBytes: 0, txBytes: 0, tcpEstablished: 0 };
    render(<LemtelTrafficPanel t={LEMTEL_DICT.en} lang="en" trend={{ ...empty, roles: [{ ...measured.roles[0], latest: zero, samples: [zero] }, empty.roles[1]] }} loading={false} unavailable={false} />);
    expect(screen.getByRole("region", { name: "Server traffic" })).toBeInTheDocument();
    expect(screen.getAllByText("0 bytes")).toHaveLength(2);
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("does not mistake an API failure for an unprovisioned collector or preserve stale totals", async () => {
    api.getTrafficTrend.mockResolvedValueOnce(measured).mockRejectedValueOnce(new Error("hidden"));
    operations(); await screen.findByText("2 KiB");
    await waitFor(() => expect(screen.getByRole("button", { name: "Actualiser" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));
    await screen.findByText(LEMTEL_DICT.fr.operations.traffic.unavailable);
    expect(screen.queryByText("2 KiB")).toBeNull(); expect(screen.queryByText(LEMTEL_DICT.fr.operations.traffic.empty)).toBeNull();
  });
  it("ends a stalled traffic read at the bounded deadline without blocking Operations", async () => {
    vi.useFakeTimers();
    api.getTrafficTrend.mockImplementation(() => new Promise(() => undefined));
    try {
      operations();
      await act(async () => { await vi.advanceTimersByTimeAsync(TRAFFIC_READ_DEADLINE_MS); });
      expect(screen.getByText(LEMTEL_DICT.fr.operations.traffic.unavailable)).toBeInTheDocument();
      expect(api.getOperationalStatus).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("loads traffic even when health telemetry is unavailable, and readonly never calls the API", async () => {
    api.getOperationalStatus.mockRejectedValue(new Error("hidden")); api.getTrafficTrend.mockResolvedValue(measured);
    const view = operations(); await screen.findByText("2 KiB"); view.unmount(); api.getTrafficTrend.mockClear();
    operations(true); await screen.findByText(LEMTEL_DICT.fr.operations.traffic.unavailable);
    expect(api.getTrafficTrend).not.toHaveBeenCalled();
  });
  it("shows DO node signals only when fresh and refuses to infer Hostinger resources or traffic", async () => {
    api.getDoWriterResources.mockResolvedValue({ schemaVersion: "lemtel-do-writer-resources/v1", observation: "observed", observedAt: new Date().toISOString(), resources: { cpuPercent: 41, memoryPercent: 62, diskPercent: 37, load1Milli: 125, load5Milli: 118, load15Milli: 104 } });
    api.getNodeStatus.mockResolvedValue({ telemetry: "live", roles: [{ nodeRole: "do_writer", observedAt: new Date().toISOString(), agentState: "healthy", runtimeState: "ready", replicationState: "streaming", storageState: "synced" }, { nodeRole: "hostinger_standby", observedAt: new Date().toISOString(), agentState: "healthy", runtimeState: "ready", replicationState: "streaming", storageState: "synced" }] });
    api.getTrafficTrend.mockResolvedValue({ ...measured, roles: [measured.roles[0], { nodeRole: "hostinger_standby", collectorState: "collecting", latest: sample, samples: [sample, { ...sample, observedAt: "2026-10-15T11:05:00Z" }] }] });
    operations();
    const resources = await screen.findByRole("region", { name: "Ressources des nœuds" });
    expect(within(resources).getAllByText("Observation attestée").length).toBeGreaterThan(0);
    expect(within(resources).getByText("Hostinger — statut inconnu")).toBeInTheDocument();
    expect(within(resources).getAllByText(/resteront inconnus jusqu’à l’enrôlement sécurisé/i)).toHaveLength(2);
    // Hostinger traffic is accepted server-side only with its role-bound secret: shown, but labelled as not enrolled.
    const traffic = screen.getByRole("region", { name: "Trafic serveur" });
    expect(within(traffic).getByText("Publication signée — non enrôlée")).toBeInTheDocument();
    expect(api.getNodeStatus).toHaveBeenCalledTimes(1);
  });
  });
  it("labels DO resources as observed without the misleading node-status notice", async () => {
    api.getDoWriterResources.mockResolvedValue({ schemaVersion: "lemtel-do-writer-resources/v1", observation: "observed", observedAt: new Date().toISOString(), resources: { cpuPercent: 44, memoryPercent: 43, diskPercent: 15, load1Milli: 1569, load5Milli: 868, load15Milli: 774 } });
    operations();
    const resources = await screen.findByRole("region", { name: "Ressources des nœuds" });
    const doCard = await waitFor(() => { const card = resources.querySelector('[data-node-role="do_writer"]') as HTMLElement; expect(within(card).getByText("44 %")).toBeInTheDocument(); return card; });
    expect(within(doCard).getByText("Observation attestée", { selector: ".lt-chip" })).toBeInTheDocument();
    expect(within(doCard).getByText(/^Ressources observées · /)).toBeInTheDocument();
    expect(within(doCard).queryByText(/Aucun relevé de nœud autoritaire/)).toBeNull();
    expect(within(doCard).getByText(/Statut du nœud \(publieur, runtime, réplication, stockage\) : non configuré/)).toBeInTheDocument();
  });
  it("shows signed Hostinger resources only with the not-enrolled trust label", async () => {
    api.getHostingerStandbyResources.mockResolvedValue({ schemaVersion: "lemtel-hostinger-standby-resources/v1", trust: "signed_publication_not_enrolled", observation: "observed", observedAt: new Date().toISOString(), resources: { cpuPercent: 9, memoryPercent: 51, diskPercent: 22, load1Milli: 40, load5Milli: 30, load15Milli: 20 } });
    operations();
    const resources = await screen.findByRole("region", { name: "Ressources des nœuds" });
    const card = await waitFor(() => { const element = resources.querySelector('[data-node-role="hostinger_standby"]') as HTMLElement; expect(within(element).getByText("9 %")).toBeInTheDocument(); return element; });
    expect(within(card).getByText("Hostinger — standby")).toBeInTheDocument();
    expect(within(card).getByText("Publication signée — non enrôlée")).toBeInTheDocument();
    expect(within(card).getAllByText("Observation signée")).toHaveLength(4);
    expect(within(card).queryByText("Observation attestée")).toBeNull();
  });
  it("refuses Hostinger resources that do not carry the signed-not-enrolled trust label", async () => {
    api.getHostingerStandbyResources.mockResolvedValue({ schemaVersion: "lemtel-hostinger-standby-resources/v1", observation: "observed", observedAt: new Date().toISOString(), resources: { cpuPercent: 9, memoryPercent: 51, diskPercent: 22, load1Milli: 40, load5Milli: 30, load15Milli: 20 } });
    operations();
    const resources = await screen.findByRole("region", { name: "Ressources des nœuds" });
    await waitFor(() => expect(api.getHostingerStandbyResources).toHaveBeenCalled());
    const card = resources.querySelector('[data-node-role="hostinger_standby"]') as HTMLElement;
    expect(within(card).queryByText("9 %")).toBeNull();
    expect(within(card).getByText("Hostinger — statut inconnu")).toBeInTheDocument();
});
