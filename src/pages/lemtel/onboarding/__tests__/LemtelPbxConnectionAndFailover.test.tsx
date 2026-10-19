import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hosted = vi.hoisted(() => ({
  api: { getFailoverStatus: vi.fn() },
  getSession: vi.fn(),
}));
vi.mock("../lemtelHostedApi", () => ({
  portalApi: hosted.api,
  LemtelError: class LemtelError extends Error { constructor(public key: string) { super(key); } },
  LEMTEL_BACKEND_CONFIGURED: true,
  LEMTEL_ONBOARDING_ENABLED: true,
  LEMTEL_API_URL: "https://lemtel.example",
  LEMTEL_PUBLISHABLE_KEY: "pk",
  lemtelClient: () => ({ auth: { getSession: hosted.getSession } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import LemtelFailoverBridge from "../LemtelFailoverBridge";
import LemtelPbxConnection from "../LemtelPbxConnection";

const ORG = "11111111-1111-4111-8111-111111111111";
const emptyState = { connection: null, secrets: { turn_shared_secret: { set: false, setAt: null }, fusionpbx_api_key: { set: false, setAt: null } }, assignments: [],
  members: [{ userId: "33333333-3333-4333-8333-333333333333", email: "alice@lemtel.tel", name: "Alice", role: "member" }],
  activationBlocker: "connection_not_configured", serverReadiness: { encryptionKeyConfigured: true, credentialDeliveryEnabled: false } };
const savedConnection = { vendor: "fusionpbx", sipDomain: "lemtel.lemtel.tel", pbxHost: "pbxnode.lemtel.tel", sipTransport: "tls", sipPort: 5061, wssUrl: "wss://pbxnode.lemtel.tel:7443",
  outboundProxy: null, stunUrls: [], turnUrls: [], registrationExpires: 300, codecs: ["opus", "PCMU", "PCMA"], srtpMode: "dtls_srtp", managementMode: "none", managementBaseUrl: null,
  state: "draft", revision: 1, lastValidation: null };

let calls: Array<Record<string, unknown>> = [];
function backend(responses: Array<unknown>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const next = responses.shift() ?? emptyState;
    return new Response(JSON.stringify(next), { status: (next as { error?: string }).error ? 409 : 200 });
  }));
}

beforeEach(() => { hosted.getSession.mockResolvedValue({ data: { session: { access_token: "jwt" } } }); hosted.api.getFailoverStatus.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Connexion FusionPBX (portal intake)", () => {
  it("guides the 5 steps, proposes the FusionPBX WSS URL and sends only non-secret settings on save", async () => {
    backend([emptyState, { ok: true, ...emptyState, connection: savedConnection, activationBlocker: "validation_not_passed" }]);
    render(<LemtelPbxConnection lang="fr" organizationId={ORG} readonly={false} />);
    expect(await screen.findByText("Connexion FusionPBX")).toBeInTheDocument();
    for (const step of ["1. Paramètres FusionPBX", "2. Secrets serveur", "3. Extensions", "4. Test réel", "5. Activation"]) expect(screen.getAllByText(step).length).toBeGreaterThan(0);
    expect(screen.getByText(/Distribution des identifiants aux applications désactivée/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Hôte PBX (FQDN)"), { target: { value: "pbxnode.lemtel.tel" } });
    expect((screen.getByLabelText(/URL WSS/) as HTMLInputElement).value).toBe("wss://pbxnode.lemtel.tel:7443");
    fireEvent.change(screen.getByLabelText("Domaine SIP (domaine FusionPBX)"), { target: { value: "lemtel.lemtel.tel" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les paramètres" }));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1]).toMatchObject({ action: "save_settings", organizationId: ORG, settings: { pbxHost: "pbxnode.lemtel.tel", sipDomain: "lemtel.lemtel.tel", wssUrl: "wss://pbxnode.lemtel.tel:7443", sipTransport: "tls", sipPort: 5061 } });
    expect(JSON.stringify(calls[1])).not.toMatch(/password|secret/i);
    expect(await screen.findByText("Brouillon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activer la connexion/ })).toBeDisabled();
  });

  it("shows each live-test check with a readable result and never displays a stored secret", async () => {
    const validated = { ...savedConnection, state: "validated", lastValidation: { checkedAt: "2026-10-19T12:00:00Z", passed: true, checks: [
      { key: "wss_tls_websocket", status: "ok", detail: "websocket_sip_subprotocol_open" }, { key: "sip_options", status: "ok", detail: "sip_status_200" },
      { key: "register_1042", status: "ok", detail: "registered_and_unregistered" }, { key: "turn_relay", status: "skipped", detail: "turn_not_configured_media_may_fail_behind_nat" }] } };
    backend([{ ...emptyState, connection: validated, activationBlocker: null, secrets: { ...emptyState.secrets, turn_shared_secret: { set: true, setAt: "2026-10-19T11:00:00Z" } },
      assignments: [{ userId: "33333333-3333-4333-8333-333333333333", email: "alice@lemtel.tel", userName: "Alice", extension: "1042", authUsername: null, displayName: null, isTest: true, state: "assigned", credentialSet: true, credentialSetAt: "x", credentialRevision: 1 }] }]);
    render(<LemtelPbxConnection lang="fr" organizationId={ORG} readonly={false} />);
    expect(await screen.findByText("Validé — prêt à activer")).toBeInTheDocument();
    expect(screen.getByText("— enregistrée puis désenregistrée (identifiants corrects)")).toBeInTheDocument();
    expect(screen.getByText("— non configuré : l’audio peut échouer derrière un NAT")).toBeInTheDocument();
    expect(screen.getByText(/Défini le/)).toBeInTheDocument();
    for (const input of Array.from(document.querySelectorAll("input[type=password]"))) expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: /Activer la connexion/ })).not.toBeDisabled();
  });
});

describe("Bascule automatique et pont Cloudflare (6.8)", () => {
  it("shows the real ON state, the node actually serving and the Cloudflare bridge", async () => {
    hosted.api.getFailoverStatus.mockResolvedValue({ checkedAt: "2026-10-19T12:00:00Z", arbiter: { reachable: true, automaticFailover: "on", state: "healthy", reason: "healthy" },
      routing: { servingRole: "do_writer", httpStatus: 200 }, loadBalancer: { configured: true, reachable: true, pools: [{ role: "do_writer", healthy: true, enabled: true }, { role: "hostinger_standby", healthy: true, enabled: true }] } });
    render(<LemtelFailoverBridge lang="fr" />);
    expect(await screen.findByText("Bascule auto : ACTIVE")).toBeInTheDocument();
    expect(within(screen.getByTestId("lt-failover-node-do")).getByText("Sert le site")).toBeInTheDocument();
    expect(within(screen.getByTestId("lt-failover-node-hostinger")).getByText("En attente")).toBeInTheDocument();
    expect(within(screen.getByTestId("lt-failover-cloudflare")).getByText("Cloudflare")).toBeInTheDocument();
    expect(screen.getByText("Routage : → DigitalOcean")).toBeInTheDocument();
  });
  it("shows OFF when the arbiter is disabled and hides itself from non platform administrators", async () => {
    hosted.api.getFailoverStatus.mockResolvedValue({ checkedAt: "2026-10-19T12:00:00Z", arbiter: { reachable: true, automaticFailover: "off", state: "disabled_or_dry_run", reason: "disabled_or_dry_run" },
      routing: { servingRole: "hostinger_writer", httpStatus: 200 }, loadBalancer: { configured: false, reachable: false, pools: [] } });
    render(<LemtelFailoverBridge lang="fr" />);
    expect(await screen.findByText("Bascule auto : DÉSACTIVÉE")).toBeInTheDocument();
    expect(screen.getByText("Routage : → Hostinger")).toBeInTheDocument();
    expect(screen.getByText("LB : jeton lecture non configuré")).toBeInTheDocument();
    cleanup();
    const { LemtelError } = await import("../lemtelHostedApi");
    hosted.api.getFailoverStatus.mockRejectedValue(new (LemtelError as unknown as new (k: string) => Error)("not_allowed"));
    const { container } = render(<LemtelFailoverBridge lang="fr" />);
    await waitFor(() => expect(hosted.api.getFailoverStatus).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});
