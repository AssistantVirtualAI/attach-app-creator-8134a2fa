import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEMTEL_TEST_PROFILE_FLAG, resolveLemtelTestProfile } from '../../electron/testProfile';

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../electron/main.ts'), 'utf8');

describe('Lemtel Desktop isolated test profile', () => {
  it('accepts only an explicit absolute test directory', () => {
    const profile = path.resolve('/tmp', 'lemtel-private-profile');
    expect(resolveLemtelTestProfile(['Lemtel', `${LEMTEL_TEST_PROFILE_FLAG}${profile}`])).toBe(profile);
    expect(resolveLemtelTestProfile(['Lemtel'])).toBeNull();
    expect(resolveLemtelTestProfile([`${LEMTEL_TEST_PROFILE_FLAG}relative/profile`])).toBeNull();
    expect(resolveLemtelTestProfile([`${LEMTEL_TEST_PROFILE_FLAG}/tmp/a\0b`])).toBeNull();
  });

  it('applies the selected profile before electron-store is constructed', () => {
    expect(mainSource.indexOf("app.setPath('userData', testProfile)")).toBeGreaterThan(-1);
    expect(mainSource.indexOf("app.setPath('userData', testProfile)")).toBeLessThan(mainSource.indexOf('const store = new Store()'));
    expect(mainSource).toContain('function crashLogPath()');
  });
});
