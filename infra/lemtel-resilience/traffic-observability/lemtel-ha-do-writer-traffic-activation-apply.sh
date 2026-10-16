#!/usr/bin/env bash
# Source-only package: explicit local operator activation, never a build/install hook.
set +x
set -euo pipefail
umask 077
safe_scope() {
  printf 'hostinger_contacted=false\ncloudflare_or_dns_changed=false\nautomatic_failover_enabled=false\nfencing_executed=false\ntelephony_contacted=false\ncredential_values_emitted=false\n'
}
fail() {
  trap - ERR
  printf 'traffic_activation_status=failed\nreason=%s\nrollback_status=not_required\n' "$1"
  safe_scope
  exit 78
}
trap 'fail entry_refused' ERR
[[ "$EUID" -eq 0 ]] || fail root_required
[[ "$#" -eq 0 ]] || fail invalid_arguments
[[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ]] || fail writer_role_required
[[ "${LEMTEL_TRAFFIC_ACTIVATION_EXECUTE:-}" = activate_verified_do_writer_traffic_transaction ]] || fail intent_required
[[ "${LEMTEL_TRAFFIC_ACTIVATION_SNAPSHOT_ATTESTATION:-}" = FRESH_ENCRYPTED_DO_WRITER_SNAPSHOT_CREATED_AND_RESTORE_REVIEWED ]] || fail fresh_encrypted_snapshot_required
[[ "${LEMTEL_TRAFFIC_ACTIVATION_BACKUP_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED ]] || fail fresh_backup_required
[[ "${LEMTEL_TRAFFIC_ACTIVATION_PACKAGE_REVIEW:-}" = REVIEWED_DO_WRITER_TRAFFIC_TRANSACTION ]] || fail package_review_required
[[ "${LEMTEL_TRAFFIC_ACTIVATION_ROLLBACK_ATTESTATION:-}" = DO_WRITER_TRAFFIC_ROLLBACK_REVIEWED ]] || fail rollback_review_required
[[ "${LEMTEL_TRAFFIC_EDGE_LOG_ATTESTATION:-}" = EDGE_AND_ROUTE_ACCESS_LOGS_DISABLED_VERIFIED ]] || fail access_log_review_required
[[ "${LEMTEL_TRAFFIC_ACTIVATION_REVIEW_APPROVED:-}" = REVIEWED_LOCAL_COLLECTOR_ACTIVATION ]] || fail activation_review_required
[[ "${LEMTEL_TRAFFIC_ACTIVATION_SCHEMA_ATTESTATION:-}" = INACTIVE_TRAFFIC_SCHEMA_AND_RBAC_VERIFIED ]] || fail inactive_schema_review_required
[[ -x /usr/bin/python3 ]] || fail local_runtime_required
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
trap - ERR
# No credential enters shell variables, argv, or a child-process environment.
exec /usr/bin/python3 - "$source_dir" 2>/dev/null <<'PY'
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import subprocess
import sys
import tempfile

os.umask(0o077)
SOURCE = Path(sys.argv[1])
CONFIG = Path('/etc/lemtel-ha/traffic-collector.env')
STATE = Path('/var/lib/lemtel-traffic-collector')
LIB = Path('/usr/local/libexec/lemtel-traffic')
TIMER = Path('/etc/systemd/system/lemtel-traffic-collector.timer')
SERVICE = Path('/etc/systemd/system/lemtel-traffic-collector.service')
WANTS = Path('/etc/systemd/system/timers.target.wants/lemtel-traffic-collector.timer')
ROOT = Path('/var/lib/lemtel-ha/traffic-observability')
ROUTE_BACKUPS = ROOT / 'caddy-backups'
EDGE_CONFIG = ROOT / 'edge-config'
LOCK = Path('/run/lemtel-traffic-activation.lock')
ROUTE_LOCK = Path('/run/lock/lemtel-traffic-ingress-route.lock')
CANONICAL_HOST = 'lemtel.assistantvirtualai.com'
INGRESS_PATH = '/functions/v1/lemtel-traffic-ingest'
KEY = 'LEMTEL_TRAFFIC_COLLECTOR_SECRET'
SCHEMA_SOURCE = Path('/home/lemtelops/lemtel-traffic-observability-deployment/0017_lemtel_traffic_samples.sql')
HELPERS = {
    'lemtel-ha-do-writer-traffic-runtime-preflight.sh': '7c3301b8b45fc684e703166f2c141e97f3e6aeebb92e60252f14fb7e2ec56744',
    'lemtel-ha-do-writer-traffic-ingress-route-apply.sh': 'e6862ae72055798259527a89dfa8c97118f273827fe6d0ae53ba7556ab715157',
    'lemtel-traffic-collect.sh': '282cc7c32fadf9c2cca5ed42aafc6cfe438fa77e1253663b748fcd24af5c27f6',
    'lemtel-traffic-timer-enable.sh': '1c6fb338ef29698cb90c66905415014eae63172aac3b788f498cfb2f0398ccf8',
}
# Force only the local socket, no inherited Docker context, proxy, credential or interpolation environment.
# /proc/self has no Docker client config; it cannot contain a saved remote context.
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/', 'LANG': 'C',
       'DOCKER_CONFIG': '/proc/self', 'DOCKER_HOST': 'unix:' + '///var/run/docker.sock'}
SCOPE = ('hostinger_contacted=false', 'cloudflare_or_dns_changed=false',
         'automatic_failover_enabled=false', 'fencing_executed=false',
         'telephony_contacted=false', 'credential_values_emitted=false')

class Refusal(Exception):
    pass

def require(condition):
    if not condition:
        raise Refusal()

def exists(path):
    return os.path.lexists(path)

def identity(metadata):
    return metadata.st_dev, metadata.st_ino

def secure_directory(path):
    for parent in (path, *path.parents):
        metadata = parent.lstat()
        require(stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == 0 and not metadata.st_mode & 0o022)

def future_directory(path):
    while not exists(path):
        path = path.parent
    secure_directory(path)

def secure_file(path, mode=None, parents=True):
    if parents:
        secure_directory(path.parent)
    metadata = path.lstat()
    require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_nlink == 1
            and not metadata.st_mode & 0o022 and (mode is None or stat.S_IMODE(metadata.st_mode) == mode))
    return metadata

