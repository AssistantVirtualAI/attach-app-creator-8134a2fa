import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sourcePath = "infra/lemtel-resilience/cloudflare-platform-signer/lemtel-public-ca-signed-transfer.py";
const testPath = "infra/lemtel-resilience/cloudflare-platform-signer/lemtel-public-ca-signed-transfer.test.py";
const launcherPath = "infra/lemtel-resilience/cloudflare-platform-signer/lemtel-ha-do-writer-public-ca-signed-transfer.sh";
const source = readFileSync(sourcePath, "utf8");
const launcher = readFileSync(launcherPath, "utf8");

for (const required of [
  "EXPECTED_PIN_FINGERPRINT",
  "os.memfd_create",
  "pass_fds=descriptors",
  "secrets.token_bytes(32)",
  "nonce_consumed",
  "public_ca_receive_authentication=platform_signer_ecdsa",
]) assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
for (const forbidden of ["X-Forwarded-For", "PRIVATE_KEY", "print(jwk", "print(pem", "os.environ[\"LEMTEL_PLATFORM"])
  assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(launcher, /systemd-creds decrypt --name=platform-signing-jwk/);
assert.match(launcher, /https:\/\/\*\.manus\.computer\/ca/);
assert.doesNotMatch(launcher, /curl .*--data|X-Forwarded-For|set -x/);
assert.match(launcher, /\[ "\$\(stat -c '%a' "\$ca"\)" = 644 \] \|\| fail ca_permissions_invalid/);
assert.doesNotMatch(launcher, /\[ "\$\(stat -c '%a' "\$ca"\)" = 600 \] \|\| fail ca_permissions_invalid/);

const output = execFileSync("python3", ["-I", testPath], { encoding: "utf8", timeout: 20_000 });
assert.match(output, /lemtel_signed_public_ca_transfer_integration=passed/);
console.log("lemtel_public_ca_signed_transfer_contract=passed");
