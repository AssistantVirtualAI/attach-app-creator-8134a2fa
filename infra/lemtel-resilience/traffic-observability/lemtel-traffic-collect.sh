#!/usr/bin/env bash
# Implementation-only. Never invoked by a package/build/install hook.
set +x
set -euo pipefail
umask 077
if [[ "$EUID" -ne 0 ]]; then printf 'status=root_required\n'; exit 78; fi
if [[ "$#" -gt 1 || ( "$#" -eq 1 && "$1" != '--check-config' ) ]]; then printf 'status=invalid_arguments\n'; exit 78; fi
python3 - "$@" 2>/dev/null <<'PY'
import datetime
import fcntl
import hashlib
import hmac
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse

CONFIG = pathlib.Path('/etc/lemtel-ha/traffic-collector.env')
STATE_DIR = pathlib.Path('/var/lib/lemtel-traffic-collector')

class Refusal(Exception):
    pass

def secure_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'r', encoding='utf-8') as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1:
            raise Refusal()
        content = stream.read(4097)
        if len(content) > 4096:
            raise Refusal()
        return content

def configuration():
    # No shell sourcing/eval. Also reject symlink or writable ancestors.
    for directory in CONFIG.parents:
        metadata = directory.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise Refusal()
    values = {}
    allowed = {'LEMTEL_TRAFFIC_ENDPOINT', 'LEMTEL_TRAFFIC_COLLECTOR_SECRET', 'LEMTEL_TRAFFIC_NODE_ROLE'}
    for line in secure_file(CONFIG).splitlines():
        if not line or line.startswith('#'):
            continue
        name, separator, value = line.partition('=')
        if not separator or name not in allowed or name in values or not value:
            raise Refusal()
        values[name] = value
    if set(values) != allowed or values['LEMTEL_TRAFFIC_NODE_ROLE'] not in ('do_writer', 'hostinger_standby'):
        raise Refusal()
    if not re.fullmatch(r'[a-f0-9]{64}', values['LEMTEL_TRAFFIC_COLLECTOR_SECRET']):
        raise Refusal()
    endpoint = urllib.parse.urlsplit(values['LEMTEL_TRAFFIC_ENDPOINT'])
    if endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.port or endpoint.query or endpoint.fragment or endpoint.path != '/functions/v1/lemtel-traffic-ingest':
        raise Refusal()
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', endpoint.hostname) or '.' not in endpoint.hostname:
        raise Refusal()
    # DNS name only: reject all-numeric dotted literals without parsing or retaining an IP endpoint.
    if re.fullmatch(r'[0-9.]+', endpoint.hostname):
        raise Refusal()
    if values['LEMTEL_TRAFFIC_ENDPOINT'] != 'https://' + endpoint.hostname + endpoint.path:
        raise Refusal()
    return values

def counters():
    rx = tx = 0
    with open('/proc/net/dev', encoding='ascii') as stream:
        for line in stream:
            if ':' not in line:
                continue
            name, data = line.split(':', 1)
            if name.strip() == 'lo':
                continue
            fields = data.split()
            rx += int(fields[0])
            tx += int(fields[8])
    established = 0
    # Only inspect the aggregate state column; never retain endpoint columns.
    for source in ('/proc/net/tcp', '/proc/net/tcp6'):
        with open(source, encoding='ascii') as stream:
            next(stream)
            established += sum(1 for line in stream if line.split()[3] == '01')
    if min(rx, tx) < 0 or not 0 <= established <= 1000000:
        raise Refusal()
    return rx, tx, established

def write_state(state):
    fd, name = tempfile.mkstemp(prefix='.baseline-', dir=STATE_DIR)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(state, stream, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, STATE_DIR / 'baseline.json')
    finally:
        if os.path.exists(name):
            os.unlink(name)

def collect(values):
    STATE_DIR.mkdir(mode=0o700, exist_ok=True)
    metadata = STATE_DIR.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise Refusal()
    fd = os.open(STATE_DIR / 'lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        metadata = os.fstat(lock.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1:
            raise Refusal()
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 'busy', 0
        now = int(time.time())
        rx, tx, tcp = counters()
        role = values['LEMTEL_TRAFFIC_NODE_ROLE']
        current = {'nodeRole': role, 'observedAt': now, 'rxBytes': rx, 'txBytes': tx}
        try:
            previous = json.loads(secure_file(STATE_DIR / 'baseline.json'))
        except FileNotFoundError:
            write_state(current)
            return 'baseline_pending', 0
        if set(previous) != set(current) or previous['nodeRole'] != role or any(type(previous[key]) is not int or previous[key] < 0 for key in ('observedAt', 'rxBytes', 'txBytes')):
            raise Refusal()
        period = now - previous['observedAt']
        if 0 <= period < 30:
            return 'interval_pending', 0
        if not 30 <= period <= 300 or rx < previous['rxBytes'] or tx < previous['txBytes']:
            write_state(current)
            return 'baseline_reset', 0
        # Minute key: never create multiple measurements for the same minute.
        if now // 60 == previous['observedAt'] // 60:
            return 'interval_pending', 0
        delta_rx, delta_tx = rx - previous['rxBytes'], tx - previous['txBytes']
        if max(delta_rx, delta_tx) > 1000000000000:
            write_state(current)
            return 'range_reset', 0
        observed = datetime.datetime.fromtimestamp(now // 60 * 60, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:00Z')
        payload = json.dumps({'nodeRole': role, 'observedAt': observed, 'periodSeconds': period,
                              'rxBytes': delta_rx, 'txBytes': delta_tx, 'tcpEstablished': tcp}, separators=(',', ':'))
        proof = hmac.new(values['LEMTEL_TRAFFIC_COLLECTOR_SECRET'].encode(), payload.encode(), hashlib.sha256).hexdigest()
        # Best effort, no backfill: advance before sending to avoid double counting after ambiguous failures.
        write_state(current)
        quote = lambda text: '"' + text.replace('\\', '\\\\').replace('"', '\\"') + '"'
        curl_config = '\n'.join(('url = ' + quote(values['LEMTEL_TRAFFIC_ENDPOINT']),
                                 'header = "Content-Type: application/json"',
                                 'header = ' + quote('X-Lemtel-Traffic-Signature: sha256=' + proof),
                                 'data = ' + quote(payload))) + '\n'
        result = subprocess.run(['curl', '--config', '-', '--silent', '--request', 'POST',
                                 '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '0',
                                 '--noproxy', '*', '--connect-timeout', '5', '--max-time', '15',
                                 '--output', '/dev/null', '--write-out', '%{http_code}'],
                                input=curl_config, text=True, capture_output=True, timeout=20,
                                env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'})
        return ('collecting', 0) if result.returncode == 0 and result.stdout in ('202', '204') else ('delivery_failed', 1)

def main():
    try:
        values = configuration()
        status_key, code = ('config_ready', 0) if sys.argv[1:] == ['--check-config'] else collect(values)
    except Exception:
        status_key, code = 'collector_refused', 78
    print('status=' + status_key)
    return code

if __name__ == '__main__':
    sys.exit(main())
PY
