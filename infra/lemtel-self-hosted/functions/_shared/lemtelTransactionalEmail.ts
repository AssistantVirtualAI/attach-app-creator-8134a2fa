// Lemtel transactional email primitives. Source-only: never log, persist, or return a temporary password.
export type LemtelLocale = "fr" | "en";
export type TransactionalEmailKind = "welcome" | "password_recovery";
export type EmailEnvironment = { get(name: string): string | undefined };

export type DistributionUrls = { ios: string; android: string; windows: string; macosApple: string; macosIntel: string };
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
const ANDROID_STORE = "https://play.google.com/store/apps/details?id=com.lemtel.softphone";

function trimmed(environment: EmailEnvironment, name: string): string | undefined {
  const value = environment.get(name)?.trim();
  return value || undefined;
}

/** HTTPS only; URLs with credentials, a query, or a fragment are never rendered. */
export function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value || value.length > MAX_URL_LENGTH || /[\u0000-\u001f\u007f\s]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    // Single exception to "no query": a Google Play listing is only addressable as ?id=<application id>.
    const playListing = url.hostname === "play.google.com" && url.pathname === "/store/apps/details" && /^\?id=[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(url.search);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || (url.search && !playListing) || url.hash) return undefined;
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
  // Same variables and defaults as the portal download center (lemtel-onboarding-admin distributionUrls).
  const ios = configured("LEMTEL_DOWNLOAD_IOS_URL", "https://testflight.apple.com");
  const android = configured("LEMTEL_DOWNLOAD_ANDROID_URL", ANDROID_STORE);
  const windows = configured("LEMTEL_DOWNLOAD_WINDOWS_URL", `${RELEASE_TAG}/Lemtel-Telecom-Setup-2.5.20.exe`);
  const macosApple = configured("LEMTEL_DOWNLOAD_MACOS_APPLE_URL", `${RELEASE_TAG}/Lemtel-Telecom-2.5.20-arm64.dmg`);
  const macosIntel = configured("LEMTEL_DOWNLOAD_MACOS_INTEL_URL", `${RELEASE_TAG}/Lemtel-Telecom-2.5.20-x64.dmg`);
  return ios && android && windows && macosApple && macosIntel ? { ios, android, windows, macosApple, macosIntel } : undefined;
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

// Email images: PNG only (Gmail and Outlook do not render SVG), immutable (pinned commit), overridable per deployment.
const EMAIL_ASSET_BASE = "https://raw.githubusercontent.com/AssistantVirtualAI/attach-app-creator-8134a2fa/aab93f43c79dc86e0295ad5fc8ae481c60dbaf31/public/email";
export const EMAIL_ASSETS = Object.freeze({
  mark: `${EMAIL_ASSET_BASE}/lemtel-mark-112.png`,
  phone: `${EMAIL_ASSET_BASE}/icon-phone.png`,
  desktop: `${EMAIL_ASSET_BASE}/icon-desktop.png`,
  laptop: `${EMAIL_ASSET_BASE}/icon-laptop.png`,
});
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const NAVY = "#0b1730", NAVY_2 = "#163a6b", GOLD = "#f4b740", INK = "#0f1d33", INK_2 = "#55657d", LINE = "#e3e9f2";

function brandMarkup(logoUrl?: string): string {
  const src = escapeHtml(logoUrl ?? EMAIL_ASSETS.mark);
  return `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="vertical-align:middle;padding-right:14px"><img src="${src}" width="52" height="52" alt="Lemtel" style="display:block;width:52px;height:52px;border:0;border-radius:12px" /></td><td style="vertical-align:middle;${FONT}"><div style="font-size:26px;line-height:28px;font-weight:800;letter-spacing:-0.5px;color:#ffffff">Lemtel</div><div style="font-size:12px;line-height:16px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${GOLD}">Communications</div></td></tr></table>`;
}


