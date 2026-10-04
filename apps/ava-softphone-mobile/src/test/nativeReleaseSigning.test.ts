import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gradle = readFileSync(resolve(process.cwd(), 'android/app/build.gradle'), 'utf8');
const ignore = readFileSync(resolve(process.cwd(), 'android/.gitignore'), 'utf8');

describe('Lemtel Android release signing contract', () => {
  it('keeps signing credentials external and rejects an unconfigured release', () => {
    for (const key of [
      'LEMTEL_ANDROID_KEYSTORE_FILE', 'LEMTEL_ANDROID_STORE_PASSWORD',
      'LEMTEL_ANDROID_KEY_ALIAS', 'LEMTEL_ANDROID_KEY_PASSWORD',
    ]) expect(gradle).toContain(key);
    expect(gradle).not.toMatch(/(?:storePassword|keyPassword)\s+["'][^"']+["']/);
    expect(gradle).not.toMatch(/\bDesktop\/[^\s]+\.jks\b/);
    expect(gradle).toContain('releasePackaging && !releaseSigningReady');
    expect(gradle).toContain("['assembleRelease', 'bundleRelease', 'packageRelease']");
  });

  it('does not commit local keystores or signing properties', () => {
    expect(ignore).toMatch(/^\*\.jks$/m);
    expect(ignore).toMatch(/^\*\.keystore$/m);
    expect(ignore).toMatch(/^keystore\.properties$/m);
  });
});
