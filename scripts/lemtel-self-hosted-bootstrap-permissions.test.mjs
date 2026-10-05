import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DATABASE_SQL_FILES, reviewBootstrapPermissions, run } from './lemtel-self-hosted-bootstrap-permissions.mjs';

function fixture({ envMode = 0o600, sqlMode = 0o644 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lemtel-bootstrap-permissions-'));
  const db = join(root, 'volumes', 'db');
  mkdirSync(db, { recursive: true });
  writeFileSync(join(root, '.env'), 'contents-not-read-by-the-guard\n');
  chmodSync(join(root, '.env'), envMode);
  for (const filename of DATABASE_SQL_FILES) {
    const file = join(db, filename);
    writeFileSync(file, '-- fixture only\n');
    chmodSync(file, sqlMode);
  }
  return root;
}

function withFixture(options, callback) {
  const root = fixture(options);
  try { callback(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('ready bootstrap permissions keep secrets private and SQL readable to the database container', () => {
  withFixture({}, (root) => {
    assert.deepEqual(reviewBootstrapPermissions(root), {
      status: 'bootstrap_permissions_ready',
      authorization: false,
      reasons: ['POLICY_REVIEW_REQUIRED'],
    });
  });
});

test('unsafe .env permissions and unreadable SQL stay blocked with generic findings', () => {
  withFixture({ envMode: 0o644 }, (root) => {
    chmodSync(join(root, 'volumes', 'db', 'webhooks.sql'), 0o600);
    const result = reviewBootstrapPermissions(root);
    assert.equal(result.status, 'bootstrap_permissions_blocked');
    assert.equal(result.authorization, false);
    assert.deepEqual(result.reasons, [
      'env_mode_must_be_0600',
      'db_sql_not_container_readable_webhooks.sql',
      'POLICY_REVIEW_REQUIRED',
    ]);
  });
});

test('missing, writable and symbolic SQL inputs remain blocked', () => {
  withFixture({}, (root) => {
    const db = join(root, 'volumes', 'db');
    rmSync(join(db, 'jwt.sql'));
    chmodSync(join(db, 'logs.sql'), 0o666);
    rmSync(join(db, 'pooler.sql'));
    symlinkSync(join(db, 'realtime.sql'), join(db, 'pooler.sql'));
    const result = reviewBootstrapPermissions(root);
    assert.equal(result.status, 'bootstrap_permissions_blocked');
    assert.deepEqual(result.reasons, [
      'db_sql_missing_jwt.sql',
      'db_sql_group_or_other_writable_logs.sql',
      'db_sql_not_regular_pooler.sql',
      'POLICY_REVIEW_REQUIRED',
    ]);
  });
});

test('CLI emits no root path or file contents and never authorizes deployment', () => {
  withFixture({}, (root) => {
    const result = run([`--root=${root}`]);
    assert.equal(result.code, 78);
    assert.match(result.stdout, /bootstrap_permissions_ready/);
    assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(result.stdout, /contents-not-read/);
    assert.equal(run([], root).code, 2);
  });
});

test('guard source has no content-reading, mutation, network, environment or process-launch capability', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'lemtel-self-hosted-bootstrap-permissions.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:readFile(?:Sync)?|writeFile(?:Sync)?|chmod(?:Sync)?|mkdir(?:Sync)?|rm(?:Sync)?)\b|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfetch\s*\(|\.listen\s*\(|process\.env|node:(?:net|http|https|tls)|\bdocker\b|\bcurl\b|\bwget\b/);
  assert.match(source, /authorization: false/);
  assert.match(source, /code: 78/);
});
