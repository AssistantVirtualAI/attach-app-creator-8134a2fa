import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflows = [
  '.github/workflows/lemtel-github-artifact-sync.yml',
  '.github/workflows/lemtel-hostinger-client-test-builds.yml',
].map((path) => ({ path, text: fs.readFileSync(path, 'utf8') }));

test('remote artifact delivery fails closed unless the active writer role is declared', () => {
  for (const { path, text } of workflows) {
    assert.match(text, /active-writer-role-gate:/, `${path} must declare a role gate`);
    assert.match(text, /LEMTEL_ACTIVE_WRITER: \$\{\{ vars\.LEMTEL_ACTIVE_WRITER \}\}/, `${path} must read the protected role variable`);
    assert.match(text, /hostinger\|digitalocean\)/, `${path} must allow only known writer roles`);
    assert.match(text, /Missing or unsupported Lemtel active-writer role/, `${path} must reject an unset or unknown role`);
  }
});

test('a promoted DigitalOcean writer never receives a former-standby SSH deposit', () => {
  for (const { path, text } of workflows) {
    assert.match(text, /if: \$\{\{ needs\.active-writer-role-gate\.outputs\.active_writer == 'hostinger' \}\}/, `${path} must gate the DO receiver on a Hostinger writer`);
    assert.match(text, /digitalocean-promoted-writer-boundary:/, `${path} must declare the promoted-writer boundary`);
    assert.match(text, /if: \$\{\{ needs\.active-writer-role-gate\.outputs\.active_writer == 'digitalocean' \}\}/, `${path} must route a promoted DO writer to the boundary job`);
    assert.match(text, /former standby SSH receiver is intentionally not contacted/, `${path} must preserve the writer safety boundary`);
  }
});
