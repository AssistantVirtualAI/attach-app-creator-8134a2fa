import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const g = vi.hoisted(() => ({
  api: {
    capabilities: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), testManagement: vi.fn(), setWrites: vi.fn(),
    voicemailMessages: vi.fn(), resetVoicemail: vi.fn(), deleteVoicemailMessage: vi.fn(), gatewaysStatus: vi.fn(), gatewayControl: vi.fn(),
    liveCalls: vi.fn(), registrations: vi.fn(), hangup: vi.fn(), transfer: vi.fn(), eavesdrop: vi.fn(),
    cdr: vi.fn(), cdrStats: vi.fn(), cdrCsv: vi.fn(), syncCdr: vi.fn(), recording: vi.fn(),
    me: vi.fn(), updateForwarding: vi.fn(), setMyVoicemailPin: vi.fn(), deleteMyVoicemail: vi.fn(), clickToCall: vi.fn(),
  },
}));
vi.mock("../lemtelPbxGatewayApi", () => ({
  pbxGateway: g.api,
  PbxGatewayError: class PbxGatewayError extends Error { constructor(public code: string, public status: number) { super(code); } },
}));
vi.mock("../lemtelPbxApi", () => ({ pbxApi: { get: vi.fn(async () => ({ members: [{ userId: "u1", email: "ana@x.tel", name: "Ana", role: "member" }], assignments: [{ userId: "u1", extension: "1001" }] })) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import LemtelPbxWorkspace from "../LemtelPbxWorkspace";
import LemtelMySpace from "../LemtelMySpace";
import { LemtelPbxLiveCalls } from "../LemtelPbxLive";
import { LemtelPbxCallHistory } from "../LemtelPbxCdr";

const ORG = "11111111-1111-4111-8111-111111111111";
const extensions = { key: "extensions", scope: "domain", label: "extension", uuid: "extension_uuid", ops: ["list", "get", "create", "update", "delete"], parent: null, required: ["extension"],
  read: ["extension_uuid", "extension", "effective_caller_id_name", "enabled"], write: { extension: { t: "str", max: 8 }, effective_caller_id_name: { t: "str", max: 64 }, enabled: { t: "bool" }, password: { t: "secret" } } };
const caps = (over: Record<string, unknown> = {}) => ({ role: "admin", configured: true, managementMode: "fusionpbx_api", managementReady: true, verifiedAt: "2026-10-19T00:00:00Z", domainName: "acme.lemtel.tel",
  writesEnabled: true, connectionState: "active", selfExtension: "1002", cdrSync: null, catalog: [extensions], ...over });

beforeEach(() => { Object.values(g.api).forEach((f) => f.mockReset()); vi.stubGlobal("confirm", vi.fn(() => true)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("telephony workspace", () => {
  it("explains what to enter when the FusionPBX management connection is not configured", async () => {
    g.api.capabilities.mockResolvedValue(caps({ managementReady: false, catalog: [] }));
    render(<LemtelPbxWorkspace lang="fr" organizationId={ORG} section="inventory" readonly={false} />);
    expect(await screen.findByText("Connexion FusionPBX requise.")).toBeTruthy();
    expect(g.api.list).not.toHaveBeenCalled();
  });

  it("lists the domain's extensions and saves only the changed fields; a secret left empty is not sent", async () => {
    g.api.capabilities.mockResolvedValue(caps());
    g.api.list.mockResolvedValue({ items: [{ extension_uuid: "e1", extension: "1001", effective_caller_id_name: "Ana", enabled: "true", password_set: true }] });
    g.api.update.mockResolvedValue({ ok: true });
    render(<LemtelPbxWorkspace lang="en" organizationId={ORG} section="inventory" readonly={false} />);
    const row = (await screen.findByText("1001")).closest("tr")!;
    expect(within(row).getByText("Ana")).toBeTruthy();
    fireEvent.click(within(row).getByLabelText("Edit"));
    await waitFor(() => expect((screen.getByLabelText("Lemtel user (Mobile / Desktop apps)") as HTMLSelectElement).value).toBe("u1"));
    fireEvent.change(screen.getByLabelText("Caller ID name (internal)"), { target: { value: "Ana Roy" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(g.api.update).toHaveBeenCalledWith(ORG, "extensions", "e1", { effective_caller_id_name: "Ana Roy" }, undefined));
  });

  it("keeps every change button disabled while writes are not authorized", async () => {
    g.api.capabilities.mockResolvedValue(caps({ writesEnabled: false }));
    g.api.list.mockResolvedValue({ items: [{ extension_uuid: "e1", extension: "1001" }] });
    render(<LemtelPbxWorkspace lang="en" organizationId={ORG} section="inventory" readonly={false} />);
    await screen.findByText("1001");
    expect((screen.getByRole("button", { name: /Add/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Delete") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/changes are disabled until the platform records/).length).toBeGreaterThan(0);
  });
});

describe("live calls, history, my space", () => {
  it("hangs up a live call after confirmation", async () => {
    g.api.liveCalls.mockResolvedValue({ calls: [{ uuid: "c1", direction: "inbound", createdAt: null, callerName: "", callerNumber: "5145550000", destination: "1001", state: "ACTIVE", application: "", presence: "", secure: true }] });
    g.api.hangup.mockResolvedValue({ ok: true });
    render(<LemtelPbxLiveCalls lang="en" organizationId={ORG} canAct />);
    fireEvent.click(await screen.findByRole("button", { name: /Hang up/ }));
    await waitFor(() => expect(g.api.hangup).toHaveBeenCalledWith(ORG, "c1"));
  });

  it("plays a recording through the gateway (no direct PBX URL in the page)", async () => {
    g.api.cdr.mockResolvedValue({ total: 1, records: [{ id: "r1", direction: "inbound", callerName: null, callerNumber: "5145550000", destination: "1001", startAt: "2026-10-19T14:00:00Z", answerAt: null, endAt: null, duration: 70, billsec: 60, hangupCause: "NORMAL_CLEARING", missed: false, hasRecording: true }] });
    g.api.recording.mockResolvedValue(new Blob([new Uint8Array([1, 2])], { type: "audio/mpeg" }));
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    render(<LemtelPbxCallHistory lang="en" organizationId={ORG} />);
    fireEvent.click(await screen.findByRole("button", { name: /Play/ }));
    await waitFor(() => expect(g.api.recording).toHaveBeenCalledWith(ORG, "r1"));
    expect(await screen.findByLabelText("Recording playback")).toBeTruthy();
  });

  it("my space: forwarding saved with only forwarding fields", async () => {
    g.api.me.mockResolvedValue({ extension: "1001", callerIdName: "Ana", writesEnabled: true, recentCalls: [], voicemail: { enabled: true, messages: [] },
      forwarding: { forward_all_enabled: "false", forward_all_destination: "", forward_busy_enabled: "false", forward_busy_destination: "", forward_no_answer_enabled: "false", forward_no_answer_destination: "", forward_user_not_registered_enabled: "false", forward_user_not_registered_destination: "", do_not_disturb: "false" } });
    g.api.cdr.mockResolvedValue({ total: 0, records: [] });
    g.api.updateForwarding.mockResolvedValue({ ok: true });
    render(<LemtelMySpace lang="en" organizationId={ORG} readonly={false} />);
    fireEvent.click(await screen.findByLabelText("Forward all calls"));
    fireEvent.change(screen.getByLabelText("Destination (all)"), { target: { value: "514-555-1234" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() => expect(g.api.updateForwarding).toHaveBeenCalled());
    const values = g.api.updateForwarding.mock.calls[0][1];
    expect(values.forward_all_enabled).toBe(true);
    expect(values.forward_all_destination).toBe("5145551234");
    expect(Object.keys(values).every((k) => k.startsWith("forward_") || k === "do_not_disturb")).toBe(true);
  });
});
