// Lemtel transactional email primitives. Source-only: never log, persist, or return a temporary password.
export type LemtelLocale = "fr" | "en";
export type TransactionalEmailKind = "welcome" | "password_recovery";
export type EmailEnvironment = { get(name: string): string | undefined };

export type DistributionUrls = { ios: string; android: string; desktop: string };
export type TransactionalEmailConfig = {
  apiKey: string;
  from: string;
  logoUrl?: string;
  downloadUrls: DistributionUrls;
};
export type TransactionalEmailMessage = { subject: string; html: string };

const EMAIL_RE = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const MAX_URL_LENGTH = 2048;
const RELEASE_ROOT = "https://github.com/AssistantVirtualAI/attach-app-creator-8134a2fa/releases";
const RELEASE_TAG = `${RELEASE_ROOT}/download/v2.5.20`;

function trimmed(environment: EmailEnvironment, name: string): string | undefined {
  const value = environment.get(name)?.trim();
  return value || undefined;
}

/** HTTPS only; URLs with credentials, a query, or a fragment are never rendered. */
export function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value || value.length > MAX_URL_LENGTH || /[\u0000-\u001f\u007f\s]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) return undefined;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function senderAddress(value: string | undefined): string | undefined {
  if (!value || value.length > 320 || /[\r\n<>]/.test(value)) return undefined;
  return EMAIL_RE.test(value) ? value.toLowerCase() : undefined;
}

/** Only a recognizable Lemtel display name is acceptable for transactional sender identity. */
export function validatedFrom(environment: EmailEnvironment): string | undefined {
  const combined = trimmed(environment, "LEMTEL_WELCOME_FROM");
  if (combined) {
    const match = /^([^<>\r\n]{1,96})\s*<([^<>\s]+)>$/.exec(combined);
    const name = match?.[1]?.trim();
    const address = senderAddress(match?.[2]);
    if (!name || !/\blemtel\b/i.test(name) || !address) return undefined;
    return `${name} <${address}>`;
  }
  const name = trimmed(environment, "LEMTEL_EMAIL_SENDER_NAME");
  const address = senderAddress(trimmed(environment, "LEMTEL_EMAIL_SENDER_ADDRESS"));
  if (!name || name.length > 96 || /[<>\r\n]/.test(name) || !/\blemtel\b/i.test(name) || !address) return undefined;
  return `${name} <${address}>`;
}

export function distributionUrls(environment: EmailEnvironment): DistributionUrls | undefined {
  const configured = (name: string, fallback: string) => safeHttpsUrl(trimmed(environment, name) ?? fallback);
  const ios = configured("LEMTEL_DOWNLOAD_IOS_URL", "https://testflight.apple.com");
  const android = configured("LEMTEL_DOWNLOAD_ANDROID_URL", RELEASE_ROOT);
  const desktop = configured("LEMTEL_DOWNLOAD_DESKTOP_URL", `${RELEASE_ROOT}/tag/v2.5.20`);
  return ios && android && desktop ? { ios, android, desktop } : undefined;
}

