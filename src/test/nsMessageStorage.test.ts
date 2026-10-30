import { describe, expect, it } from "vitest";
import { nsMessageRow, nsSessionId, persistNsMessages } from "../../supabase/functions/_shared/ns-message-storage";
const owner = { profileId: "broker-profile", extension: "1117", domain: "planipret.ca", organizationId: "org" };
const inbound = { id: "sms-1", direction: "orig", "terminating-user-id": "1117@planipret.ca", "from-number": 15145551234, dialed: 15145555678, text: "Bonjour", timestamp: "2026-10-29 20:00:00" };
describe("all-broker SMS storage", () => {
  it("saves received SMS with provider time and real media_urls column", () => {
    expect(nsMessageRow(inbound, owner, "thread-1")).toMatchObject({ user_id: "broker-profile", direction: "inbound", sent_at: "2026-10-29T20:00:00.000Z", thread_id: "thread-1", media_urls: [] });
    expect(nsMessageRow(inbound, owner)).not.toHaveProperty("media-urls");
  });
  it("does not import a different broker's incoming messages", () => {
    expect(nsMessageRow(inbound, { ...owner, extension: "1142" })).toBeNull();
  });
  it("keeps internal replies and outbound provider status", () => {
    expect(nsMessageRow({ ...inbound, direction: "term", "from-user-id": "1117@planipret.ca", "from-number": undefined, "terminating-user-id": "1142@planipret.ca", dialed: undefined, status: "sending" }, owner)).toMatchObject({ direction: "outbound", from_number: "1117", to_number: "1142", status: "sending" });
  });
  it("supports the actual alternate session identifiers", () => {
    expect(nsSessionId({ session_id: "session-1" })).toBe("session-1");
    expect(nsSessionId({ id: "session-2" })).toBe("session-2");
  });
  it("persists once without overwriting existing evidence and fails on storage errors", async () => {
    let saved: any[] = []; let options: any;
    const admin = { from: () => ({ upsert: async (rows: any[], opts: any) => { saved = rows; options = opts; return { error: null }; } }) };
    expect(await persistNsMessages(admin, [inbound, inbound], owner)).toBe(1);
    expect(saved).toHaveLength(1); expect(options).toEqual({ onConflict: "ns_message_id", ignoreDuplicates: true });
    await expect(persistNsMessages({ from: () => ({ upsert: async () => ({ error: { code: "42703" } }) }) }, [inbound], owner)).rejects.toThrow("sms_storage_failed:42703");
  });
});