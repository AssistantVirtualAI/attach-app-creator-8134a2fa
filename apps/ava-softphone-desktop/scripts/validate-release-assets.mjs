#!/usr/bin/env node
// Validate both platforms before publishing a single Electron updater release.
// Node-only so the release job can inspect downloaded CI artifacts on Linux.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function sha512(file) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('base64');
}

function manifestEntries(text) {
  return Array.from(text.matchAll(/^\s*-\s*url:\s*(.+?)\r?\n\s*sha512:\s*(.+?)\s*$/gm), ([, rawUrl, rawHash]) => {
    const url = rawUrl.trim().replace(/^['"]|['"]$/g, '');
    const file = basename(decodeURIComponent(url.split(/[?#]/, 1)[0]));
    return { file, hash: rawHash.trim().replace(/^['"]|['"]$/g, '') };
  });
}

export async function validateReleaseAssets(directory, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid package version');
  const files = readdirSync(directory);
  const count = (suffix) => files.filter((file) => file.endsWith(suffix) && file.includes(version)).length;
  if (count('.exe') !== 1 || count('.dmg') !== 2 || count('-mac.zip') !== 2) {
    throw new Error('Expected one signed Windows installer and two macOS DMGs/zips for both architectures');
  }

  for (const [manifest, extension, minimum] of [
    ['latest.yml', '.exe', 1],
    ['latest-mac.yml', '-mac.zip', 2],
  ]) {
    const manifestPath = join(directory, manifest);
    if (!existsSync(manifestPath)) throw new Error(`Missing ${manifest}`);
    const text = readFileSync(manifestPath, 'utf8');
    if (!new RegExp(`^version:\\s*${version.replaceAll('.', '\\.')}\\s*$`, 'm').test(text)) {
      throw new Error(`${manifest}: version does not match the tag`);
    }
    const entries = manifestEntries(text).filter(({ file }) => file.endsWith(extension));
    if (entries.length < minimum) throw new Error(`${manifest}: updater entries missing`);
    for (const { file, hash } of entries) {
      if (file !== basename(file) || !file.includes(version) || !files.includes(file)) {
        throw new Error(`${manifest}: installer referenced by updater is missing: ${file}`);
      }
      const actual = await sha512(join(directory, file));
      if (actual !== hash) throw new Error(`${manifest}: SHA-512 mismatch for ${file}`);
    }
  }
  console.log(`Release assets for ${version}: installers and both updater manifests verified`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateReleaseAssets(process.argv[2], process.argv[3]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
