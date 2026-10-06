import { LemtelError, lemtelClient, portalApi, toLemtelErrorKey } from "./lemtelHostedApi";

/** Only authoritative server-managed app_metadata controls the first-password transition. */
export function needsPersonalPassword(user: unknown): boolean {
  const metadata = (user as { app_metadata?: Record<string, unknown> } | null)?.app_metadata ?? {};
  return metadata.lemtel_onboarding_required === true && metadata.lemtel_email_only_signin === true;
}

/**
 * Delegates the first password change to the Lemtel Edge authority, then creates
 * one fresh session with the chosen password. It never calls auth.updateUser.
 */
export async function completePersonalPassword(email: string, password: string): Promise<void> {
  try {
    await portalApi.completeFirstPassword(password);
  } catch (error) {
    // An idempotent retry can arrive after the first request updated Auth successfully.
    if (!(error instanceof LemtelError) || error.key !== "already_personalized") throw error;
  }
  const client = lemtelClient();
  if (!client) throw new LemtelError("unavailable");
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new LemtelError(toLemtelErrorKey(error?.message, (error as { status?: number } | null)?.status));
  if (needsPersonalPassword(data.user)) throw new LemtelError("unavailable");
}
