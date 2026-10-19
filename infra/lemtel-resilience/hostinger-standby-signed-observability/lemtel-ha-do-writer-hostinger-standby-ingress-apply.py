#!/usr/bin/env python3
"""Root-only, single-run DO-writer transaction for option B (signed Hostinger standby observations, NOT enrolled).

Applies migration 0023, installs the Hostinger standby resource ingress, the role-bound traffic ingress and the
admin projection, then adds ONLY the role-bound Hostinger secret to the Edge runtime by recreating the Edge service
from its own Compose labels plus one new override. Every pre-existing Compose input (including the DO traffic and
DO resource secrets) is reused unchanged, and the reconstructed configuration must reproduce the running
config-hash before anything is changed. Any failure restores the functions and the original Edge configuration.

Never touched: Hostinger, the standby runtime, PostgreSQL promotion/replication, Caddy, DNS, Cloudflare, fencing,
automatic failover, telephony. No secret value is ever printed. Output is a redacted category list only.
"""
import fcntl, hashlib, json, os, re, secrets, stat, subprocess, sys, time
from pathlib import Path

TEST_ROOT = os.environ.get('LEMTEL_HSO_TEST_ROOT')  # Test harness only: prefixes every absolute path.
def P(value: str) -> Path:
    return Path(TEST_ROOT + value) if TEST_ROOT else Path(value)

SOURCE = Path(__file__).resolve().parent
STATE = P('/var/lib/lemtel-ha/hostinger-standby-publisher')
EDGE_CONFIG = STATE / 'edge-config'
EDGE_ENV = EDGE_CONFIG / 'edge-secret.env'
OVERRIDE = EDGE_CONFIG / 'edge-hostinger-standby.override.yaml'
BACKUPS = STATE / 'backups'
LOCK = P('/run/lemtel-hostinger-standby-ingress-apply.lock')
KEY = 'LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET'
PRESERVED_KEYS = ('LEMTEL_TRAFFIC_COLLECTOR_SECRET', 'LEMTEL_DO_WRITER_RESOURCE_SECRET')
EDGE_NAME = 'supabase-edge-functions'
HOST = 'https://lemtel.assistantvirtualai.com'
RESOURCE_INGEST = HOST + '/functions/v1/lemtel-hostinger-standby-resource-ingest'
TRAFFIC_INGEST = HOST + '/functions/v1/lemtel-traffic-ingest'
PACKAGE_FORMAT = 'lemtel_hostinger_standby_ingress_package_v1'
# Exact sources currently live on the writer (verified read-only on 2026-10-18 before this transaction existed).
EXPECTED_LIVE = {
    'lemtel-onboarding-admin': 'b1488d3a44b936f89faac3dce9552af4ef239928101d58e16d61a4195e9e3765',
    'lemtel-traffic-ingest': '62908084ed504ac312e25a408e6a263f93bf62064eff90dc0df68c4f95b30c9e',
}
if TEST_ROOT and os.environ.get('LEMTEL_HSO_TEST_EXPECTED_LIVE'):  # Test harness only: synthetic live sources.
    EXPECTED_LIVE = json.loads(os.environ['LEMTEL_HSO_TEST_EXPECTED_LIVE'])
PACKAGE_FILES = {
    'migration': '0023_lemtel_hostinger_standby_resource_current.sql',
    'lemtel-hostinger-standby-resource-ingest': 'lemtel-hostinger-standby-resource-ingest.index.ts',
    'lemtel-traffic-ingest': 'lemtel-traffic-ingest.index.ts',
    'lemtel-onboarding-admin': 'lemtel-onboarding-admin.index.ts',
}
ENV = {'PATH': os.environ['PATH'] if TEST_ROOT else '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/', 'LANG': 'C',
       'DOCKER_CONFIG': '/proc/self' if not TEST_ROOT else os.environ.get('DOCKER_CONFIG', '/proc/self')}
if TEST_ROOT:  # Test harness only: the fakes need their state file and the root prefix.
    ENV.update({'FAKE_STATE': os.environ['FAKE_STATE'], 'LEMTEL_HSO_TEST_ROOT': TEST_ROOT})

class Refusal(Exception):
    pass

def require(value):
    if not value:
        raise Refusal()

def exists(path: Path) -> bool:
    return os.path.lexists(path)

def identity(meta):
    return (meta.st_dev, meta.st_ino)

