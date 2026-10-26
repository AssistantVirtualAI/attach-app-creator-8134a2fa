import { describe, expect, it } from "vitest";
import { approvedSmsTest, APPROVED_SMS_TEST_BODY as body, APPROVED_SMS_TEST_KEY as key } from "../../../supabase/functions/pp-ns-sms/approved-sms-test";
const user = "e5d025c9-eef2-4422-b97d-3190388b7376";
const now = Date.parse("2026-10-26T23:05:00Z");
describe("explicit one-test authorization", () => {
  it("allows only the approved owner and cell", () => {
    expect(approvedSmsTest(user, "+15142163359", body, key, now)).toBe(true);
    expect(approvedSmsTest("other", "+15142163359", body, key, now)).toBe(false);
    expect(approvedSmsTest(user, "+15142163358", body, key, now)).toBe(false);
  });
  it("requires the exact body and fixed deduplication key", () => {
    expect(approvedSmsTest(user, "5142163359", "test", key, now)).toBe(false);
    expect(approvedSmsTest(user, "5142163359", body, "other", now)).toBe(false);
  });
  it("expires without opening general test sending", () => {
    expect(approvedSmsTest(user, "5142163359", body, key, Date.parse("2026-10-26T23:20:00Z"))).toBe(false);
  });
});