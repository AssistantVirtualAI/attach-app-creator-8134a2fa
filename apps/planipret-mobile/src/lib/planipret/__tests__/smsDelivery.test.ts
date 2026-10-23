import { describe, expect, it } from "vitest";
import { preserveSmsDelivery, smsDeliveryState } from "../smsDelivery";

describe("SMS delivery evidence for every broker", () => {
  it("treats a locally saved sent row as accepted, never delivered", () => {
    expect(smsDeliveryState({ source: "local", status: "sent", read_at: "2026-10-23" })).toBe("accepted");
  });
  it("keeps Karl's provider sending status despite local sent", () => {
    expect(smsDeliveryState({ status: "sent", metadata: { status: "sending" } })).toBe("sending");
  });
  it("requires explicit provider delivered confirmation", () => {
    expect(smsDeliveryState({ source: "local", status: "delivered" })).toBe("unknown");
    expect(smsDeliveryState({ provider_status: "delivered" })).toBe("delivered");
  });
  it("does not infer delivery from 202 or an unknown provider status", () => {
    expect(smsDeliveryState({ http_status: 202 })).toBe("unknown");
    expect(smsDeliveryState({ provider_status: "complete" })).toBe("unknown");
  });
  it("retains delivery evidence when a local duplicate replaces a provider copy", () => {
    const merged = preserveSmsDelivery({ source: "local", status: "sent" }, { status: "sending" });
    expect(smsDeliveryState(merged)).toBe("sending");
  });
  it("preserves explicit provider failure", () => {
    expect(smsDeliveryState({ status: "sent", metadata: { status: "undelivered" } })).toBe("failed");
  });
});