/** A configuration failure is intentionally one generic condition at every public boundary. */
export function emailConfig(environment: EmailEnvironment): TransactionalEmailConfig | undefined {
  const apiKey = trimmed(environment, "RESEND_API_KEY");
  const from = validatedFrom(environment);
  const downloadUrls = distributionUrls(environment);
  const logoRaw = trimmed(environment, "LEMTEL_EMAIL_LOGO_URL");
  const logoUrl = logoRaw ? safeHttpsUrl(logoRaw) : undefined;
  // Resend server keys use the re_ prefix. Reject malformed configuration without making a provider call.
  if (!apiKey || !/^re_[A-Za-z0-9_-]{16,}$/.test(apiKey) || !from || !downloadUrls || (logoRaw && !logoUrl)) return undefined;
  return { apiKey, from, ...(logoUrl ? { logoUrl } : {}), downloadUrls };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function brandMarkup(logoUrl?: string): string {
  if (logoUrl) return `<img src="${escapeHtml(logoUrl)}" width="132" height="38" alt="Lemtel" style="display:block;max-width:132px;height:auto;border:0;outline:none;text-decoration:none" />`;
  // No network request is made for the fallback mark.
  return `<div role="img" aria-label="Lemtel" style="font-family:Arial,sans-serif;font-size:27px;line-height:38px;font-weight:800;letter-spacing:-1px;color:#10213b">Lem<span style="color:#00a7b5">tel</span></div>`;
}

function link(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" style="color:#007d8a;font-weight:700;text-decoration:none">${escapeHtml(label)}</a>`;
}

/**
 * Generates the only place a temporary password appears: the HTML body sent to the provider.
 * Callers must keep the returned object in memory and must never serialize or audit it.
 */
export function transactionalEmailMessage(input: {
  kind: TransactionalEmailKind;
  locale: LemtelLocale;
  displayName: string;
  email: string;
  temporaryPassword: string;
  config: Pick<TransactionalEmailConfig, "logoUrl" | "downloadUrls">;
}): TransactionalEmailMessage {
  const fr = input.locale === "fr";
  const name = escapeHtml(input.displayName);
  const email = escapeHtml(input.email);
  const password = escapeHtml(input.temporaryPassword);
  const isWelcome = input.kind === "welcome";
  const subject = fr
    ? (isWelcome ? "Bienvenue chez Lemtel — votre accès est prêt" : "Lemtel — votre mot de passe temporaire")
    : (isWelcome ? "Welcome to Lemtel — your access is ready" : "Lemtel — your temporary password");
  const heading = fr
    ? (isWelcome ? `Bienvenue, ${name}` : `Bonjour ${name},`)
    : (isWelcome ? `Welcome, ${name}` : `Hello ${name},`);
  const intro = fr
    ? (isWelcome ? "Votre accès Lemtel est prêt." : "Une demande de réinitialisation de mot de passe a été reçue pour votre compte Lemtel.")
    : (isWelcome ? "Your Lemtel access is ready." : "A password reset request was received for your Lemtel account.");
  const accountLabel = fr ? "Adresse courriel" : "Email address";
  const passwordLabel = fr ? "Mot de passe temporaire" : "Temporary password";
  const instructions = fr
    ? "Ouvrez Lemtel et connectez-vous avec votre adresse courriel et ce mot de passe temporaire. Vous devrez choisir votre propre mot de passe immédiatement."
    : "Open Lemtel and sign in with your email address and this temporary password. You will be required to choose your own password immediately.";
  const safety = fr
    ? "Ne partagez jamais ce mot de passe temporaire. Si vous n’attendiez pas ce courriel, contactez le soutien Lemtel."
    : "Never share this temporary password. If you did not expect this email, contact Lemtel support.";
  const apps = fr ? "Obtenir Lemtel" : "Get Lemtel";
  const links = fr
    ? `${link(input.config.downloadUrls.ios, "iPhone et iPad")} &nbsp;·&nbsp; ${link(input.config.downloadUrls.android, "Android")} &nbsp;·&nbsp; ${link(input.config.downloadUrls.desktop, "Mac et Windows")}`
    : `${link(input.config.downloadUrls.ios, "iPhone & iPad")} &nbsp;·&nbsp; ${link(input.config.downloadUrls.android, "Android")} &nbsp;·&nbsp; ${link(input.config.downloadUrls.desktop, "Mac & Windows")}`;
  return {
    subject,
    html: `<!doctype html><html lang="${input.locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1" /><meta charset="utf-8" /></head><body style="margin:0;padding:0;background:#edf3f7;color:#10213b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf3f7"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden"><tr><td style="height:6px;background:#00a7b5"></td></tr><tr><td style="padding:30px 32px 8px">${brandMarkup(input.config.logoUrl)}</td></tr><tr><td style="padding:8px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"><h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#10213b">${heading}</h1><p style="margin:0 0 22px;font-size:16px;line-height:1.55">${intro}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;background:#f3f8fa;border:1px solid #d7e8eb;border-radius:12px"><tr><td style="padding:18px 20px;font-size:15px;line-height:1.65"><strong>${accountLabel}:</strong> ${email}<br /><strong>${passwordLabel}:</strong> <code style="display:inline-block;margin-top:5px;padding:4px 7px;background:#10213b;color:#ffffff;border-radius:5px;font-size:15px;word-break:break-all">${password}</code></td></tr></table><p style="margin:0 0 24px;font-size:16px;line-height:1.55">${instructions}</p>${isWelcome ? `<h2 style="margin:0 0 10px;font-size:18px;color:#10213b">${apps}</h2><p style="margin:0 0 24px;font-size:15px;line-height:1.6">${links}</p>` : ""}<p style="margin:0;padding-top:18px;border-top:1px solid #d7e8eb;color:#52657b;font-size:13px;line-height:1.55">${safety}</p></td></tr></table></td></tr></table></body></html>`,
  };
}

export async function sendWithResend(
  config: Pick<TransactionalEmailConfig, "apiKey" | "from">,
  recipientEmail: string,
  message: TransactionalEmailMessage,
  send: typeof fetch = fetch,
): Promise<{ accepted: true; providerMessageId?: string } | { accepted: false }> {
  try {
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [recipientEmail], subject: message.subject, html: message.html }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { accepted: false };
    return { accepted: true, ...(typeof payload?.id === "string" && payload.id.length <= 200 ? { providerMessageId: payload.id } : {}) };
  } catch {
    return { accepted: false };
  }
}
