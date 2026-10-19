#!/usr/bin/env python3
"""Root-only, single-run Hostinger standby installation for option B (signed observations, NOT enrolled).

Installs two observation-only publishers on the Hostinger standby: the existing aggregate traffic collector
(role hostinger_standby) and the Hostinger standby resource publisher. Both sign with the role-bound Hostinger
secret, read once from stdin (never argv, never printed). The standby PostgreSQL container is only checked
read-only (must be running and in recovery); it is never stopped, promoted, reconfigured or restarted. No runtime,
replication, WireGuard, failover agent, DNS, Cloudflare or telephony change. Any failure removes what this run created.
"""
import os, re, stat, subprocess, sys, time
from pathlib import Path

TEST_ROOT = os.environ.get('LEMTEL_HSO_TEST_ROOT')  # Test harness only: prefixes every absolute path.
def P(value: str) -> Path:
    return Path(TEST_ROOT + value) if TEST_ROOT else Path(value)

SOURCE = Path(__file__).resolve().parent
STANDBY_CONTAINER = 'lemtel-postgres-hostinger-standby'
KEY = 'LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET'
HOST = 'https://lemtel.assistantvirtualai.com'
ETC = P('/etc/lemtel-ha')
RESOURCE_CONFIG = ETC / 'hostinger-standby-resource-publisher.env'
TRAFFIC_CONFIG = ETC / 'traffic-collector.env'
RESOURCE_LIB = P('/usr/local/libexec/lemtel-hostinger-standby-resource-publisher')
RESOURCE_PUBLISHER = RESOURCE_LIB / 'publish.sh'
UNITS = P('/etc/systemd/system')
RESOURCE_SERVICE = UNITS / 'lemtel-hostinger-standby-resource-publisher.service'
RESOURCE_TIMER = UNITS / 'lemtel-hostinger-standby-resource-publisher.timer'
TRAFFIC_LIB = P('/usr/local/libexec/lemtel-traffic')
TRAFFIC_STATE = P('/var/lib/lemtel-traffic-collector')
TRAFFIC_SERVICE = UNITS / 'lemtel-traffic-collector.service'
TRAFFIC_TIMER = UNITS / 'lemtel-traffic-collector.timer'
LOCK = P('/run/lemtel-hostinger-standby-publisher-install.lock')
FILES = {'resource_publisher': 'lemtel-hostinger-standby-resource-publish.sh',
         'resource_service': 'systemd/lemtel-hostinger-standby-resource-publisher.service',
         'resource_timer': 'systemd/lemtel-hostinger-standby-resource-publisher.timer',
         'traffic_collector': 'lemtel-traffic-collect.sh',
         'traffic_installer': 'lemtel-traffic-timer-enable.sh'}
ENV = {'PATH': os.environ['PATH'] if TEST_ROOT else '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/', 'LANG': 'C'}
if TEST_ROOT:  # Test harness only: the fakes need their state file and the root prefix.
    ENV.update({'FAKE_STATE': os.environ['FAKE_STATE'], 'LEMTEL_HSO_TEST_ROOT': TEST_ROOT})

class Refusal(Exception):
    pass

def require(value):
    if not value:
        raise Refusal()

def exists(path):
    return os.path.lexists(path)

def owner_ok(meta):
    return meta.st_uid == (os.geteuid() if TEST_ROOT else 0)

def secure_directory(path):
    for item in (path, *path.parents):
        if TEST_ROOT and not str(item).startswith(TEST_ROOT):
            break
        meta = item.lstat()
        require(stat.S_ISDIR(meta.st_mode) and owner_ok(meta) and not meta.st_mode & 0o022)

def secure_file(path, mode=None):
    secure_directory(path.parent)
    meta = path.lstat()
    require(stat.S_ISREG(meta.st_mode) and owner_ok(meta) and meta.st_nlink == 1 and not meta.st_mode & 0o022)
    if mode is not None:
        require(stat.S_IMODE(meta.st_mode) == mode)
    return meta

def read_file(path, limit=1048576):
    secure_file(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        value = stream.read(limit + 1)
    require(len(value) <= limit)
    return value

def command(argv, timeout=90, extra_env=None, check=True):
    process = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env={**ENV, **(extra_env or {})}, cwd='/', timeout=timeout)
    if check:
        require(process.returncode == 0 and len(process.stdout) <= 1048576)
    return process.returncode, process.stdout.decode('utf-8', 'replace'), process.stderr.decode('utf-8', 'replace')

def read_secret():
    data = sys.stdin.buffer.read(200)
    require(re.fullmatch(rb'LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET=[a-f0-9]{64}\n', data) is not None)
    return data.decode('ascii').split('=', 1)[1].strip()

