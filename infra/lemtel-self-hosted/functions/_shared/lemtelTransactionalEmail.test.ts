import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import { emailConfig, safeHttpsUrl, transactionalEmailMessage, validatedFrom } from "./lemtelTransactionalEmail.ts";

const environment = (values: Record<string, string | undefined>) => ({ get: (name: string) => values[name] });
const configured = (overrides: Record<string, string | undefined> = {}) => emailConfig(environment({
  RESEND_API_KEY: "re_synthetic_provider_key_12345",
  LEMTEL_WELCOME_FROM: "Lemtel <welcome@lemtel.example>",
  ...overrides,
}));

Deno.test("French and English transactional templates select their locale and escape recipient data", () => {
  const config = configured();
  assert(config);
  const french = transactionalEmailMessage({ kind: "welcome", locale: "fr", displayName: "Ana <Admin>", email: "ana@example.test", temporaryPassword: "SYNTHETIC-PASSWORD-ONLY", config });
  const english = transactionalEmailMessage({ kind: "password_recovery", locale: "en", displayName: "Ana <Admin>", email: "ana@example.test", temporaryPassword: "SYNTHETIC-PASSWORD-ONLY", config });
  assertStringIncludes(french.subject, "Bienvenue");
  assertStringIncludes(french.html, "Bienvenue, Ana &lt;Admin&gt;");
  assertStringIncludes(french.html, "Mot de passe temporaire");
  assertStringIncludes(english.subject, "temporary password");
  assertStringIncludes(english.html, "Hello Ana &lt;Admin&gt;");
  assertStringIncludes(english.html, "Temporary password");
  assert(!english.html.includes("Get Lemtel"), "recovery should not add unrelated download links");
});

Deno.test("a temporary password appears only in the deterministic HTML body, never the subject or config", () => {
  const config = configured();
  assert(config);
  const marker = "SYNTHETIC-PASSWORD-ONLY";
  const message = transactionalEmailMessage({ kind: "welcome", locale: "en", displayName: "Synthetic", email: "synthetic@example.test", temporaryPassword: marker, config });
  assertStringIncludes(message.html, marker);
  assert(!message.subject.includes(marker));
  assert(!JSON.stringify(config).includes(marker));
  assert(!message.html.includes("SIP"));
  assert(!message.html.includes("extension"));
});

Deno.test("only an explicitly configured safe HTTPS logo is rendered remotely; unsafe values fall closed", () => {
  const safe = configured({ LEMTEL_EMAIL_LOGO_URL: "https://assets.lemtel.example/brand.svg" });
  assert(safe);
  const withLogo = transactionalEmailMessage({ kind: "welcome", locale: "en", displayName: "Brand", email: "brand@example.test", temporaryPassword: "Synthetic1!", config: safe });
  assertStringIncludes(withLogo.html, 'src="https://assets.lemtel.example/brand.svg"');
  assertEquals(configured({ LEMTEL_EMAIL_LOGO_URL: "https://assets.lemtel.example/logo.svg?tracking=1" }), undefined);
  assertEquals(configured({ LEMTEL_EMAIL_LOGO_URL: "http://assets.lemtel.example/logo.svg" }), undefined);
  const fallback = transactionalEmailMessage({ kind: "welcome", locale: "en", displayName: "Brand", email: "brand@example.test", temporaryPassword: "Synthetic1!", config: configured()! });
  // Default: the Lemtel mark as an immutable PNG (pinned commit), never SVG.
  assertStringIncludes(fallback.html, "/public/email/lemtel-mark-112.png");
  assert(!/src="[^"]+\.svg"/.test(fallback.html), "no SVG image by default");
});

Deno.test("the welcome email links every platform separately (iOS, Android, Windows, Mac Apple, Mac Intel); recovery carries the temporary password", () => {
  const config = configured({});
  if (!config) throw new Error("default configuration expected");
  for (const locale of ["fr", "en"] as const) {
    const recovery = transactionalEmailMessage({ kind: "password_recovery", locale, displayName: "Test", email: "t@lemtel.example", temporaryPassword: "Temp-Pass-123", config });
    assertStringIncludes(recovery.html, "Temp-Pass-123");
    for (const kind of ["welcome"] as const) {
      const message = transactionalEmailMessage({ kind, locale, displayName: "Test", email: "t@lemtel.example", temporaryPassword: "Temp-Pass-123", config });
      for (const url of [config.downloadUrls.ios, config.downloadUrls.android, config.downloadUrls.windows, config.downloadUrls.macosApple, config.downloadUrls.macosIntel]) {
        assertStringIncludes(message.html, url.replaceAll("&", "&amp;"));
      }
      assertStringIncludes(message.html, "Windows");
      assertStringIncludes(message.html, "Mac · Intel");
      assertStringIncludes(message.html, "App Store");
      assertStringIncludes(message.html, "Google Play");
      assertStringIncludes(message.html, "/public/email/icon-laptop.png");
      assertStringIncludes(message.html, `lang="${locale}"`);
    }
  }
  assertEquals(config.downloadUrls.android, "https://play.google.com/store/apps/details?id=com.lemtel.softphone");
});

Deno.test("sender and all mail URLs are strict HTTPS configuration, with no credentials, query or fragment", () => {
  assertEquals(validatedFrom(environment({ LEMTEL_WELCOME_FROM: "Welcome <welcome@lemtel.example>" })), undefined);
  assertEquals(validatedFrom(environment({ LEMTEL_WELCOME_FROM: "Lemtel <not-an-email>" })), undefined);
  assertEquals(validatedFrom(environment({ LEMTEL_EMAIL_SENDER_NAME: "Lemtel Notifications", LEMTEL_EMAIL_SENDER_ADDRESS: "mail@lemtel.example" })), "Lemtel Notifications <mail@lemtel.example>");
  assertEquals(safeHttpsUrl("https://cdn.lemtel.example/logo.svg"), "https://cdn.lemtel.example/logo.svg");
  assertEquals(safeHttpsUrl("https://user:pass@cdn.lemtel.example/logo.svg"), undefined);
  assertEquals(safeHttpsUrl("https://cdn.lemtel.example/logo.svg#fragment"), undefined);
  assertEquals(safeHttpsUrl("https://cdn.lemtel.example/logo.svg?query=1"), undefined);
  assertEquals(safeHttpsUrl("http://cdn.lemtel.example/logo.svg"), undefined);
  assertEquals(safeHttpsUrl("https://play.google.com/store/apps/details?id=com.lemtel.softphone"), "https://play.google.com/store/apps/details?id=com.lemtel.softphone");
  assertEquals(safeHttpsUrl("https://play.google.com/store/apps/details?id=com.lemtel.softphone&x=1"), undefined);
  assertEquals(safeHttpsUrl("https://evil.example/store/apps/details?id=com.lemtel.softphone"), undefined);
  assertEquals(configured({ LEMTEL_DOWNLOAD_IOS_URL: "http://unsafe.example/download" }), undefined);
  assertEquals(configured({ RESEND_API_KEY: "invalid-key" }), undefined);
});
