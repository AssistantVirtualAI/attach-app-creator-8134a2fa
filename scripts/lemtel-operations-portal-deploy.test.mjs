import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../infra/lemtel-resilience/active-passive/lemtel-ha-promoted-writer-operations-portal-deploy.sh", import.meta.url), "utf8");

test("Operations portal deployment is root-gated and transactionally bounded to the promoted writer", () => {
  for (const expected of [
    "[ \"$(id -u)\" -eq 0 ]",
    "deploy_verified_operations_portal",
    "digitalocean_promoted_writer",
    "FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED",
    "portal_archive",
    "tar -xf",
    "pg_is_in_recovery()::text",
    "lemtel_operational_status",
    "caddy adapt",
    "caddy validate",
    "caddy reload",
    "lemtel-ha-promoted-writer-status.timer",
    "operations_portal_deploy_status=complete",
  ]) assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Operations portal deployment never controls topology, DNS, Hostinger or telephony", () => {
  for (const forbidden of [
    /\b(?:doctl|hcloud)\b/i,
    /(?:systemctl|docker)\s+(?:start|restart|run).*hostinger/i,
    /(?:hostinger).*(?:power_on|power_off|shutdown|rebuild|promote)/i,
    /cloudflare\.com|api\/v4\/zones/i,
    /\b(?:iptables|ufw)\b/i,
    /5432/,
    /power_off|power_on|shutdown/i,
  ]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /fusionpbx_or_sip_contacted=false/);
});

test("Operations portal deployment has an automatic rollback for static and function files", () => {
  for (const expected of ["rollback()", "backup_caddy", "backup_function", "portal_replaced", "systemctl disable --now"]) assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
