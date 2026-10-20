import { assert, assertEquals, assertMatch } from "./lemtelTestAssert.ts";
import {
  activationBlocker, buildSipRequest, digestAuthorization, extensionAad, isInvalid, loadSecretKey, md5, openSecret, optionsPing,
  parseAssignment, parseChallenge, parseSecret, parseSettings, registrationProbe, sealSecret, summarize, turnCredential,
  type SocketLike,
} from "./lemtelPbxConnection.ts";

const valid = { sipDomain: "lemtel.lemtel.tel", pbxHost: "pbxnode.lemtel.tel", wssUrl: "wss://pbxnode.lemtel.tel:7443", turnUrls: ["turns:turn.lemtel.tel:5349?transport=tcp"], stunUrls: ["stun:turn.lemtel.tel:3478"] };

Deno.test("md5 matches RFC 1321 vectors", () => {
  assertEquals(md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assertEquals(md5("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assertEquals(md5("The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6");
  assertEquals(md5("a".repeat(1000)), "cabe45dcc9ae5b66ba86600cca6b8ba8");
});

Deno.test("digest response matches the RFC 2617 example", () => {
  const ch = parseChallenge('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"')!;
  const h = digestAuthorization(ch, "Mufasa", "Circle Of Life", "GET", "/dir/index.html", "0a4f113b");
  assertMatch(h, /response="6629fae49393a05397450978507c4ef1"/);
});

Deno.test("settings: strict, defaults applied, unknown or secret-looking keys refused", () => {
  const s = parseSettings(valid);
  assert(!isInvalid(s));
  assertEquals(s.sipTransport, "tls"); assertEquals(s.sipPort, 5061); assertEquals(s.registrationExpires, 300);
  assertEquals(s.codecs, ["opus", "PCMU", "PCMA"]); assertEquals(s.srtpMode, "dtls_srtp");
  assertEquals((parseSettings({ ...valid, password: "x" }) as { error: string }).error, "unexpected_field_password");
  assertEquals((parseSettings({ ...valid, wssUrl: "ws://pbxnode.lemtel.tel:5066" }) as { error: string }).error, "invalid_wss_url_wss_required");
  assertEquals((parseSettings({ ...valid, wssUrl: "wss://user:pw@pbxnode.lemtel.tel:7443" }) as { error: string }).error, "invalid_wss_url_wss_required");
  assertEquals((parseSettings({ ...valid, turnUrls: ["turn:user:pw@x"] }) as { error: string }).error, "invalid_turn_urls");
  assertEquals((parseSettings({ ...valid, sipDomain: "10.0.0.1" }) as { error: string }).error, "invalid_sip_domain");
  assertEquals((parseSettings({ ...valid, managementMode: "fusionpbx_api", managementBaseUrl: "http://x.y" }) as { error: string }).error, "invalid_management_base_url_https_required");
  const dom = "0b8e2c1a-5d3f-4e6a-9b7c-1d2e3f4a5b6c";
  assertEquals((parseSettings({ ...valid, managementMode: "fusionpbx_api", managementBaseUrl: "https://pbxnode.lemtel.tel" }) as { error: string }).error, "invalid_management_domain_uuid");
  assertEquals((parseSettings({ ...valid, managementMode: "fusionpbx_api", managementBaseUrl: "https://pbxnode.lemtel.tel", managementDomainUuid: dom, managementUsername: "bad user" }) as { error: string }).error, "invalid_management_username");
  const m = parseSettings({ ...valid, managementMode: "fusionpbx_api", managementBaseUrl: "https://pbxnode.lemtel.tel", managementDomainUuid: dom.toUpperCase(), managementUsername: "api.lemtel" });
  assert(!isInvalid(m)); assertEquals(m.managementDomainUuid, dom); assertEquals(m.managementUsername, "api.lemtel");
});

Deno.test("assignment and secret validation", () => {
  const a = parseAssignment({ userId: "6f1c7c3e-2b7a-4c8e-9d3f-1a2b3c4d5e6f", extension: "1042", isTest: true });
  assert(!isInvalid(a)); assertEquals(a.authUsername, null);
  assert(isInvalid(parseAssignment({ userId: "x", extension: "1042" })));
  assert(isInvalid(parseAssignment({ userId: "6f1c7c3e-2b7a-4c8e-9d3f-1a2b3c4d5e6f", extension: "10a" })));
  assert(isInvalid(parseSecret("short")));
  assert(isInvalid(parseSecret("has space inside")));
  assertEquals(parseSecret("S3cure!Pass"), "S3cure!Pass");
});

Deno.test("secrets are sealed with AES-GCM, bound to their row, and require the right key version", async () => {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const k = (await loadSecretKey((n) => ({ LEMTEL_PBX_SECRET_ENCRYPTION_KEY: raw, LEMTEL_PBX_SECRET_KEY_VERSION: "2" } as Record<string, string>)[n]))!;
  const aad = extensionAad("org", "user", "1042");
  const sealed = await sealSecret(k, "S3cure!Pass", aad);
  assertMatch(sealed, /^v2\./); assert(!sealed.includes("S3cure"));
  assertEquals(await openSecret(k, sealed, aad), "S3cure!Pass");
  assertEquals(await openSecret(k, sealed, extensionAad("org", "other", "1042")), null, "moved ciphertext is rejected");
  assertEquals(await loadSecretKey(() => "c2hvcnQ="), null, "a short key is refused");
});

Deno.test("TURN credential follows the coturn use-auth-secret scheme", async () => {
  const c = await turnCredential("secret", "u1", 600, 1_000_000);
  assertEquals(c.username, "1600:u1");
  // HMAC-SHA1("secret", "1600:u1") base64, computed independently.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const expected = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("1600:u1")))));
  assertEquals(c.credential, expected);
});

// Fake FusionPBX over WSS: answers OPTIONS 200, challenges REGISTER, accepts the right digest.
function fakePbx(password: string, opts: { open?: boolean } = {}) {
  const sent: string[] = [];
  const factory = (_url: string, protocol: string): SocketLike => {
    assertEquals(protocol, "sip");
    const s: SocketLike = { onopen: null, onmessage: null, onerror: null, onclose: null,
      send(msg: string) {
        sent.push(msg);
        const method = msg.split(" ")[0];
        const header = (n: string) => (msg.match(new RegExp(`^${n}: (.*)$`, "mi")) ?? [])[1] ?? "";
        const reply = (status: string, extra = "") => queueMicrotask(() => s.onmessage?.({ data: `SIP/2.0 ${status}\r\nCall-ID: ${header("Call-ID")}\r\nCSeq: ${header("CSeq")}\r\n${extra}Content-Length: 0\r\n\r\n` }));
        if (method === "OPTIONS") { reply("100 Trying"); reply("200 OK"); return; }
        const auth = header("Authorization");
        if (!auth) { reply("401 Unauthorized", 'WWW-Authenticate: Digest realm="lemtel.lemtel.tel", nonce="abc123", qop="auth", algorithm=MD5\r\n'); return; }
        const ch = parseChallenge('Digest realm="lemtel.lemtel.tel", nonce="abc123", qop="auth"')!;
        const cnonce = /cnonce="([^"]+)"/.exec(auth)![1];
        const expected = digestAuthorization(ch, "1042", password, "REGISTER", "sip:lemtel.lemtel.tel", cnonce);
        reply(auth === expected ? "200 OK" : "403 Forbidden");
      },
      close() {} };
    queueMicrotask(() => (opts.open === false ? s.onerror?.({}) : s.onopen?.({})));
    return s;
  };
  return { factory, sent };
}

Deno.test("validation: WSS + OPTIONS + REGISTER/unREGISTER pass; wrong password and unreachable WSS fail", async () => {
  const pbx = fakePbx("S3cure!Pass");
  const base = await optionsPing(pbx.factory, valid.wssUrl, valid.sipDomain, 500);
  assertEquals(base.map((c) => c.status), ["ok", "ok"]);
  const reg = await registrationProbe(pbx.factory, valid.wssUrl, valid.sipDomain, "1042", "1042", "S3cure!Pass", 500);
  assertEquals(reg, { key: "register_1042", status: "ok", detail: "registered_and_unregistered" });
  assert(pbx.sent.some((m) => /^REGISTER /.test(m) && /Expires: 0/.test(m)), "binding removed right after the test");
  assert(pbx.sent.every((m) => !m.includes("S3cure!Pass")), "the password never travels in clear");
  assertEquals(summarize([...base, reg]).passed, true);
  const bad = await registrationProbe(fakePbx("other").factory, valid.wssUrl, valid.sipDomain, "1042", "1042", "S3cure!Pass", 500);
  assertEquals(bad.status, "failed");
  const down = await optionsPing(fakePbx("x", { open: false }).factory, valid.wssUrl, valid.sipDomain, 500);
  assertEquals(down[0].detail, "wss_unreachable_or_tls_rejected");
  assertEquals(summarize(down).passed, false);
});

Deno.test("activation is blocked until a recent passing validation exists", () => {
  const settings = parseSettings(valid);
  assert(!isInvalid(settings));
  const row = { ...settings, state: "draft" as const, revision: 1, lastValidation: null };
  assertEquals(activationBlocker(null), "connection_not_configured");
  assertEquals(activationBlocker(row), "validation_not_passed");
  const now = Date.parse("2026-10-19T12:00:00Z");
  assertEquals(activationBlocker({ ...row, lastValidation: { checkedAt: "2026-10-17T12:00:00Z", checks: [], passed: true } }, now), "validation_expired_revalidate");
  assertEquals(activationBlocker({ ...row, lastValidation: { checkedAt: "2026-10-19T11:00:00Z", checks: [], passed: true } }, now), null);
  assertMatch(buildSipRequest({ method: "OPTIONS", domain: "d.tel", user: "u", callId: "c", cseq: 1, branch: "b", tag: "t", viaHost: "h.invalid" }), /^OPTIONS sip:d\.tel SIP\/2\.0\r\nVia: SIP\/2\.0\/WSS h\.invalid;branch=z9hG4bKb/);
});
