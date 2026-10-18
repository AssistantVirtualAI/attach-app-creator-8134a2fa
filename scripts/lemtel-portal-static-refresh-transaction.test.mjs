import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const journal = resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-portal-static-refresh-transaction.py');
function setup(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const live = join(directory, 'lemtel-portal'); const stage = join(directory, '.stage'); const record = join(directory, 'transaction.json');
  mkdirSync(live); mkdirSync(stage); writeFileSync(join(live, 'state'), 'old'); writeFileSync(join(stage, 'state'), 'new');
  return { directory, live, stage, record };
}

test('durable journal recovers a process interrupted after exchange but before commit', () => {
  const item = setup('lemtel-transaction-recover-');
  try {
    execFileSync('python3', [journal, 'prepare', item.record, item.live, item.stage]);
    execFileSync('python3', [journal, 'swap', item.record, item.live]);
    assert.equal(readFileSync(join(item.live, 'state'), 'utf8'), 'new');
    execFileSync('python3', [journal, 'recover', item.record, item.live]);
    assert.equal(readFileSync(join(item.live, 'state'), 'utf8'), 'old');
    assert.equal(existsSync(item.stage), false);
    assert.equal(existsSync(item.record), false);
  } finally { rmSync(item.directory, { recursive: true, force: true }); }
});

test('durable journal records a successful exchange only after explicit commit and rejects ambiguous state', () => {
  const item = setup('lemtel-transaction-commit-');
  try {
    execFileSync('python3', [journal, 'prepare', item.record, item.live, item.stage]);
    assert.notEqual(spawnSync('python3', [journal, 'commit', item.record, item.live]).status, 0);
    execFileSync('python3', [journal, 'swap', item.record, item.live]);
    execFileSync('python3', [journal, 'commit', item.record, item.live]);
    assert.equal(readFileSync(join(item.live, 'state'), 'utf8'), 'new');
    assert.equal(existsSync(item.record), false);
  } finally { rmSync(item.directory, { recursive: true, force: true }); }
});
