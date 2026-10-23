import { describe, expect, it } from "vitest";
import { isMaestroSyncSuccessful } from "../maestroSyncOutcome";

describe("Maestro history outcome", () => {
  it.each(["widget.sync", "widget.release"])("recognizes legacy %s HTTP 200 without success", (action) => {
    expect(isMaestroSyncSuccessful({ action, response_status: 200, success: null, response_body: null })).toBe(true);
  });
  it("keeps HTTP 500 in failures", () => {
    expect(isMaestroSyncSuccessful({ action: "widget.sync", response_status: 500, success: null, response_body: { error: "http_500" } })).toBe(false);
  });
  it("preserves explicit failure even with HTTP 200", () => {
    expect(isMaestroSyncSuccessful({ action: "widget.sync", response_status: 200, success: false })).toBe(false);
  });
  it("never infers success for non-widget business results", () => {
    expect(isMaestroSyncSuccessful({ action: "call.summary", response_status: 200, success: null })).toBe(false);
  });
  it.each([{ error: "failed" }, { skipped: "not_configured" }, { success: false }, { ok: false }])("preserves failure evidence %j", (response_body) => {
    expect(isMaestroSyncSuccessful({ action: "widget.sync", response_status: 200, success: null, response_body })).toBe(false);
  });
  it.each([0, null, 199, 300, 401, 503])("does not infer success from status %s", (response_status) => {
    expect(isMaestroSyncSuccessful({ action: "widget.sync", response_status, success: null })).toBe(false);
  });
  it("preserves explicit successful outcomes without an HTTP response", () => {
    expect(isMaestroSyncSuccessful({ action: "call.analysis.skipped", response_status: 0, success: true })).toBe(true);
  });
});