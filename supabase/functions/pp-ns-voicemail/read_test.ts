import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readVoicemailAudio, readVoicemailList, voicemailPath } from "./read.ts";
const now = "2026-10-21T18:15:00Z";
Deno.test("list and audio reads remain within the authenticated broker scope", async () => {
  const paths: string[] = [];
  const fetcher = (path: string, init: RequestInit) => {
    paths.push(path); assertEquals(init.method, "GET");
    return Promise.resolve(Response.json(path.endsWith("/new") ? [{ filename: "a.wav", FromUser: "15147071203" }] : [{ "file-access-url": "/a-audio" }]));
  };
  assertEquals((await readVoicemailList(fetcher, "test", "1117", "inbox", now))[0].from_number, "15147071203");
  assertEquals(await readVoicemailAudio(fetcher, "test", "1117", "inbox", "a.wav"), "/a-audio");
  assertEquals(paths.every((path) => path.startsWith("/domains/test/users/1117/voicemails/new")), true);
});
Deno.test("another broker's filename never reaches the audio detail read", async () => {
  const paths: string[] = [];
  const fetcher = (path: string) => { paths.push(path); return Promise.resolve(Response.json([{ filename: "b.wav" }])); };
  assertEquals(await readVoicemailAudio(fetcher, "test", "2222", "inbox", "a.wav"), null);
  assertEquals(paths, ["/domains/test/users/2222/voicemails/new"]);
});
Deno.test("unidentified list messages use documented metadata for caller details", async () => {
  const fetcher = (path: string) => Promise.resolve(Response.json(path.endsWith("/save") ? [{ filename: "a.wav" }] : [{ FromUser: "", NmsAni: "15147071203", FromName: "Olivier" }]));
  const rows = await readVoicemailList(fetcher, "test", "1117", "saved", now);
  assertEquals(rows[0].from_number, "15147071203"); assertEquals(rows[0].from_name, "Olivier");
});
Deno.test("metadata failure retains the voicemail rather than returning empty", async () => {
  const fetcher = (path: string) => Promise.resolve(path.endsWith("/new") ? Response.json([{ filename: "a.wav" }]) : new Response(null, { status: 503 }));
  assertEquals((await readVoicemailList(fetcher, "test", "1117", "inbox", now)).length, 1);
});
Deno.test("invalid folder and path identities fail closed", () => {
  assertThrows(() => voicemailPath("test", "1117", "other", "a.wav"));
  assertThrows(() => voicemailPath("test", "1117", "inbox", "../a.wav"));
});
Deno.test("provider failures never become an empty success", async () => {
  await assertRejects(() => readVoicemailList(() => Promise.resolve(new Response(null, { status: 401 })), "test", "1117", "inbox", now));
});