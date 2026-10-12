import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(resolve(root, '.github/workflows/lemtel-github-artifact-sync.yml'), 'utf8');
const guide = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/IMMUTABLE_ARTIFACT_PARITY.md'), 'utf8');

test('immutable artifact workflow builds once and verifies its digest before passive deposit', () => {
  assert.match(workflow, /git archive --format=tar\.gz/u);
  assert.match(workflow, /sha256sum lemtel-artifact\.tgz/u);
  assert.match(workflow, /Verify exact primary artifact checksum/u);
  assert.match(workflow, /Deposit verified artifact on Hostinger recovery receiver without applying it/u);
  assert.match(workflow, /no container, port, DNS or failover action is performed/u);
});

test('artifact-parity guide distinguishes release parity from database and Storage replication', () => {
  assert.match(guide, /même artefact immuable/u);
  assert.match(guide, /ne remplace pas la réplication de données/u);
  assert.match(guide, /sans lui donner le droit d’écrire/u);
  assert.doesNotMatch(guide, /Planiprêt/u);
});
