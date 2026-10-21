import { describe, expect, it } from "vitest";
import { mergeVoicemailList, voicemailCaller, type VoicemailListItem } from "./voicemailList";

const cached = (overrides: Partial<VoicemailListItem> = {}): VoicemailListItem => ({
  id: "local-1", user_id: "broker-A", ns_vm_id: "vm-1.wav", folder: "new", from_number: null,
  from_name: null, duration_seconds: null, audio_url: null, transcript: null, is_read: true,
  received_at: "2026-10-21T12:00:00Z", created_at: "2026-10-21T12:00:00Z", ...overrides,
});

describe("mobile voicemail lists", () => {
  it("prefers the directory contact name over provider caller ID", () => {
    expect(voicemailCaller({ from_number: "sip:15147071203@example.test", from_name: "Unknown" }, { contactsByPhone: { "5147071203": "Olivier Lachance" } }))
      .toEqual({ name: "Olivier Lachance", phone: "(514) 707-1203" });
  });
  it("displays a formatted phone when no contact matches", () => {
    expect(voicemailCaller({ from_number: "15147071203", from_name: "15147071203" }, {}))
      .toEqual({ name: null, phone: "(514) 707-1203" });
  });
  it("resolves internal callers from the directory", () => {
    expect(voicemailCaller({ from_number: "sip:1117M@example.test", from_name: null }, { internalByExt: { "1117": "Test Broker" } }).name).toBe("Test Broker");
  });
  it("never invents identity for withheld callers", () => {
    expect(voicemailCaller({ from_number: "anonymous", from_name: "Unknown" }, {})).toEqual({ name: null, phone: null });
  });
  it("shows native new-folder messages in the inbox with documented fields", () => {
    const rows = mergeVoicemailList([{ filename: "vm-1.wav", folder: "new", FromName: "Test caller", FromUser: "15555550123", "file-duration-seconds": 32, "file-access-url": "/test-audio.wav", transcription: "Test transcript", "created-datetime": "2026-10-21T12:00:00Z" }], [], "broker-A", "inbox");
    expect(rows[0]).toMatchObject({ ns_vm_id: "vm-1.wav", folder: "inbox", from_name: "Test caller", from_number: "15555550123", duration_seconds: 32, audio_url: "/test-audio.wav", transcript: "Test transcript" });
  });
  it("maps saved-folder messages and retains local database IDs and read state", () => {
    const rows = mergeVoicemailList([{ vm_id: "vm-1.wav", folder: "save", is_read: false }], [cached()], "broker-A", "saved");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "local-1", folder: "saved", is_read: true });
  });
  it("retains local messages absent from a provider response", () => {
    expect(mergeVoicemailList([{ filename: "vm-2.wav" }], [cached()], "broker-A", "inbox")).toHaveLength(2);
  });
  it("never includes another broker's cached messages", () => {
    expect(mergeVoicemailList([], [cached()], "broker-B", "inbox")).toEqual([]);
  });
  it("does not synthesize actionable IDs for unidentified voicemail", () => {
    expect(mergeVoicemailList([{ FromName: "No identity" }], [], "broker-A", "inbox")).toEqual([]);
  });
});