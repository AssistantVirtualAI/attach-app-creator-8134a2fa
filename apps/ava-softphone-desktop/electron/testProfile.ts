import path from 'node:path';

/**
 * Explicit local-only test profile for an isolated Desktop sign-in check.
 *
 * Electron resolves its ordinary user-data directory before renderer code is
 * loaded, so the path must be selected in the main process before
 * electron-store is constructed. The flag is intentionally opt-in and never
 * clears or alters the normal user profile.
 */
export const LEMTEL_TEST_PROFILE_FLAG = '--lemtel-test-profile=';

export function resolveLemtelTestProfile(argv: readonly string[] = process.argv): string | null {
  const flag = argv.find((argument) => argument.startsWith(LEMTEL_TEST_PROFILE_FLAG));
  if (!flag) return null;

  const value = flag.slice(LEMTEL_TEST_PROFILE_FLAG.length).trim();
  if (!value || value.includes('\0') || !path.isAbsolute(value)) return null;

  return path.normalize(value);
}