function storeButton(url: string, icon: string, small: string, big: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="background:${NAVY};border-radius:12px"><a href="${escapeHtml(url)}" style="display:block;padding:11px 14px;text-decoration:none;color:#ffffff"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="vertical-align:middle;padding-right:11px"><img src="${escapeHtml(icon)}" width="26" height="26" alt="" style="display:block;width:26px;height:26px;border:0" /></td><td style="vertical-align:middle;${FONT}"><div style="font-size:11px;line-height:14px;color:#b9c7dd">${escapeHtml(small)}</div><div style="font-size:16px;line-height:20px;font-weight:700;color:#ffffff">${escapeHtml(big)}</div></td></tr></table></a></td></tr></table>`;
}

function downloadGrid(urls: DistributionUrls, fr: boolean): string {
  const cell = (content: string, width: string) => `<td width="${width}" style="padding:5px;vertical-align:top">${content}</td>`;
  const mobile = [
    storeButton(urls.ios, EMAIL_ASSETS.phone, fr ? "iPhone et iPad" : "iPhone & iPad", "App Store"),
    storeButton(urls.android, EMAIL_ASSETS.phone, "Android", "Google Play"),
  ];
  const desktop = [
    storeButton(urls.windows, EMAIL_ASSETS.desktop, fr ? "Ordinateur" : "Computer", "Windows"),
    storeButton(urls.macosApple, EMAIL_ASSETS.laptop, fr ? "Mac · puce Apple" : "Mac · Apple silicon", "macOS"),
    storeButton(urls.macosIntel, EMAIL_ASSETS.laptop, "Mac · Intel", "macOS"),
  ];
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 -5px"><tr>${mobile.map((b) => cell(b, "50%")).join("")}</tr></table>`
    + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 -5px"><tr>${desktop.map((b) => cell(b, "33%")).join("")}</tr></table>`;
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
    ? (isWelcome ? "Votre accès Lemtel est prêt. Voici vos informations de connexion." : "Une demande de réinitialisation de mot de passe a été reçue pour votre compte Lemtel.")
    : (isWelcome ? "Your Lemtel access is ready. Here are your sign-in details." : "A password reset request was received for your Lemtel account.");
  const accountLabel = fr ? "Adresse courriel" : "Email address";
  const passwordLabel = fr ? "Mot de passe temporaire" : "Temporary password";
  const instructions = fr
    ? "Ouvrez Lemtel et connectez-vous avec votre adresse courriel et ce mot de passe temporaire. Vous devrez choisir votre propre mot de passe immédiatement."
    : "Open Lemtel and sign in with your email address and this temporary password. You will be required to choose your own password immediately.";
  const safety = fr
    ? "Ne partagez jamais ce mot de passe temporaire. Si vous n’attendiez pas ce courriel, contactez le soutien Lemtel."
    : "Never share this temporary password. If you did not expect this email, contact Lemtel support.";
  const apps = fr ? "Obtenir Lemtel" : "Get Lemtel";
  const appsIntro = fr ? "Installez l’application sur vos appareils :" : "Install the app on your devices:";
  const steps = fr
    ? ["Installez l’application Lemtel ci-dessous.", "Connectez-vous avec votre courriel et le mot de passe temporaire.", "Choisissez votre mot de passe personnel."]
    : ["Install the Lemtel app below.", "Sign in with your email and the temporary password.", "Choose your own password."];
  const stepRows = steps.map((step, index) => `<tr><td style="vertical-align:top;padding:0 12px 10px 0"><div style="width:26px;height:26px;line-height:26px;border-radius:13px;background:${GOLD};color:${NAVY};font-weight:800;font-size:13px;text-align:center;${FONT}">${index + 1}</div></td><td style="vertical-align:top;padding:3px 0 10px;font-size:15px;line-height:21px;color:${INK};${FONT}">${escapeHtml(step)}</td></tr>`).join("");
  const welcomeBlocks = isWelcome
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 18px">${stepRows}</table>`
      + `<h2 style="margin:8px 0 6px;font-size:18px;line-height:24px;color:${INK};${FONT}">${apps}</h2><p style="margin:0 0 12px;font-size:14px;line-height:20px;color:${INK_2};${FONT}">${appsIntro}</p>`
      + downloadGrid(input.config.downloadUrls, fr)
    : `<p style="margin:0;font-size:15px;line-height:23px;color:${INK};${FONT}">${instructions}</p>`;
  return {
    subject,
    html: `<!doctype html><html lang="${input.locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1" /><meta charset="utf-8" /><meta name="color-scheme" content="light only" /><title>${escapeHtml(subject)}</title></head>`
      + `<body style="margin:0;padding:0;background:#eef2f8;color:${INK}"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(intro)}</div>`
      + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f8"><tr><td align="center" style="padding:28px 12px">`
      + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(11,23,48,0.12)">`
      + `<tr><td style="background:${NAVY};background-image:linear-gradient(135deg,${NAVY} 0%,${NAVY_2} 100%);padding:26px 32px">${brandMarkup(input.config.logoUrl)}</td></tr>`
      + `<tr><td style="height:4px;line-height:4px;font-size:0;background:${GOLD}">&nbsp;</td></tr>`
      + `<tr><td style="padding:32px 32px 8px;${FONT}"><h1 style="margin:0 0 10px;font-size:26px;line-height:32px;font-weight:800;color:${INK}">${heading}</h1><p style="margin:0 0 22px;font-size:16px;line-height:24px;color:${INK_2}">${intro}</p>`
      + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;background:#f6f8fc;border:1px solid ${LINE};border-radius:14px"><tr><td style="padding:18px 20px">`
      + `<div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${INK_2}">${accountLabel}</div><div style="margin:2px 0 14px;font-size:16px;line-height:22px;font-weight:600;color:${INK};word-break:break-all">${email}</div>`
      + `<div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${INK_2}">${passwordLabel}</div><div style="margin-top:6px"><code style="display:inline-block;padding:8px 14px;background:#fff8e6;border:1px solid ${GOLD};border-radius:8px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:19px;line-height:24px;letter-spacing:1px;color:${NAVY};word-break:break-all">${password}</code></div>`
      + `</td></tr></table>${welcomeBlocks}</td></tr>`
      + `<tr><td style="padding:22px 32px 28px;${FONT}"><p style="margin:0;padding-top:18px;border-top:1px solid ${LINE};font-size:13px;line-height:19px;color:${INK_2}">${safety}</p><p style="margin:12px 0 0;font-size:12px;line-height:18px;color:#8a97ab">Lemtel Communications · ${fr ? "Propulsé par AVA" : "Powered by AVA"}</p></td></tr>`
      + `</table></td></tr></table></body></html>`,
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
