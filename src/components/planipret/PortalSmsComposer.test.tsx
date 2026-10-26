import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalSmsComposer from "./PortalSmsComposer";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), success: vi.fn(), availability: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("@/lib/planipret/smsAvailability", () => ({
  getSmsAvailability: (...args: unknown[]) => mocks.availability(...args),
  normalizeSmsNumber: (value: string) => value.replace(/\D/g, "").length === 10 ? `+1${value.replace(/\D/g, "")}` : null,
}));

describe("PortalSmsComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.availability.mockResolvedValue({ state: "ready", primaryNumber: "+15145550100" });
  });
  const setup = () => {
    const onClose = vi.fn();
    const onSent = vi.fn();
    render(<PortalSmsComposer target={{ number: "5145550199" }} userId="broker-a" lang="en" onClose={onClose} onSent={onSent} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Bonjour client" } });
    return { onClose, onSent };
  };

  it("submits only the recipient and draft through the authenticated endpoint", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const { onSent } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledOnce());
    expect(mocks.invoke).toHaveBeenCalledWith("pp-ns-sms", { body: { action: "send", to: "+15145550199", message: "Bonjour client", idempotency_key: expect.stringContaining("pp-sms-v1:") } });
    expect(mocks.success).toHaveBeenCalledWith("Message accepted");
  });

  it("retains the dispatch key on manual retry and never automatically retries", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "Network unavailable" } });
    const { onSent } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();
    const first = mocks.invoke.mock.calls[0][1].body.idempotency_key;
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls[1][1].body.idempotency_key).toBe(first);
  });

  it("does not send when closing an unsent draft", async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
  });

  it("keeps a server-rejected draft without reporting success or retrying", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: false, error: "Test messages are disabled", error_code: "test_sms_blocked" }, error: null });
    const { onSent, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Message")).toHaveValue("Bonjour client");
  });

  it("does not accept an incomplete service response", async () => {
    mocks.invoke.mockResolvedValue({ data: {}, error: null });
    const { onSent } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("submits extension 113 even without an external sender DID", async () => {
    mocks.availability.mockResolvedValue({ state: "unavailable", primaryNumber: null });
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    setup();
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "113" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("pp-ns-sms", { body: {
      action: "send", to: "113", message: "Bonjour client", idempotency_key: expect.stringContaining("pp-sms-v1:"),
    } }));
  });

  it("still blocks external SMS when no sender DID is available", async () => {
    mocks.availability.mockResolvedValue({ state: "unavailable", primaryNumber: null });
    setup();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});