def read_protected(path, mode=None, limit=1048576):
    metadata = secure_file(path, mode)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        require(identity(os.fstat(stream.fileno())) == identity(metadata))
        data = stream.read(limit + 1)
        require(len(data) <= limit)
        return data

def command(argv, extra=None, timeout=90):
    # Capture both streams even on failure. Never forward diagnostics or exception text.
    child_env = dict(ENV)
    if extra:
        require(KEY not in extra)
        child_env.update(extra)
    process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=child_env, cwd='/', start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except BaseException:
        os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise Refusal() from None
    require(process.returncode == 0 and len(stdout) <= 1048576 and len(stderr) <= 1048576)
    return stdout.decode('utf-8', errors='strict'), stderr

def quiet(argv, extra=None):
    stdout, stderr = command(argv, extra)
    require(not stdout and not stderr)

def docker_value(template, container):
    stdout, stderr = command(['docker', 'inspect', '--format', template, container])
    require(not stderr and stdout.endswith('\n') and '\n' not in stdout[:-1])
    return stdout[:-1]

def container_for(name):
    stdout, stderr = command(['docker', 'ps', '-a', '--no-trunc', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}'])
    candidates = stdout.splitlines()
    require(not stderr and len(candidates) == 1 and re.fullmatch(r'[a-f0-9]{64}', candidates[0]))
    container = candidates[0]
    require(docker_value('{{.Name}}', container) == '/' + name)
    require(docker_value('{{.State.Running}}', container) == 'true')
    return container

def label(container, key):
    return docker_value('{{with index .Config.Labels "' + key + '"}}{{.}}{{end}}', container)

def mount_for(container, destination):
    value = docker_value('{{range .Mounts}}{{if eq .Destination "' + destination + '"}}{{.Type}}:{{.Source}};{{end}}{{end}}', container)
    require(value.startswith('bind:') and value.count(';') == 1 and value.endswith(';'))
    return checked_path(value[5:-1])

def checked_path(value):
    require(re.fullmatch(r'/[A-Za-z0-9/_.-]+', value) and '//' not in value)
    path = Path(value)
    require(str(path) == value and not any(part in ('.', '..') for part in path.parts))
    return path

def path_list(value):
    require(bool(value))
    paths = [checked_path(item) for item in value.split(',')]
    require(len(paths) <= 16 and len(set(paths)) == len(paths))
    return paths

PRESENCE = '{{range .Config.Env}}{{if eq (index (split . "=") 0) "LEMTEL_TRAFFIC_COLLECTOR_SECRET"}}present{{end}}{{end}}'
# This command checks the variable INSIDE Edge and emits no value, even on failure.
EDGE_FORMAT_CHECK = 'set +x; LC_ALL=C; export LC_ALL; v=${LEMTEL_TRAFFIC_COLLECTOR_SECRET-}; [ "${#v}" -eq 64 ] || exit 1; case "$v" in *[!0-9a-f]*) exit 1;; esac'

def ready_route(data):
    text = data.decode('utf-8', errors='strict')
    marker = '# LEMTEL_TRAFFIC_INGRESS_V1'
    require(text.count(marker) == 1)
    lines = text.splitlines()
    require(sum(line.strip() == marker for line in lines) == 1)
    start = next(index for index, line in enumerate(lines) if line.strip() == marker)
    block = [line.strip() for line in lines[start + 1:start + 6]]
    require(len(block) == 5 and block[:3] == ['@lemtel_traffic_ingest path ' + INGRESS_PATH,
            'handle @lemtel_traffic_ingest {', 'log_skip'] and block[4] == '}'
            and re.fullmatch(r'reverse_proxy [A-Za-z0-9._-]+:[0-9]+', block[3]))
    require(text.count(INGRESS_PATH) == 1)

def functions_upstream(lines):
    # Accept one direct functions handler or one generic named matcher; exclude our exact ingress matcher.
    target = re.compile(r'[A-Za-z0-9._-]+:[0-9]+')
    matcher_names = set()
    for index, line in enumerate(lines):
        simple = re.match(r'^\s*@([A-Za-z0-9_-]+)\s+path\s+.*\/functions', line)
        if simple:
            matcher_names.add(simple.group(1))
            continue
        block = re.match(r'^\s*@([A-Za-z0-9_-]+)\s*\{\s*$', line)
        if block:
            for nested in lines[index + 1:]:
                if re.match(r'^\s*}\s*$', nested):
                    break
                if re.match(r'^\s*path\s+.*\/functions', nested):
                    matcher_names.add(block.group(1))
                    break
    candidates = []
    for index, line in enumerate(lines):
        handle = re.match(r'^\s*(?:handle|handle_path)\s+(.+)\{\s*$', line)
        if handle:
            selector = handle.group(1).strip()
            eligible = ('/functions' in selector or (selector.startswith('@') and selector[1:] in matcher_names
                        and selector != '@lemtel_traffic_ingest'))
            if eligible:
                for nested in lines[index + 1:]:
                    if re.match(r'^\s*}\s*$', nested):
                        break
                    parts = nested.split()
                    if len(parts) >= 2 and parts[0] == 'reverse_proxy' and target.fullmatch(parts[1]):
                        candidates.append(parts[1])
                        break
        parts = line.split()
        if len(parts) >= 3 and parts[0] == 'reverse_proxy':
            if ('/functions' in parts[1] or (parts[1].startswith('@') and parts[1][1:] in matcher_names
                                               and parts[1] != '@lemtel_traffic_ingest')):
                if target.fullmatch(parts[2]):
                    candidates.append(parts[2])
    require(len(candidates) == 1)
    return candidates[0]

def anticipated_route(data, already_ready):
    # Mirror only the existing helper's prerequisites and insertion, to prove all other routes stay byte-identical.
    text = data.decode('utf-8', errors='strict')
    require(text.endswith('\n'))
    lines = text.splitlines()
    sites = [line for line in lines if not line.lstrip().startswith('#')
             and CANONICAL_HOST in line and re.search(r'[{]\s*$', line)]
    require(len(sites) == 1)
    upstream = functions_upstream(lines)
    if already_ready:
        ready_route(data)
        return data
    require(INGRESS_PATH not in text and 'LEMTEL_TRAFFIC_INGRESS_V1' not in text)
    insertion = ('  # LEMTEL_TRAFFIC_INGRESS_V1\n  @lemtel_traffic_ingest path ' + INGRESS_PATH
                 + '\n  handle @lemtel_traffic_ingest {\n    log_skip\n    reverse_proxy ' + upstream + '\n  }\n')
    return text.replace(sites[0] + '\n', sites[0] + '\n' + insertion).encode('utf-8')

class Transaction:
    def __init__(self):
        # Redacted diagnostic only; never includes a path, value, command output or credential.
        self.stage = 'preflight'
        self.guard = 'source_integrity'
        self.files = {}
        self.directories = []
        self.lock_fd = None
        self.edge_attempted = False
        self.route_attempted = False
        self.timer_attempted = False
        self.baseline_attempted = False
        self.work = None
        self.compose = None
        self.backup = None
        self.backup_metadata = None

    def create(self, path, data):
        secure_directory(path.parent)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        self.files[path] = identity(os.fstat(fd))
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        require(identity(secure_file(path, 0o600)) == self.files[path])

    def mkdir(self, path):
        if exists(path):
            secure_directory(path)
            return
        self.mkdir(path.parent)
        path.mkdir(mode=0o700)
        self.directories.append((path, identity(path.lstat())))
        secure_directory(path)

    def unlink(self, path):
        if path in self.files and exists(path):
            require(identity(secure_file(path, 0o600, parents=(path != ROUTE_LOCK))) == self.files[path])
            path.unlink()

    def compose_command(self, additional=False):
        argv = list(self.compose)
        if additional:
            argv += ['--env-file', str(self.docker_env)]
        for path in self.config_files:
            argv += ['-f', str(path)]
        if additional:
            argv += ['-f', str(self.override)]
        return argv

    def initial_hash(self):
        stdout, stderr = command(self.compose_command() + ['config', '--hash', self.service])
        require(not stderr)
        parts = stdout.split()
        require(len(parts) == 2 and parts[0] == self.service and re.fullmatch(r'[a-f0-9]{64}', parts[1]))
        return parts[1]

    def initial_files_unchanged(self):
        for path, fingerprint in self.fingerprints.items():
            metadata = secure_file(path)
            require((identity(metadata), metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns) == fingerprint)
        require(self.initial_hash() == self.original_hash)

    def verify_edge(self, activated):
        edge = container_for('supabase-edge-functions')
        require(label(edge, 'com.docker.compose.project') == self.project
                and label(edge, 'com.docker.compose.service') == self.service)
        stdout, stderr = command(self.compose_command(activated) + ['ps', '--all', '--quiet', self.service])
        require(not stderr and stdout.splitlines() == [edge])
        require(docker_value(PRESENCE, edge) == ('present' if activated else ''))
        if activated:
            require(edge != self.edge)
            expected = ','.join(str(path) for path in [*self.config_files, self.override])
            require(label(edge, 'com.docker.compose.project.config_files') == expected)
            quiet(['docker', 'exec', edge, 'sh', '-eu', '-c', EDGE_FORMAT_CHECK])
        else:
            require(label(edge, 'com.docker.compose.config-hash') == self.original_hash)
        return edge

    def prepare(self):
        # Verified source helpers; no schema, ingress or business content is opened.
        secure_file(SOURCE / 'lemtel-ha-do-writer-traffic-activation-apply.sh')
        require(not exists(Path('/.env')))
        for name, digest in HELPERS.items():
            require(hashlib.sha256(read_protected(SOURCE / name)).hexdigest() == digest)
        self.guard = 'runtime_preflight'
        stdout, stderr = command(['bash', str(SOURCE / 'lemtel-ha-do-writer-traffic-runtime-preflight.sh')],
                                 {'LEMTEL_HA_ROLE': 'digitalocean_writer'})
        require(not stderr)
        fields = {}
        for line in stdout.splitlines():
            key, separator, value = line.partition('=')
            require(separator and key not in fields)
            fields[key] = value
        require(fields.get('activation_preflight_ready') == 'true'
                and fields.get('traffic_runtime_preflight_status') == 'complete'
                and fields.get('read_only') == 'true'
                and fields.get('collector_config') == 'absent'
                and fields.get('collector_timer') == 'absent'
                and fields.get('collector_service') == 'absent')
        self.route_was_ready = fields.get('ingress_route') == 'ready'
        self.guard = 'edge_identity'
        self.edge = container_for('supabase-edge-functions')
        self.caddy = container_for('supabase-caddy')
        self.project = label(self.edge, 'com.docker.compose.project')
        self.service = label(self.edge, 'com.docker.compose.service')
        require(re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', self.project)
                and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,62}', self.service))
        require(label(self.edge, 'com.docker.compose.container-number') == '1'
                and label(self.edge, 'com.docker.compose.oneoff') == 'False'
                and docker_value(PRESENCE, self.edge) == '')
        self.guard = 'compose_integrity'
        self.config_files = path_list(label(self.edge, 'com.docker.compose.project.config_files'))
        working_label = label(self.edge, 'com.docker.compose.project.working_dir')
        self.working_dir = checked_path(working_label) if working_label else self.config_files[0].parent
        secure_directory(self.working_dir)
        env_label = label(self.edge, 'com.docker.compose.project.environment_file')
        self.base_env = path_list(env_label) if env_label else []
        if not env_label and exists(self.working_dir / '.env'):
            self.base_env = [self.working_dir / '.env']
        self.fingerprints = {}
        for path in [*self.config_files, *self.base_env]:
            metadata = secure_file(path, 0o600 if path in self.base_env else None)
            require(metadata.st_size > 0)
            self.fingerprints[path] = (identity(metadata), metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns)
        self.compose = ['docker', 'compose', '--project-name', self.project, '--project-directory', str(self.working_dir)]
        for path in self.base_env:
            self.compose += ['--env-file', str(path)]
        quiet(self.compose_command() + ['config', '--quiet'])
        stdout, stderr = command(self.compose_command() + ['config', '--services'])
        require(not stderr and stdout.splitlines().count(self.service) == 1)
        self.original_hash = self.initial_hash()
        require(label(self.edge, 'com.docker.compose.config-hash') == self.original_hash)
        self.verify_edge(False)
        self.guard = 'caddy_integrity'
        self.caddyfile = mount_for(self.caddy, '/etc/caddy') / 'Caddyfile'
        self.caddy_metadata = secure_file(self.caddyfile)
        self.caddy_before = read_protected(self.caddyfile)
        self.caddy_digest = hashlib.sha256(self.caddy_before).digest()
        self.caddy_expected_digest = hashlib.sha256(anticipated_route(self.caddy_before, self.route_was_ready)).digest()
        # FS presence only: this is NOT a database verification or a migration executor.
        self.guard = 'schema_presence'
        require(secure_file(SCHEMA_SOURCE, parents=False).st_size > 0)
        functions = mount_for(self.edge, '/home/deno/functions')
        for relative in ('lemtel-traffic-ingest/index.ts', 'lemtel-traffic-ingest/manifest.json', 'lemtel-onboarding-admin/index.ts'):
            require(secure_file(functions / relative).st_size > 0)
        self.guard = 'collector_absence'
        for path in (CONFIG, STATE, LIB, TIMER, SERVICE, WANTS, LOCK):
            require(not exists(path))
            future_directory(path.parent)
        self.guard = 'local_locks'
        future_directory(ROOT)
        # The existing route helper uses timestamp backups. Refuse any prior backup tree rather than risk an overwrite.
        require(not exists(ROUTE_BACKUPS))
        secure_directory(Path('/run'))
        route_lock_parent = ROUTE_LOCK.parent.lstat()
        require(stat.S_ISDIR(route_lock_parent.st_mode) and route_lock_parent.st_uid == 0
                and (not route_lock_parent.st_mode & 0o022 or route_lock_parent.st_mode & stat.S_ISVTX))
        if exists(ROUTE_LOCK):
            secure_file(ROUTE_LOCK, 0o600, parents=False)
        # The helper's /var/lock must resolve to this exact local lock directory.
        require(Path('/var/lock').resolve() == ROUTE_LOCK.parent)
        self.guard = 'clock_sync'
        synchronized, stderr = command(['timedatectl', 'show', '--property=NTPSynchronized', '--value'])
        require(not stderr and synchronized == 'yes\n')
        # Crypto failure or an unexpected format fails BEFORE creating any local file.
        self.guard = 'secret_generation'
        secret = secrets.token_hex(32)
        require(re.fullmatch(r'[a-f0-9]{64}', secret) is not None)
        return secret

    def apply(self, secret):
        # All entry gates, integrated preflight and read-only checks precede this first mutation.
        self.stage = 'configuration'
        self.guard = 'apply'
        self.create(LOCK, b'')
        self.lock_fd = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW)
        fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.mkdir(ROOT / 'activation-runs')
        self.work = Path(tempfile.mkdtemp(prefix='run-', dir=ROOT / 'activation-runs'))
        self.directories.append((self.work, identity(self.work.lstat())))
        secure_directory(self.work)
        self.backup = self.work / 'Caddyfile.before'
        self.create(self.backup, self.caddy_before)
        require(hashlib.sha256(read_protected(self.backup, 0o600)).digest() == self.caddy_digest)
        self.backup_metadata = self.work / 'caddy-backup.metadata.json'
        self.create(self.backup_metadata, (json.dumps({'sha256': self.caddy_digest.hex(),
                    'uid': self.caddy_metadata.st_uid, 'gid': self.caddy_metadata.st_gid,
                    'mode': stat.S_IMODE(self.caddy_metadata.st_mode)}, separators=(',', ':')) + '\n').encode('ascii'))
        self.caddy_before = None
        self.mkdir(CONFIG.parent)
        endpoint = 'https' + '://' + CANONICAL_HOST + INGRESS_PATH
        self.create(CONFIG, ('LEMTEL_TRAFFIC_NODE_ROLE=do_writer\nLEMTEL_TRAFFIC_ENDPOINT=' + endpoint + '\n' + KEY + '=' + secret + '\n').encode('ascii'))
        # Persist only root-owned Compose inputs so the service can be recreated from its labels later.
        # The env-file is the second secret-bearing file; the override contains only an interpolation.
        self.mkdir(EDGE_CONFIG)
        self.docker_env = EDGE_CONFIG / 'edge-secret.env'
        self.override = EDGE_CONFIG / 'edge-traffic.override.yaml'
        self.create(self.docker_env, (KEY + '=' + secret + '\n').encode('ascii'))
        secret = None
        endpoint = None
        self.create(self.override, ('services:\n  ' + self.service + ':\n    environment:\n      ' + KEY + ': ${' + KEY + ':?required}\n').encode('ascii'))
        stdout, stderr = command(['bash', str(SOURCE / 'lemtel-traffic-collect.sh'), '--check-config'])
        require(not stderr and stdout == 'status=config_ready\n')
        quiet(self.compose_command(True) + ['config', '--quiet'])
        self.initial_files_unchanged()
        self.stage = 'edge_recreate'
        self.edge_attempted = True
        command(self.compose_command(True) + ['up', '--no-deps', '--force-recreate', '--no-build', '--pull', 'never', '-d', self.service])
        self.verify_edge(True)
        if not exists(ROUTE_LOCK):
            # Sticky root-owned lock parent; exclusive no-follow creation before calling the legacy helper.
            fd = os.open(ROUTE_LOCK, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            self.files[ROUTE_LOCK] = identity(os.fstat(fd))
            os.close(fd)
        require(hashlib.sha256(read_protected(self.caddyfile)).digest() == self.caddy_digest)
        require(not exists(ROUTE_BACKUPS))
        self.stage = 'ingress_route'
        self.route_attempted = True
        command(['bash', str(SOURCE / 'lemtel-ha-do-writer-traffic-ingress-route-apply.sh')], {
            'LEMTEL_HA_ROLE': 'digitalocean_writer',
            'LEMTEL_TRAFFIC_ROUTE_EXECUTE': 'apply_verified_traffic_ingress_route',
            'LEMTEL_TRAFFIC_ROUTE_BACKUP_ATTESTATION': 'FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED',
            'LEMTEL_TRAFFIC_ROUTE_REVIEW_APPROVAL': 'REVIEWED_DO_WRITER_TRAFFIC_ROUTE',
            'LEMTEL_TRAFFIC_ROUTE_SNAPSHOT_ATTESTATION': 'DO_WRITER_SNAPSHOT_CREATED_AND_RESTORE_REVIEWED',
            'LEMTEL_TRAFFIC_EDGE_LOG_ATTESTATION': 'EDGE_AND_ROUTE_ACCESS_LOGS_DISABLED_VERIFIED',
        })
        require(hashlib.sha256(read_protected(self.caddyfile)).digest() == self.caddy_expected_digest)
        ready_route(read_protected(self.caddyfile))
        stdout, stderr = command(['bash', str(SOURCE / 'lemtel-traffic-collect.sh'), '--check-config'])
        require(not stderr and stdout == 'status=config_ready\n')
        # Exactly one baseline, before the timer exists. With absent state this does not send a measurement.
        require(not exists(STATE))
        self.stage = 'baseline'
        self.baseline_attempted = True
        stdout, stderr = command(['bash', str(SOURCE / 'lemtel-traffic-collect.sh')])
        require(not stderr and stdout == 'status=baseline_pending\n')
        self.first_baseline_status = 'baseline_pending'
        for path in (LIB, TIMER, SERVICE, WANTS):
            require(not exists(path))
        self.stage = 'timer'
        self.timer_attempted = True
        stdout, stderr = command(['bash', str(SOURCE / 'lemtel-traffic-timer-enable.sh'), 'enable-lemtel-traffic-collector'], {
            'LEMTEL_TRAFFIC_ACTIVATION_APPROVED': 'transactional-package-ready',
            'LEMTEL_TRAFFIC_ACTIVATION_REVIEW_APPROVED': 'REVIEWED_LOCAL_COLLECTOR_ACTIVATION',
            'LEMTEL_TRAFFIC_LOCAL_ROLLBACK_ATTESTATION': 'LOCAL_COLLECTOR_ROLLBACK_REVIEWED',
        })
        require(not stderr and stdout == 'status=timer_enabled\n')
        enabled, stderr = command(['systemctl', 'is-enabled', 'lemtel-traffic-collector.timer'])
        require(not stderr and enabled == 'enabled\n')
        active, stderr = command(['systemctl', 'is-active', 'lemtel-traffic-collector.timer'])
        require(not stderr and active == 'active\n')
        secure_file(CONFIG, 0o600)
        self.stage = 'final_attestation'
        ready_route(read_protected(self.caddyfile))
        self.verify_edge(True)
        # Keep root-only Compose inputs referenced by the new container labels for deterministic future re-creation.
        self.unlink(ROUTE_LOCK)
        self.unlink(LOCK)

    def restore_caddy(self):
        require(hashlib.sha256(read_protected(self.backup, 0o600)).digest() == self.caddy_digest)
        secure_file(self.caddyfile)
        lock_fd = os.open(ROUTE_LOCK, os.O_RDWR | os.O_NOFOLLOW)
        try:
            require(identity(os.fstat(lock_fd)) == identity(secure_file(ROUTE_LOCK, 0o600, parents=False)))
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fd, name = tempfile.mkstemp(prefix='.traffic-restore-', dir=self.caddyfile.parent)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(read_protected(self.backup, 0o600))
                    stream.flush()
                    os.fsync(stream.fileno())
                    os.fchown(stream.fileno(), self.caddy_metadata.st_uid, self.caddy_metadata.st_gid)
                    os.fchmod(stream.fileno(), stat.S_IMODE(self.caddy_metadata.st_mode))
                os.replace(name, self.caddyfile)
            finally:
                if exists(name):
                    os.unlink(name)
            require(hashlib.sha256(read_protected(self.caddyfile)).digest() == self.caddy_digest)
            command(['docker', 'exec', self.caddy, 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
            command(['docker', 'exec', self.caddy, 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
        finally:
            os.close(lock_fd)

    def remove_new_collector_files(self):
        # Every listed path was absent before this run. No recursive deletion, and no preexisting unit is touched.
        if exists(WANTS):
            require(WANTS.is_symlink() and WANTS.lstat().st_uid == 0 and WANTS.resolve() == TIMER)
            WANTS.unlink()
        for path in (TIMER, SERVICE, LIB / 'collect.sh', STATE / 'baseline.json', STATE / 'lock'):
            if exists(path):
                secure_file(path)
                path.unlink()
        for path in (LIB, STATE):
            if exists(path):
                secure_directory(path)
                path.rmdir()

    def rollback(self):
        complete = True
        def attempt(action):
            nonlocal complete
            try:
                action()
            except BaseException:
                complete = False
        if self.timer_attempted:
            attempt(lambda: command(['systemctl', 'disable', '--now', 'lemtel-traffic-collector.timer']))
            attempt(lambda: command(['systemctl', 'stop', 'lemtel-traffic-collector.service']))
        if self.route_attempted:
            attempt(self.restore_caddy)
        if self.edge_attempted:
            def restore_edge():
                self.initial_files_unchanged()
                command(self.compose_command() + ['up', '--no-deps', '--force-recreate', '--no-build', '--pull', 'never', '-d', self.service])
                self.verify_edge(False)
            attempt(restore_edge)
        if self.timer_attempted or self.baseline_attempted:
            attempt(self.remove_new_collector_files)
        if self.timer_attempted:
            attempt(lambda: command(['systemctl', 'daemon-reload']))
        for path in list(self.files):
            if path not in (self.backup, self.backup_metadata):  # Preserve only the verified backup and safe metadata.
                attempt(lambda path=path: self.unlink(path))
        # Only empty directories made by this run, never a prior file or tree.
        for path, inode in reversed(self.directories):
            if path == self.work or (self.work is not None and path in self.work.parents):
                continue
            def remove_directory(path=path, inode=inode):
                if exists(path):
                    require(identity(path.lstat()) == inode)
                    path.rmdir()
            attempt(remove_directory)
        return 'complete' if complete else 'manual_required'

def interrupted(_number, _frame):
    raise Refusal()

transaction = Transaction()
for number in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    signal.signal(number, interrupted)
try:
    pending_secret = transaction.prepare()
    try:
        transaction.apply(pending_secret)
    finally:
        pending_secret = None
    print('traffic_activation_format=lemtel_do_writer_traffic_activation_v1')
    print('traffic_activation_status=complete')
    print('collector_do_active=true\ntimer_enabled=true\ntimer_active=true')
    print('config_owner=root\nconfig_mode=0600\nconfig_regular=true\nconfig_symlink=false\nconfig_links=1')
    print('route=ready\nedge_running=true\nfirst_baseline_status=baseline_pending\nmetrics_visibility=not_verified')
    print('edge_compose_inputs_persisted=true\nrollback_backup_verified=true')
    for line in SCOPE:
        print(line)
except BaseException:
    for number in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(number, signal.SIG_IGN)
    rollback_status = transaction.rollback() if transaction.files else 'not_required'
    print('traffic_activation_status=failed\nreason=activation_refused')
    print('activation_phase=' + transaction.stage)
    print('activation_guard=' + transaction.guard)
    print('rollback_status=' + rollback_status)
    for line in SCOPE:
        print(line)
    sys.exit(1)
finally:
    if transaction.lock_fd is not None:
        os.close(transaction.lock_fd)
PY