def owner_ok(meta) -> bool:
    return meta.st_uid == (os.geteuid() if TEST_ROOT else 0)

def secure_directory(path: Path):
    for item in (path, *path.parents):
        if TEST_ROOT and not str(item).startswith(TEST_ROOT):
            break
        meta = item.lstat()
        require(stat.S_ISDIR(meta.st_mode) and owner_ok(meta) and not meta.st_mode & 0o022)

def secure_file(path: Path, mode=None):
    secure_directory(path.parent)
    meta = path.lstat()
    require(stat.S_ISREG(meta.st_mode) and owner_ok(meta) and meta.st_nlink == 1 and not meta.st_mode & 0o022)
    if mode is not None:
        require(stat.S_IMODE(meta.st_mode) == mode)
    return meta

def read_file(path: Path, limit=2 * 1024 * 1024) -> bytes:
    secure_file(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        value = stream.read(limit + 1)
    require(len(value) <= limit)
    return value

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def command(argv, timeout=120, stdin=None):
    process = subprocess.run(argv, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV, cwd='/', timeout=timeout)
    require(process.returncode == 0 and len(process.stdout) <= 1048576)
    return process.stdout.decode('utf-8', 'strict'), process.stderr.decode('utf-8', 'replace')

def docker_value(template, container):
    out, err = command(['docker', 'inspect', '--format', template, container])
    require(out.endswith('\n') and '\n' not in out[:-1])
    return out[:-1]

def label(container, key):
    return docker_value('{{index .Config.Labels "' + key + '"}}', container)

def env_presence(container, name):
    return docker_value('{{range .Config.Env}}{{if eq (index (split . "=") 0) "' + name + '"}}present{{end}}{{end}}', container) == 'present'

def path_list(value):
    items = [Path(part) for part in value.split(',') if part]
    require(items and len(items) <= 16 and len(set(items)) == len(items) and all(str(p).startswith('/') and '..' not in p.parts for p in items))
    return items

def container_id(name):
    out, _ = command(['docker', 'ps', '-a', '--no-trunc', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}'])
    rows = out.splitlines()
    require(len(rows) == 1 and re.fullmatch(r'[a-f0-9]{64}', rows[0]))
    require(docker_value('{{.State.Running}}', rows[0]) == 'true')
    return rows[0]

def postgres_container():
    out, _ = command(['docker', 'ps', '--format', '{{.Names}}|{{.Image}}'])
    names = [line.split('|', 1)[0] for line in out.splitlines() if re.search(r'(^|/)postgres(:|$)|supabase/postgres(:|$)', line.split('|', 1)[1] if '|' in line else '')]
    require(len(names) == 1)
    return names[0]

def psql(db, sql, stdin=None):
    script = 'export PSQLRC=/dev/null; psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' + ('' if stdin is not None else ' -c "$1"')
    argv = ['docker', 'exec'] + (['-i'] if stdin is not None else []) + [db, 'sh', '-eu', '-c', script, 'sh'] + ([] if stdin is not None else [sql])
    out, _ = command(argv, stdin=stdin)
    return out.strip()

SCHEMA_STATE_SQL = ("WITH objects(present) AS (VALUES (to_regclass('public.lemtel_hostinger_standby_resource_current') IS NOT NULL), "
                    "(to_regprocedure('public.lemtel_record_hostinger_standby_resource_status(timestamp with time zone,smallint,smallint,smallint,integer,integer,integer)') IS NOT NULL)) "
                    "SELECT CASE WHEN count(*) FILTER (WHERE present) = 0 THEN 'absent' WHEN count(*) FILTER (WHERE present) = 2 THEN 'present' ELSE 'partial' END FROM objects")

class Transaction:
    def __init__(self):
        self.phase = 'preflight'; self.guard = 'entry'
        self.created = []; self.directories = []
        self.replaced = {}; self.new_function_dir = None
        self.edge_attempted = False; self.committed = False
        self.migration = 'not_attempted'

    # ---------- preflight (read-only) ----------
    def preflight(self):
        self.guard = 'package_manifest'
        manifest = json.loads(read_file(SOURCE / 'package-manifest.json').decode('utf-8'))
        require(manifest.get('package_format') == PACKAGE_FORMAT and manifest.get('trust_model') == 'signed_publication_not_enrolled')
        require(set(manifest.get('sha256', {})) == set(PACKAGE_FILES) and manifest.get('expected_live') == EXPECTED_LIVE)
        self.package = {}
        for key, name in PACKAGE_FILES.items():
            data = read_file(SOURCE / name)
            require(re.fullmatch(r'[a-f0-9]{64}', manifest['sha256'][key]) is not None and sha(data) == manifest['sha256'][key])
            self.package[key] = data
        require(b'lemtel_hostinger_standby_resource_current' in self.package['migration'])
        require(b'LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET' in self.package['lemtel-traffic-ingest'])
        require(b'get_hostinger_standby_resources' in self.package['lemtel-onboarding-admin'])

        self.guard = 'writer_identity'
        self.db = postgres_container()
        require(psql(self.db, 'SELECT pg_is_in_recovery()::text') == 'false')

        self.guard = 'edge_identity'
        self.edge = container_id(EDGE_NAME)
        self.project = label(self.edge, 'com.docker.compose.project'); self.service = label(self.edge, 'com.docker.compose.service')
        require(re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', self.project) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,62}', self.service))
        require(label(self.edge, 'com.docker.compose.container-number') == '1' and label(self.edge, 'com.docker.compose.oneoff') == 'False')
        self.config_files = [P(str(p)) for p in path_list(label(self.edge, 'com.docker.compose.project.config_files'))]
        self.env_files = [P(str(p)) for p in path_list(label(self.edge, 'com.docker.compose.project.environment_file'))]
        self.workdir = P(label(self.edge, 'com.docker.compose.project.working_dir'))
        self.original_hash = label(self.edge, 'com.docker.compose.config-hash')
        require(re.fullmatch(r'[a-f0-9]{64}', self.original_hash) is not None)
        secure_directory(self.workdir)
        for path in self.config_files: secure_file(path)
        for path in self.env_files: secure_file(path, 0o600)
        require(OVERRIDE not in self.config_files and EDGE_ENV not in self.env_files)

        self.guard = 'edge_reconstruction'
        require(self.config_hash(False) == self.original_hash)  # We reproduce the running Edge exactly, or we stop.

        self.guard = 'edge_secrets'
        require(not env_presence(self.edge, KEY))
        for name in PRESERVED_KEYS: require(env_presence(self.edge, name))

        self.guard = 'edge_sources'
        mount = docker_value('{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Type}}:{{.Source}};{{end}}{{end}}', self.edge)
        require(mount.startswith('bind:') and mount.count(';') == 1 and mount.endswith(';'))
        self.functions = P(mount[5:-1]); secure_directory(self.functions)
        for name, digest in EXPECTED_LIVE.items():
            require(sha(read_file(self.functions / name / 'index.ts')) == digest)
        require(not exists(self.functions / 'lemtel-hostinger-standby-resource-ingest'))

        self.guard = 'initial_absence'
        require(not exists(STATE) and not exists(LOCK))

        self.guard = 'schema_state'
        self.schema_before = psql(self.db, SCHEMA_STATE_SQL)
        require(self.schema_before in ('absent', 'present'))

    def compose(self, with_hostinger):
        argv = ['docker', 'compose', '--project-name', self.project, '--project-directory', str(self.workdir)]
        for path in self.env_files + ([EDGE_ENV] if with_hostinger else []): argv += ['--env-file', str(path)]
        for path in self.config_files + ([OVERRIDE] if with_hostinger else []): argv += ['-f', str(path)]
        return argv

    def config_hash(self, with_hostinger):
        out, _ = command(self.compose(with_hostinger) + ['config', '--hash', self.service])
        parts = out.split()
        require(len(parts) == 2 and parts[0] == self.service and re.fullmatch(r'[a-f0-9]{64}', parts[1]))
        return parts[1]

    # ---------- mutation helpers ----------
    def mkdir(self, path, mode=0o700):
        secure_directory(path.parent); require(not exists(path)); path.mkdir(mode=mode); os.chmod(path, mode)
        self.directories.append(path)

    def create(self, path, data, mode):
        secure_directory(path.parent); require(not exists(path))
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.chmod(path, mode); secure_file(path, mode); self.created.append(path)

    def replace_function(self, name, data):
        target = self.functions / name / 'index.ts'
        meta = secure_file(target)
        backup = BACKUPS / (name + '.index.ts')
        self.create(backup, read_file(target), 0o600)
        temporary = target.with_name('index.ts.lemtel-hostinger-standby')
        require(not exists(temporary))
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, stat.S_IMODE(meta.st_mode))
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IMODE(meta.st_mode))
        os.replace(temporary, target)
        self.replaced[name] = backup
        require(sha(read_file(target)) == sha(data))

    def recreate_edge(self, with_hostinger):
        command(self.compose(with_hostinger) + ['up', '--no-deps', '--force-recreate', '--no-build', '--pull', 'never', '-d', self.service], timeout=240)
        self.edge = container_id(EDGE_NAME)

    def probe(self, url, body, header):
        # A wrong signature must be refused with 401: proves the function is served AND its secret is present (503 otherwise).
        config = '\n'.join(('url = "' + url + '"', 'header = "Content-Type: application/json"', 'header = "' + header + ': sha256=' + '0' * 64 + '"', 'data = "' + body.replace('"', '\\"') + '"')) + '\n'
        deadline = time.monotonic() + 45
        while True:
            process = subprocess.run(['curl', '--config', '-', '--silent', '--request', 'POST', '--proto', '=https', '--max-redirs', '0', '--noproxy', '*',
                                      '--connect-timeout', '5', '--max-time', '15', '--output', '/dev/null', '--write-out', '%{http_code}'],
                                     input=config, text=True, capture_output=True, env=ENV, timeout=25)
            status = process.stdout if process.returncode == 0 else 'transport'
            if status == '401':
                return
            require(status in ('transport', '502', '503', '504') and time.monotonic() < deadline)
            time.sleep(3)

    # ---------- transaction ----------
    def apply(self):
        self.phase = 'apply'
        self.guard = 'state_directories'
        self.mkdir(STATE); self.mkdir(BACKUPS); self.mkdir(EDGE_CONFIG)
        self.create(LOCK, b'', 0o600)
        lock = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW); fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

        self.phase = 'schema'; self.guard = 'migration_0023'
        if self.schema_before == 'absent':
            psql(self.db, None, stdin=self.package['migration']); self.migration = 'applied'
        else:
            self.migration = 'already_present'
        require(psql(self.db, SCHEMA_STATE_SQL) == 'present')

        self.phase = 'edge_sources'; self.guard = 'function_install'
        directory = self.functions / 'lemtel-hostinger-standby-resource-ingest'
        directory.mkdir(mode=0o755); os.chmod(directory, 0o755); self.new_function_dir = directory
        target = directory / 'index.ts'
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(self.package['lemtel-hostinger-standby-resource-ingest']); stream.flush(); os.fsync(stream.fileno())
        os.chmod(target, 0o644)
        self.guard = 'function_replace'
        self.replace_function('lemtel-traffic-ingest', self.package['lemtel-traffic-ingest'])
        self.replace_function('lemtel-onboarding-admin', self.package['lemtel-onboarding-admin'])

        self.phase = 'edge_secret'; self.guard = 'secret_files'
        secret = secrets.token_hex(32); require(re.fullmatch(r'[a-f0-9]{64}', secret) is not None)
        self.create(EDGE_ENV, (KEY + '=' + secret + '\n').encode('ascii'), 0o600); secret = None
        self.create(OVERRIDE, ('services:\n  ' + self.service + ':\n    environment:\n      ' + KEY + ': ${' + KEY + ':?required}\n').encode('ascii'), 0o600)
        self.guard = 'compose_contract'
        require(self.config_hash(False) == self.original_hash)
        command(self.compose(True) + ['config', '--quiet'])

        self.phase = 'edge_recreate'; self.guard = 'edge_recreate'; self.edge_attempted = True
        self.recreate_edge(True)
        self.guard = 'edge_verify'
        expected = ','.join(str(Path(str(p)[len(TEST_ROOT):]) if TEST_ROOT else p) for p in [*self.config_files, OVERRIDE])
        require(label(self.edge, 'com.docker.compose.project.config_files') == expected)
        require(env_presence(self.edge, KEY))
        for name in PRESERVED_KEYS: require(env_presence(self.edge, name))
        command(['docker', 'exec', self.edge, 'sh', '-eu', '-c', 'set +x; v=${' + KEY + '-}; [ "${#v}" -eq 64 ]; case "$v" in *[!0-9a-f]*) exit 1;; esac'])

        self.phase = 'probe'; self.guard = 'resource_ingress_probe'
        observed = time.strftime('%Y-%m-%dT%H:%M:00Z', time.gmtime())
        self.probe(RESOURCE_INGEST, json.dumps({'observedAt': observed, 'cpuPercent': 0, 'memoryPercent': 0, 'diskPercent': 0, 'load1Milli': 0, 'load5Milli': 0, 'load15Milli': 0}, separators=(',', ':')), 'X-Lemtel-Hostinger-Standby-Resource-Signature')
        self.guard = 'traffic_ingress_probe'
        self.probe(TRAFFIC_INGEST, json.dumps({'nodeRole': 'hostinger_standby', 'observedAt': observed, 'periodSeconds': 60, 'rxBytes': 0, 'txBytes': 0, 'tcpEstablished': 0}, separators=(',', ':')), 'X-Lemtel-Traffic-Signature')
        self.committed = True

    def rollback(self):
        complete = True
        def attempt(action):
            nonlocal complete
            try: action()
            except BaseException: complete = False
        for name, backup in self.replaced.items():
            attempt(lambda name=name, backup=backup: (self.functions / name / 'index.ts').write_bytes(read_file(backup)))
        if self.new_function_dir is not None:
            def remove_new():
                if exists(self.new_function_dir / 'index.ts'): (self.new_function_dir / 'index.ts').unlink()
                self.new_function_dir.rmdir()
            attempt(remove_new)
        if self.edge_attempted:
            def restore_edge():
                self.recreate_edge(False)
                require(label(self.edge, 'com.docker.compose.config-hash') == self.original_hash and not env_presence(self.edge, KEY))
            attempt(restore_edge)
        elif self.replaced or self.new_function_dir is not None:
            attempt(lambda: command(['docker', 'restart', '--time', '30', EDGE_NAME]))
        for path in (EDGE_ENV, OVERRIDE):
            if path in self.created and exists(path): attempt(path.unlink)
        if complete:
            # Everything restored and verified: remove this run's backups, lock and directories so a reviewed retry is possible.
            for path in reversed(self.created):
                if exists(path): attempt(path.unlink)
            for path in reversed(self.directories):
                if exists(path): attempt(path.rmdir)
        return complete

