import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateReleaseAssets } from './validate-release-assets.mjs';

const version = '2.5.8';
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-release-'));
  const names = [
    `Lemtel-Telecom-${version}.exe`,
    `Lemtel-Telecom-${version}.dmg`,
    `Lemtel-Telecom-${version}-arm64.dmg`,
    `Lemtel-Telecom-${version}-mac.zip`,
    `Lemtel-Telecom-${version}-arm64-mac.zip`,
  ];
  const hashes = new Map(names.map((name) => {
    const content = `signed artifact ${name}`;
    writeFileSync(join(dir, name), content);
    return [name, createHash('sha512').update(content).digest('base64')];
  }));
  const manifest = (entries) => `version: ${version}\nfiles:\n${entries.map((name) => `  - url: ${name}\n    sha512: ${hashes.get(name)}\n    size: 1`).join('\n')}\n`;
  writeFileSync(join(dir, 'latest.yml'), manifest([names[0]]));
  writeFileSync(join(dir, 'latest-mac.yml'), manifest(names.slice(3)));
  return { dir, names };
}

for (const [title, tamper, error] of [
  ['refuses an absent Windows updater manifest', ({ dir }) => unlinkSync(join(dir, 'latest.yml')), /Missing latest.yml/],
  ['refuses an installer modified after the updater manifest', ({ dir, names }) => writeFileSync(join(dir, names[0]), 'tampered'), /SHA-512 mismatch/],
  ['refuses a release with no arm64 macOS installer', ({ dir, names }) => unlinkSync(join(dir, names[2])), /two macOS DMGs/],
  ['refuses a tag/package version mismatch', ({ dir }) => {
    const path = join(dir, 'latest.yml');
    writeFileSync(path, readFileSync(path, 'utf8').replace(`version: ${version}`, 'version: 2.5.9'));
  }, /version does not match the tag/],
]) {
  test(title, async () => {
    const fixtureData = fixture();
    try {
      tamper(fixtureData);
      await assert.rejects(validateReleaseAssets(fixtureData.dir, version), error);
    } finally {
      rmSync(fixtureData.dir, { recursive: true, force: true });
    }
  });
}

test('accepts complete Windows and universal macOS update artifacts', async () => {
  const { dir } = fixture();
  try {
    await assert.doesNotReject(validateReleaseAssets(dir, version));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
