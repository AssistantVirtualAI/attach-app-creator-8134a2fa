import { expect, it } from "vitest";
import { mergeDeliveryEvidence } from "../../../../supabase/functions/pp-ns-sms/delivery-evidence";

it("retains sending from the provider when the local sent copy wins", () => {
  expect(mergeDeliveryEvidence({ status: "sent" }, { status: "sending" }).provider_status).toBe("sending");
});
it("retains explicit delivered confirmation", () => {
  expect(mergeDeliveryEvidence({ status: "sent" }, { status: "delivered" }).provider_status).toBe("delivered");
});
it("does not invent a provider confirmation for local history", () => {
  expect(mergeDeliveryEvidence({ status: "sent" }, null).provider_status).toBeUndefined();
});