def timer_scheduled(name):
    _, out, _ = command(['systemctl', 'show', name, '-p', 'ActiveState', '-p', 'UnitFileState', '-p', 'NextElapseUSecMonotonic'])
    values = dict(line.split('=', 1) for line in out.splitlines() if '=' in line)
    return values.get('ActiveState') == 'active' and values.get('UnitFileState') == 'enabled' and values.get('NextElapseUSecMonotonic', '') not in ('', '0', 'infinity')

class Transaction:
    def __init__(self):
        self.phase = 'preflight'; self.guard = 'entry'
        self.created = []; self.directories = []
        self.resource_timer_attempted = False; self.traffic_attempted = False

    def preflight(self):
        self.guard = 'package_files'
        manifest = read_file(SOURCE / 'package-manifest.json').decode('utf-8')
        import hashlib, json
        data = json.loads(manifest)
        require(data.get('package_format') == 'lemtel_hostinger_standby_publisher_package_v1' and data.get('trust_model') == 'signed_publication_not_enrolled')
        require(set(data.get('sha256', {})) == set(FILES))
        self.files = {}
        for key, name in FILES.items():
            content = read_file(SOURCE / name)
            require(hashlib.sha256(content).hexdigest() == data['sha256'][key])
            self.files[key] = content

        self.guard = 'standby_identity'
        _, running, _ = command(['docker', 'inspect', '--format', '{{.State.Running}}', STANDBY_CONTAINER])
        require(running == 'true\n')
        _, recovery, _ = command(['docker', 'exec', STANDBY_CONTAINER, 'sh', '-eu', '-c', 'export PSQLRC=/dev/null; psql -X -At -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -c "SELECT pg_is_in_recovery()::text"'])
        require(recovery == 'true\n')

        self.guard = 'initial_absence'
        secure_directory(ETC)
        for path in (RESOURCE_CONFIG, TRAFFIC_CONFIG, RESOURCE_LIB, RESOURCE_SERVICE, RESOURCE_TIMER, TRAFFIC_LIB, TRAFFIC_STATE, TRAFFIC_SERVICE, TRAFFIC_TIMER, LOCK):
            require(not exists(path))
        secure_directory(UNITS)

    def mkdir(self, path, mode=0o700):
        secure_directory(path.parent); require(not exists(path)); path.mkdir(mode=mode); os.chmod(path, mode); self.directories.append(path)

    def create(self, path, data, mode):
        secure_directory(path.parent); require(not exists(path))
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.chmod(path, mode); secure_file(path, mode); self.created.append(path)

    def apply(self, secret):
        self.phase = 'install'; self.guard = 'lock'
        self.create(LOCK, b'', 0o600)

        self.guard = 'resource_publisher_files'
        self.create(RESOURCE_CONFIG, ('LEMTEL_HOSTINGER_STANDBY_RESOURCE_ENDPOINT=' + HOST + '/functions/v1/lemtel-hostinger-standby-resource-ingest\n' + KEY + '=' + secret + '\n').encode('ascii'), 0o600)
        if not exists(RESOURCE_LIB.parent):
            self.mkdir(RESOURCE_LIB.parent, 0o755)
        self.mkdir(RESOURCE_LIB)
        self.create(RESOURCE_PUBLISHER, self.files['resource_publisher'], 0o700)
        self.create(RESOURCE_SERVICE, self.files['resource_service'], 0o644)
        self.create(RESOURCE_TIMER, self.files['resource_timer'], 0o644)
        self.guard = 'resource_publisher_config'
        _, out, err = command([str(RESOURCE_PUBLISHER), '--check-config'])
        require(out == 'status=config_ready\n' and not err)
        self.phase = 'smoke'; self.guard = 'resource_publisher_smoke'
        code, out, err = command([str(RESOURCE_PUBLISHER)], timeout=60, check=False)
        require(code == 0 and out == 'status=published\n')

        self.phase = 'traffic'; self.guard = 'traffic_collector_config'
        self.create(TRAFFIC_CONFIG, ('LEMTEL_TRAFFIC_NODE_ROLE=hostinger_standby\nLEMTEL_TRAFFIC_ENDPOINT=' + HOST + '/functions/v1/lemtel-traffic-ingest\nLEMTEL_TRAFFIC_COLLECTOR_SECRET=' + secret + '\n').encode('ascii'), 0o600)
        secret = None
        self.guard = 'traffic_collector_install'
        self.traffic_attempted = True
        stage = self.files  # The vetted upstream installer runs from a private copy next to the collector it installs.
        work = P('/run/lemtel-hostinger-standby-traffic-install'); self.mkdir(work)
        self.create(work / 'lemtel-traffic-collect.sh', stage['traffic_collector'], 0o700)
        self.create(work / 'lemtel-traffic-timer-enable.sh', stage['traffic_installer'], 0o700)
        _, out, _ = command(['bash', str(work / 'lemtel-traffic-timer-enable.sh'), 'enable-lemtel-traffic-collector'], timeout=120, extra_env={
            'LEMTEL_TRAFFIC_ACTIVATION_APPROVED': 'transactional-package-ready',
            'LEMTEL_TRAFFIC_ACTIVATION_REVIEW_APPROVED': 'REVIEWED_LOCAL_COLLECTOR_ACTIVATION',
            'LEMTEL_TRAFFIC_LOCAL_ROLLBACK_ATTESTATION': 'LOCAL_COLLECTOR_ROLLBACK_REVIEWED'})
        require(out == 'status=timer_enabled\n')

        self.phase = 'timers'; self.guard = 'resource_timer_enable'
        self.resource_timer_attempted = True
        command(['systemctl', 'daemon-reload'])
        command(['systemctl', '--quiet', 'enable', '--now', 'lemtel-hostinger-standby-resource-publisher.timer'])
        self.guard = 'first_runs'
        # Start each service once so OnUnitActiveSec always has an activation timestamp (lesson of 2026-10-18).
        command(['systemctl', 'start', 'lemtel-hostinger-standby-resource-publisher.service'], timeout=90)
        command(['systemctl', 'start', 'lemtel-traffic-collector.service'], timeout=90)
        self.guard = 'timers_scheduled'
        time.sleep(1)
        require(timer_scheduled('lemtel-hostinger-standby-resource-publisher.timer'))
        require(timer_scheduled('lemtel-traffic-collector.timer'))
        for path in (work / 'lemtel-traffic-collect.sh', work / 'lemtel-traffic-timer-enable.sh'):
            path.unlink(); self.created.remove(path)
        work.rmdir(); self.directories.remove(work)

    def rollback(self):
        complete = True
        def attempt(action):
            nonlocal complete
            try: action()
            except BaseException: complete = False
        if self.resource_timer_attempted:
            attempt(lambda: command(['systemctl', 'disable', '--now', 'lemtel-hostinger-standby-resource-publisher.timer'], check=False))
        if self.traffic_attempted:
            attempt(lambda: command(['systemctl', 'disable', '--now', 'lemtel-traffic-collector.timer'], check=False))
            for path in (TRAFFIC_SERVICE, TRAFFIC_TIMER, TRAFFIC_LIB / 'collect.sh', TRAFFIC_STATE / 'baseline.json'):
                if exists(path): attempt(path.unlink)
            for path in (TRAFFIC_LIB, TRAFFIC_STATE):
                if exists(path): attempt(path.rmdir)
        for path in reversed(self.created):
            if exists(path): attempt(path.unlink)
        for path in reversed(self.directories):
            if exists(path): attempt(path.rmdir)
        attempt(lambda: command(['systemctl', 'daemon-reload'], check=False))
        return complete