def main():
    print('hostinger_standby_ingress_apply_format=lemtel_hostinger_standby_ingress_apply_v1')
    if not TEST_ROOT:
        if os.geteuid() != 0: print('reason=root_required'); return 78
    gates = {'LEMTEL_HA_ROLE': 'digitalocean_writer',
             'LEMTEL_HOSTINGER_STANDBY_INGRESS_EXECUTE': 'apply_verified_hostinger_standby_ingress',
             'LEMTEL_HOSTINGER_STANDBY_SNAPSHOT_ATTESTATION': 'FRESH_WRITER_AND_STANDBY_SNAPSHOTS_VERIFIED'}
    if any(os.environ.get(k) != v for k, v in gates.items()):
        print('hostinger_standby_ingress_apply_status=refused\nreason=gates_required'); return 78
    preflight_only = os.environ.get('LEMTEL_HOSTINGER_STANDBY_INGRESS_MODE') == 'preflight'
    transaction = Transaction()
    try:
        transaction.preflight()
        if preflight_only:
            print('writer=digitalocean_writer\nedge_reconstruction=exact\nschema_0023=' + transaction.schema_before + '\nhostinger_standby_ingress_preflight_status=ready')
            return 0
        transaction.apply()
    except BaseException:
        reason = f'{transaction.phase}_{transaction.guard}'
        complete = transaction.rollback() if transaction.phase != 'preflight' else True
        print('hostinger_standby_ingress_apply_status=failed')
        print('reason=' + (reason if re.fullmatch(r'[a-z0-9_]{1,96}', reason) else 'unknown'))
        print('rollback_status=' + ('complete' if complete else 'incomplete') + '\nschema_0023=' + transaction.migration)
        scope(); return 1
    print('writer=digitalocean_writer\nschema_0023=' + transaction.migration + '\nedge_functions=installed\nedge_hostinger_secret=configured\nedge_existing_secrets=preserved')
    print('resource_ingress_probe=refuses_unsigned\ntraffic_ingress_probe=refuses_unsigned')
    scope(); print('hostinger_standby_ingress_apply_status=complete'); return 0

def scope():
    print('hostinger_contacted=false\nstandby_runtime_started=false\npostgres_promotion_executed=false\ncaddy_changed=false\ncloudflare_or_dns_changed=false\nautomatic_failover_enabled=false\nfencing_executed=false\ntelephony_contacted=false\ncredential_values_emitted=false')

if __name__ == '__main__':
    sys.exit(main())
