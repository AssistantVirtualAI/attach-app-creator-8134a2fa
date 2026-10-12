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

test('a promoted DigitalOcean writer preserves its inbound SSH boundary', () => {
  const sourceArtifact = workflows.find(({ path }) => path.endsWith('lemtel-github-artifact-sync.yml'));
  assert.ok(sourceArtifact);
  assert.match(sourceArtifact.text, /digitalocean-artifact:/);
  assert.match(sourceArtifact.text, /if: \$\{\{ needs\.active-writer-role-gate\.outputs\.active_writer == 'hostinger' \}\}/);
  assert.match(sourceArtifact.text, /digitalocean-promoted-writer-boundary:/);
  assert.match(sourceArtifact.text, /inbound SSH receiver is intentionally not contacted/);
  assert.match(sourceArtifact.text, /outbound pull controller/);
});

test('private client-test bundles preserve the promoted-writer boundary', () => {
  const clientBuilds = workflows.find(({ path }) => path.endsWith('lemtel-hostinger-client-test-builds.yml'));
  assert.ok(clientBuilds);
  assert.match(clientBuilds.text, /if: \$\{\{ needs\.active-writer-role-gate\.outputs\.active_writer == 'hostinger' \}\}/);
  assert.match(clientBuilds.text, /digitalocean-promoted-writer-boundary:/);
  assert.match(clientBuilds.text, /former standby SSH receiver is intentionally not contacted/);
});
