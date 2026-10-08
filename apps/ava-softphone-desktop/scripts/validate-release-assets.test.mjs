import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateReleaseAssets } from "./validate-release-assets.mjs";

const version = "2.5.11";

function fixture({ windows = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "desktop-release-"));
  const macNames = [
    `Lemtel-Telecom-${version}.dmg`,
    `Lemtel-Telecom-${version}-arm64.dmg`,
    `Lemtel-Telecom-${version}-mac.zip`,
    `Lemtel-Telecom-${version}-arm64-mac.zip`,
  ];
  const names = windows
    ? [`Lemtel-Telecom-${version}.exe`, ...macNames]
    : macNames;
  const hashes = new Map(
    names.map((name) => {
      const content = `signed artifact ${name}`;
      writeFileSync(join(dir, name), content);
      return [name, createHash("sha512").update(content).digest("base64")];
    }),
  );
  const manifest = (entries) =>
    `version: ${version}\nfiles:\n${entries
      .map(
        (name) =>
          `  - url: ${name}\n    sha512: ${hashes.get(name)}\n    size: 1`,
      )
      .join("\n")}\n`;

  if (windows) writeFileSync(join(dir, "latest.yml"), manifest([names[0]]));
  writeFileSync(
    join(dir, "latest-mac.yml"),
    manifest(macNames.filter((name) => name.endsWith("-mac.zip"))),
  );
  return { dir, names, macNames };
}

for (const [title, tamper, error] of [
  [
    "refuses an absent Windows updater manifest for a universal release",
    ({ dir }) => unlinkSync(join(dir, "latest.yml")),
    /Missing latest.yml/,
  ],
  [
    "refuses an installer modified after the updater manifest",
    ({ dir, names }) => writeFileSync(join(dir, names[0]), "tampered"),
    /SHA-512 mismatch/,
  ],
  [
    "refuses a release with no arm64 macOS installer",
    ({ dir, macNames }) => unlinkSync(join(dir, macNames[1])),
    /two signed macOS DMGs/,
  ],
  [
    "refuses a tag/package version mismatch",
    ({ dir }) => {
      const path = join(dir, "latest-mac.yml");
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          `version: ${version}`,
          "version: 2.5.12",
        ),
      );
    },
    /version does not match the tag/,
  ],
]) {
  test(title, async () => {
    const fixtureData = fixture();
    try {
      tamper(fixtureData);
      await assert.rejects(
        validateReleaseAssets(fixtureData.dir, version),
        error,
      );
    } finally {
      rmSync(fixtureData.dir, { recursive: true, force: true });
    }
  });
}

test("accepts complete Windows and universal macOS update artifacts", async () => {
  const { dir } = fixture();
  try {
    await assert.doesNotReject(validateReleaseAssets(dir, version));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accepts a signed macOS-only release without a Windows installer", async () => {
  const { dir } = fixture({ windows: false });
  try {
    await assert.doesNotReject(validateReleaseAssets(dir, version, "macos"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses a macOS-only release when a Windows installer is present", async () => {
  const { dir } = fixture();
  try {
    await assert.rejects(
      validateReleaseAssets(dir, version, "macos"),
      /must not contain a Windows installer/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
