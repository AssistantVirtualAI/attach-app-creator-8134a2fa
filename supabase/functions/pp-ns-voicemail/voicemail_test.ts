import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appFolder, normalizeVoicemail, providerFolder, voicemailRows } from "./voicemail.ts";

Deno.test("app folders use the documented provider folders", () => {
  assertEquals(providerFolder("inbox"), "new");
  assertEquals(providerFolder("saved"), "save");
  assertEquals(providerFolder("deleted"), "trash");
  assertEquals(providerFolder("save"), "save");
  assertEquals(providerFolder("invalid"), null);
  assertEquals(appFolder("new"), "inbox");
});
Deno.test("v2 voicemail fields produce display and persistence values", () => {
  assertEquals(normalizeVoicemail({ filename: "vm-test.wav", FromUser: "15555550123", FromName: "Test", "file-duration-seconds": "43", "file-access-url": "/fixture.wav", transcription: "Test", "created-datetime": "2026-10-21T12:00:00Z" }, "new", "2026-10-21T13:00:00Z"), {
    vm_id: "vm-test.wav", ns_vm_id: "vm-test.wav", from_number: "15555550123", from_name: "Test", duration_seconds: 43, folder: "inbox", is_read: false, audio_url: "/fixture.wav", transcript: "Test", received_at: "2026-10-21T12:00:00.000Z", created_at: "2026-10-21T12:00:00.000Z",
  });
});
Deno.test("filename identity is required", () => {
  assertEquals(normalizeVoicemail({ index: "1" }, "inbox", "2026-10-21T12:00:00Z"), null);
});
Deno.test("saved messages are read and durations are validated", () => {
  const vm = normalizeVoicemail({ filename: "vm-test.wav", length: "bad" }, "save", "2026-10-21T12:00:00Z");
  assertEquals(vm?.folder, "saved");
  assertEquals(vm?.is_read, true);
  assertEquals(vm?.duration_seconds, null);
});
Deno.test("malformed provider lists fail instead of becoming empty", () => {
  assertEquals(voicemailRows({ data: [{ filename: "vm-test.wav" }] }).length, 1);
  assertThrows(() => voicemailRows({ error: "failed" }));
});
