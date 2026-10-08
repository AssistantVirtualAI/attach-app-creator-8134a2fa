#!/usr/bin/env node
// Validate only the signed platforms that a Desktop release actually publishes.
// Node-only so the release job can inspect downloaded CI artifacts on Linux.
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

async function sha512(file) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("base64");
}

function manifestEntries(text) {
  return Array.from(
    text.matchAll(/^\s*-\s*url:\s*(.+?)\r?\n\s*sha512:\s*(.+?)\s*$/gm),
    ([, rawUrl, rawHash]) => {
      const url = rawUrl.trim().replace(/^['"]|['"]$/g, "");
      const file = basename(decodeURIComponent(url.split(/[?#]/, 1)[0]));
      return { file, hash: rawHash.trim().replace(/^['"]|['"]$/g, "") };
    },
  );
}

function releaseMode(mode) {
  if (mode === "all")
    return { requiresWindows: true, label: "Windows and macOS" };
  if (mode === "macos") return { requiresWindows: false, label: "macOS only" };
  throw new Error("Release mode must be all or macos");
}

export async function validateReleaseAssets(directory, version, mode = "all") {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Invalid package version");
  const { requiresWindows, label } = releaseMode(mode);
  const files = readdirSync(directory);
  const count = (suffix) =>
    files.filter((file) => file.endsWith(suffix) && file.includes(version))
      .length;

  if (count(".dmg") !== 2 || count("-mac.zip") !== 2) {
    throw new Error(
      "Expected two signed macOS DMGs and two macOS ZIPs for both architectures",
    );
  }

  const windowsInstallers = count(".exe");
  if (requiresWindows && windowsInstallers !== 1) {
    throw new Error("Expected one signed Windows installer");
  }
  if (!requiresWindows && windowsInstallers !== 0) {
    throw new Error("macOS-only release must not contain a Windows installer");
  }

  const manifests = [["latest-mac.yml", "-mac.zip", 2]];
  if (requiresWindows) manifests.unshift(["latest.yml", ".exe", 1]);

  for (const [manifest, extension, minimum] of manifests) {
    const manifestPath = join(directory, manifest);
    if (!existsSync(manifestPath)) throw new Error(`Missing ${manifest}`);
    const text = readFileSync(manifestPath, "utf8");
    if (
      !new RegExp(
        `^version:\\s*${version.replaceAll(".", "\\.")}\\s*$`,
        "m",
      ).test(text)
    ) {
      throw new Error(`${manifest}: version does not match the tag`);
    }
    const entries = manifestEntries(text).filter(({ file }) =>
      file.endsWith(extension),
    );
    if (entries.length < minimum)
      throw new Error(`${manifest}: updater entries missing`);
    for (const { file, hash } of entries) {
      if (
        file !== basename(file) ||
        !file.includes(version) ||
        !files.includes(file)
      ) {
        throw new Error(
          `${manifest}: installer referenced by updater is missing: ${file}`,
        );
      }
      const actual = await sha512(join(directory, file));
      if (actual !== hash)
        throw new Error(`${manifest}: SHA-512 mismatch for ${file}`);
    }
  }
  console.log(
    `Release assets for ${version}: ${label} installers and updater manifests verified`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  validateReleaseAssets(
    process.argv[2],
    process.argv[3],
    process.argv[4],
  ).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
