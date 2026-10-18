import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const helper = resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-verified-portal-zip.py');

function makeZip(directory, script) {
  const archive = join(directory, 'portal.zip');
  execFileSync('python3', ['-c', script, archive]);
  return archive;
}
const validZip = `import sys, zipfile
z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)
z.writestr('lemtel-portal.html','<!doctype html>')
z.writestr('assets/app.js','console.info(1)')
z.close()`;

test('verified portal ZIP validator extracts only bounded regular files with Caddy-readable modes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lemtel-safe-zip-'));
  try {
    const archive = makeZip(directory, validZip);
    const destination = join(directory, 'destination');
    mkdirSync(destination, { mode: 0o755 });
    execFileSync('python3', [helper, '--validate', archive]);
    execFileSync('python3', [helper, '--extract', archive, destination]);
    assert.match(readFileSync(join(destination, 'lemtel-portal.html'), 'utf8'), /doctype/);
    assert.equal(statSync(join(destination, 'assets')).mode & 0o777, 0o755);
    assert.equal(statSync(join(destination, 'assets/app.js')).mode & 0o777, 0o644);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('verified portal ZIP validator rejects traversal, symlink and unbounded expanded content before extraction', () => {
  const cases = [
    `import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('../outside','x'); z.writestr('lemtel-portal.html','x'); z.writestr('assets/app.js','x'); z.close()`,
    `import sys,zipfile,stat; z=zipfile.ZipFile(sys.argv[1],'w'); i=zipfile.ZipInfo('assets/link.js'); i.create_system=3; i.external_attr=(stat.S_IFLNK|0o777)<<16; z.writestr(i,'/etc/passwd'); z.writestr('lemtel-portal.html','x'); z.close()`,
    `import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED); z.writestr('lemtel-portal.html','x'); z.writestr('assets/app.js','x'*(25*1024*1024+1)); z.close()`,
  ];
  const directory = mkdtempSync(join(tmpdir(), 'lemtel-unsafe-zip-'));
  try {
    for (const [index, script] of cases.entries()) {
      const archive = join(directory, `case-${index}.zip`);
      execFileSync('python3', ['-c', script, archive]);
      const result = spawnSync('python3', [helper, '--validate', archive]);
      assert.notEqual(result.status, 0, String(index));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
