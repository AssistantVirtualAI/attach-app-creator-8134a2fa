import { createPrivateKey, sign } from "node:crypto";

const API_ORIGIN = "https://api.appstoreconnect.apple.com";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function apiToken({ issuerId, keyId, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ aud: "appstoreconnect-v1", exp: now + 15 * 60, iss: issuerId }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    dsaEncoding: "ieee-p1363",
    key: createPrivateKey(privateKey.replace(/\\n/g, "\n")),
  });
  return `${unsigned}.${base64url(signature)}`;
}

async function appleRequest(path, token, options = {}) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    let code = "unknown";
    try {
      const body = await response.json();
      code = body?.errors?.[0]?.code || body?.errors?.[0]?.title || code;
    } catch {
      // Do not print response contents; error bodies may carry operational detail.
    }
    throw new Error(`App Store Connect request failed: ${response.status} (${code})`);
  }

  return response.status === 204 ? null : response.json();
}

const appId = required("TESTFLIGHT_APP_ID");
const groupName = required("TESTFLIGHT_GROUP_NAME");
const marketingVersion = required("TESTFLIGHT_MARKETING_VERSION");
const buildVersion = required("TESTFLIGHT_BUILD_VERSION");

if (appId !== "6786177551") throw new Error("Unexpected TestFlight application");
if (groupName !== "Lemtel Internal") throw new Error("Unexpected TestFlight group");
if (!/^1\.\d{1,2}$/.test(marketingVersion)) throw new Error("Unexpected Lemtel marketing version");
if (!/^[1-9]\d*$/.test(buildVersion)) throw new Error("Invalid TestFlight build number");

const token = apiToken({
  issuerId: required("APPSTORE_ISSUER_ID"),
  keyId: required("APPSTORE_API_KEY_ID"),
  privateKey: required("APPSTORE_API_PRIVATE_KEY"),
});

const buildQuery = new URLSearchParams({
  "filter[app]": appId,
  "filter[version]": buildVersion,
  "filter[preReleaseVersion.version]": marketingVersion,
  "filter[processingState]": "VALID",
  limit: "2",
});
const builds = await appleRequest(`/v1/builds?${buildQuery.toString()}`, token);
if (!Array.isArray(builds.data) || builds.data.length !== 1) {
  throw new Error("Expected exactly one processed Lemtel build");
}
const build = builds.data[0];
if (build.attributes?.processingState !== "VALID") {
  throw new Error("Lemtel build is not yet VALID for internal distribution");
}

const betaGroups = await appleRequest(`/v1/apps/${appId}/betaGroups?limit=200`, token);
const group = betaGroups.data?.find((item) => item.attributes?.name === groupName);
if (!group) throw new Error("Required Lemtel Internal beta group was not found");

const currentGroups = await appleRequest(`/v1/builds/${build.id}/betaGroups?limit=200`, token);
const alreadyAssigned = currentGroups.data?.some((item) => item.id === group.id);

if (!alreadyAssigned) {
  await appleRequest(`/v1/betaGroups/${group.id}/relationships/builds`, token, {
    method: "POST",
    body: JSON.stringify({ data: [{ id: build.id, type: "builds" }] }),
  });
}

const verifiedGroups = await appleRequest(`/v1/builds/${build.id}/betaGroups?limit=200`, token);
if (!verifiedGroups.data?.some((item) => item.id === group.id)) {
  throw new Error("Lemtel Internal assignment did not verify");
}

console.log(`testflight_group_assignment=${alreadyAssigned ? "already_present" : "complete"}`);
console.log(`testflight_group_name=${groupName}`);
console.log(`testflight_build=${marketingVersion} (${buildVersion})`);