def scope():
    print('standby_postgres_touched=false\nstandby_runtime_started=false\npostgres_promotion_executed=false\nreplication_changed=false\nfailover_agent_changed=false\ncloudflare_or_dns_changed=false\nautomatic_failover_enabled=false\ntelephony_contacted=false\ncredential_values_emitted=false')

def main():
    print('hostinger_standby_publisher_install_format=lemtel_hostinger_standby_publisher_install_v1')
    if not TEST_ROOT and os.geteuid() != 0:
        print('reason=root_required'); return 78
    gates = {'LEMTEL_HA_ROLE': 'hostinger_standby',
             'LEMTEL_HOSTINGER_STANDBY_PUBLISHER_EXECUTE': 'install_verified_hostinger_standby_publishers',
             'LEMTEL_HOSTINGER_STANDBY_SNAPSHOT_ATTESTATION': 'FRESH_WRITER_AND_STANDBY_SNAPSHOTS_VERIFIED'}
    if any(os.environ.get(k) != v for k, v in gates.items()):
        print('hostinger_standby_publisher_install_status=refused\nreason=gates_required'); return 78
    transaction = Transaction()
    try:
        transaction.preflight()
        transaction.guard = 'secret_input'
        secret = read_secret()
        transaction.apply(secret); secret = None
    except BaseException:
        reason = f'{transaction.phase}_{transaction.guard}'
        complete = transaction.rollback() if transaction.phase != 'preflight' else True
        print('hostinger_standby_publisher_install_status=failed')
        print('reason=' + (reason if re.fullmatch(r'[a-z0-9_]{1,96}', reason) else 'unknown'))
        print('rollback_status=' + ('complete' if complete else 'incomplete')); scope(); return 1
    print('role=hostinger_standby\ntrust_model=signed_publication_not_enrolled\nresource_publisher_smoke_test=published\nresource_timer=enabled_active_scheduled\ntraffic_collector_timer=enabled_active_scheduled')
    scope(); print('hostinger_standby_publisher_install_status=complete'); return 0

if __name__ == '__main__':
    sys.exit(main())
