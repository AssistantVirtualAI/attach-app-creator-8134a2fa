// Offline fakes for the failback scripts: docker (containers, SQL answers, basebackup), systemctl, ip, ss, curl,
// age, chown, sleep. State lives under the test root; every docker call is logged in order.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DOCKER = readFileSync(new URL('./lemtel-failback-fake-docker.sh', import.meta.url), 'utf8');

export function world({ sql = [], clientSql = [], files = {}, containers = {}, projects = {}, ss = '', curl = '200' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lemtel-fb-'));
  const bin = join(root, 'bin'), fake = join(root, 'fake');
  for (const dir of [bin, fake, join(fake, 'containers'), join(root, 'var/tmp'), join(root, 'run'), join(root, 'opt/lemtel-ha/postgres/data')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'opt/lemtel-ha/postgres/data/PG_VERSION'), '17\n');
  writeFileSync(join(fake, 'sql'), sql.map(([p, a]) => `${p}|${a}`).join('\n') + '\n');
  writeFileSync(join(fake, 'client-sql'), clientSql.map(([p, a]) => `${p}|${a}`).join('\n') + '\n');
  for (const [name, c] of Object.entries(containers)) {
    const dir = join(fake, 'containers', name); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'running'), `${c.running ?? true}\n`);
    writeFileSync(join(dir, 'image'), `${c.image ?? 'supabase/postgres:17.6.1.136'}\n`);
    writeFileSync(join(dir, 'mount'), `${c.mount ?? '/opt/lemtel-ha/postgres/data'}\n`);
    if (c.env) writeFileSync(join(dir, 'env'), c.env);
    if (c.networks) writeFileSync(join(dir, 'networks'), c.networks);
  }
  for (const [project, ids] of Object.entries(projects)) {
    writeFileSync(join(fake, `project-${project}-running`), (ids.running || []).map((i) => `${i}\n`).join(''));
    writeFileSync(join(fake, `project-${project}-all`), (ids.all || ids.running || []).map((i) => `${i}\n`).join(''));
  }
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path); mkdirSync(join(full, '..'), { recursive: true });
    if (content === null) mkdirSync(full, { recursive: true }); else writeFileSync(full, content.text ?? content, { mode: content.mode ?? 0o600 });
    if (content?.mode) chmodSync(full, content.mode);
  }
  const tool = (name, body) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  writeFileSync(join(bin, 'docker'), DOCKER); chmodSync(join(bin, 'docker'), 0o755);
  tool('systemctl', `echo "systemctl $*" >> "${fake}/log"; case "$1" in is-active) exit 0;; esac; exit 0`);
  tool('ip', `case "$*" in *docker0*) echo "4: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0";; *br-abcdef012345*) echo "7: br-abcdef012345    inet 172.19.0.1/16 scope global br-abcdef012345";; *) echo "lemtel-ha0 UNKNOWN 10.253.47.1/30 10.253.47.2/30";; esac`);
  tool('ss', `cat "${fake}/ss" 2>/dev/null`);
  writeFileSync(join(fake, 'ss'), ss);
  tool('curl', `echo "curl $*" >> "${fake}/log"; printf '%s' '${curl}'`);
  tool('age', `printf 'abcdef0123456789'`);
  tool('chown', `exit 0`);
  tool('sleep', `exit 0`);
  tool('socat', `exit 0`);
  // ufw: "inactive" unless the test writes fake/ufw-active; rules kept in fake/ufw-rules.
  tool('ufw', `echo "ufw $*" >> "${fake}/log"
case "$1" in
  status) if [ -f "${fake}/ufw-active" ]; then echo "Status: active"; cat "${fake}/ufw-rules" 2>/dev/null; else echo "Status: inactive"; fi ;;
  allow) echo "[ 9] 10.253.47.1 5432/tcp on lemtel-ha0      ALLOW IN    10.253.47.2                # Lemtel failback relay" >> "${fake}/ufw-rules" ;;
  delete) rm -f "${fake}/ufw-rules" ;;
esac
exit 0`);
  tool('apt-get', `exit 0`);
  const run = (script, args = [], env = {}, input = undefined) => spawnSync('bash', [script, ...args], { encoding: 'utf8', input,
    env: { PATH: `${bin}:${process.env.PATH}`, LEMTEL_FB_TEST_ROOT: root, ...env } });
  const read = (name) => existsSync(join(fake, name)) ? readFileSync(join(fake, name), 'utf8') : '';
  const containerNames = () => readdirSync(join(fake, 'containers'));
  return { root, fake, run, read, log: () => read('log'), containerNames, flag: (name) => writeFileSync(join(fake, name), '') };
}
