import { describe, expect, it, beforeEach } from "vitest";
import {
  normalizeNsEvents,
  nsCallKey,
  isTeardown,
  nsCdrExtensionCandidates,
  shouldProcessCall,
  __resetCallDedupForTests,
} from "../ns-call-events.ts";

describe("normalizeNsEvents", () => {
  beforeEach(() => __resetCallDedupForTests());

  it("handles an array of NS v2 call objects", () => {
    const events = normalizeNsEvents([
      { orig_callid: "abc123", term_user: "113@planipret.ca", orig_from_user: "5145551234" },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("call.inbound");
    expect(events[0].data.extension).toBe("113");
    expect(events[0].data.from_number).toBe("5145551234");
    expect(events[0].data.call_id).toBe("abc123");
  });

  it("ignores teardown events (remove: yes)", () => {
    expect(isTeardown({ remove: "yes" })).toBe(true);
    const events = normalizeNsEvents([{ orig_callid: "x", term_user: "113", remove: "yes" }]);
    expect(events).toHaveLength(0);
  });

  it("still accepts legacy { type, data } payloads", () => {
    const events = normalizeNsEvents({ type: "voicemail.new", data: { id: 9 } });
    expect(events).toEqual([{ type: "voicemail.new", data: { id: 9 } }]);
  });

  it("strips sip: and domain from the terminating extension", () => {
    const [ev] = normalizeNsEvents([{ orig_callid: "k", "term-user": "sip:207@dom.com" }]);
    expect(ev.data.extension).toBe("207");
  });

  it("strips the mobile device suffix from an active internal call", () => {
    const [ev] = normalizeNsEvents([{
      orig_callid: "mobile-leg",
      "call-orig-user": "111M@planipret.ca",
      "call-term-user": "sip:1037M@planipret.ca",
    }]);
    expect(ev.type).toBe("call.inbound");
    expect(ev.data.extension).toBe("1037");
  });

  it("classifies a completed CDR before its call-leg fields", () => {
    const [ev] = normalizeNsEvents([{
      "cdr-id": "cdr-1",
      "call-orig-call-id": "orig-1",
      "call-orig-user": "113",
      "call-term-user": "5145550100",
      duration: 42,
    }]);
    expect(ev.type).toBe("cdr");
    expect(ev.data.extension_candidates).toContain("113");
  });

  it("keeps an active call with a transient duration as a call event", () => {
    const [ev] = normalizeNsEvents([{
      orig_callid: "live-1",
      "call-orig-user": "5145550100",
      "call-term-user": "113",
      duration: 12,
    }]);
    expect(ev.type).toBe("call.inbound");
  });

  it("retains broker candidates from both CDR legs and ignores public DIDs", () => {
    expect(nsCdrExtensionCandidates({
      "call-term-user": "sip:207M@planipret.ca",
      "call-orig-user": "113W@planipret.ca",
      to: "+15145550100",
    })).toEqual(["207", "113"]);
  });

  it("keeps the orig call id as the dedup key", () => {
    expect(nsCallKey({ orig_callid: "aaa" })).toBe("aaa");
    expect(nsCallKey({ "call-orig-call-id": "bbb" })).toBe("bbb");
  });

  it("dedups repeated state changes for the same call", () => {
    expect(shouldProcessCall("call-1")).toBe(true);
    expect(shouldProcessCall("call-1")).toBe(false);
    expect(shouldProcessCall("call-2")).toBe(true);
  });

  it("re-allows a call id after the dedup TTL expires", () => {
    const t0 = 1_000_000;
    expect(shouldProcessCall("call-3", 60_000, t0)).toBe(true);
    expect(shouldProcessCall("call-3", 60_000, t0 + 61_000)).toBe(true);
  });

  it("returns nothing for garbage payloads", () => {
    expect(normalizeNsEvents(null)).toEqual([]);
    expect(normalizeNsEvents(["nope", 3])).toEqual([]);
  });
});

describe("NS v2 message webhook", () => {
  it("SMS to on-net broker becomes message.inbound", () => {
    const ev = normalizeNsEvents([{ id: "m1", type: "sms", domain: "planipret.ca", direction: "orig",
      "from-number": "14388427217", "from-user-id": "113", "terminating-user-id": "1064",
      "terminating-number": "15143743320", text: "Bonjour", "messagesession-id": "s1" }]);
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe("message.inbound");
    expect(ev[0].data).toMatchObject({ extension: "1064", body: "Bonjour", from_number: "14388427217", to_number: "15143743320" });
  });
  it("ignores messages without on-net receiver or self echo", () => {
    expect(normalizeNsEvents([
      { type: "sms", direction: "term", "from-user-id": "113", "terminating-user-id": "1064", text: "x", "messagesession-id": "s" },
      { type: "sms", "from-user-id": "113", "terminating-user-id": "1064", text: "x", "messagesession-id": "s" },
      { type: "sms", direction: "orig", "from-user-id": "113", "terminating-user-id": null, text: "x", "messagesession-id": "s" },
      { type: "sms", direction: "orig", "from-user-id": "113", "terminating-user-id": "113", text: "x", "messagesession-id": "s" },
    ])).toHaveLength(0);
  });
});

describe("v2 voicemail objects", () => {
  it("filename .wav without voicemail-id → voicemail.new", () => {
    const out = normalizeNsEvents([{ filename: "vm-20261020200014008354-abc.wav", domain: "planipret.ca", user: "1117",
      FromName: "Client", NmsAni: "5145551234", "file-duration-seconds": 12, "recorded-datetime": "2026-10-20 20:00:14", transcription: "Bonjour" }]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("voicemail.new");
    expect(out[0].data).toMatchObject({ user: "1117", vm_id: "vm-20261020200014008354-abc.wav", from_number: "5145551234", from_name: "Client", duration_seconds: 12 });
  });
  it("owner falls back to file-access-url user param", () => {
    const out = normalizeNsEvents([{ filename: "vm-1.wav", remotepath: "https://x/ns-api/?object=audio&user=1064&type=vmail&file=vm-1.wav" }]);
    expect(out[0]?.type).toBe("voicemail.new");
    expect(out[0].data.user).toBe("1064");
  });
  it("plain .wav without voicemail fields is ignored", () => {
    expect(normalizeNsEvents([{ filename: "greeting.wav" }]).some((e) => e.type === "voicemail.new")).toBe(false);
  });
});
