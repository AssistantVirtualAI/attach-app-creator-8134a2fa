#!/usr/bin/env bash
# Implementation-only. Never invoked by a package/build/install hook.
set +x
set -euo pipefail
umask 077
if [[ "$EUID" -ne 0 ]]; then printf 'status=root_required\n'; exit 78; fi
if [[ "$#" -gt 1 || ( "$#" -eq 1 && "$1" != '--check-config' ) ]]; then printf 'status=invalid_arguments\n'; exit 78; fi
python3 - "$@" 2>/dev/null <<'PY'
import datetime
import hashlib
import hmac
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import urllib.parse

CONFIG = pathlib.Path('/etc/lemtel-ha/node-status-publisher.env')

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
    # Never source/eval configuration. Refuse a writable/symlinked path hierarchy.
    for directory in CONFIG.parents:
        metadata = directory.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise Refusal()
    allowed = {
        'LEMTEL_NODE_STATUS_ENDPOINT', 'LEMTEL_NODE_STATUS_SECRET', 'LEMTEL_NODE_STATUS_NODE_ROLE',
        'LEMTEL_NODE_STATUS_AGENT_STATE', 'LEMTEL_NODE_STATUS_RUNTIME_STATE',
        'LEMTEL_NODE_STATUS_REPLICATION_STATE', 'LEMTEL_NODE_STATUS_STORAGE_STATE',
    }
    values = {}
    for line in secure_file(CONFIG).splitlines():
        if not line or line.startswith('#'):
            continue
        name, separator, value = line.partition('=')
        if not separator or name not in allowed or name in values or not value:
            raise Refusal()
        values[name] = value
    if set(values) != allowed:
        raise Refusal()
    if values['LEMTEL_NODE_STATUS_NODE_ROLE'] not in ('do_writer', 'hostinger_standby'):
        raise Refusal()
    if not re.fullmatch(r'[a-f0-9]{64}', values['LEMTEL_NODE_STATUS_SECRET']):
        raise Refusal()
    if values['LEMTEL_NODE_STATUS_AGENT_STATE'] not in ('healthy', 'degraded', 'unknown'):
        raise Refusal()
    if values['LEMTEL_NODE_STATUS_RUNTIME_STATE'] not in ('ready', 'degraded', 'unknown'):
        raise Refusal()
    if values['LEMTEL_NODE_STATUS_REPLICATION_STATE'] not in ('streaming', 'degraded', 'unknown'):
        raise Refusal()
    if values['LEMTEL_NODE_STATUS_STORAGE_STATE'] not in ('synced', 'degraded', 'unknown'):
        raise Refusal()
    endpoint = urllib.parse.urlsplit(values['LEMTEL_NODE_STATUS_ENDPOINT'])
    if endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.port or endpoint.query or endpoint.fragment or endpoint.path != '/functions/v1/lemtel-node-status-ingest':
        raise Refusal()
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', endpoint.hostname) or '.' not in endpoint.hostname:
        raise Refusal()
    # DNS name only: no literal IP endpoint is accepted or retained.
    if re.fullmatch(r'[0-9.]+', endpoint.hostname):
        raise Refusal()
    if values['LEMTEL_NODE_STATUS_ENDPOINT'] != 'https://' + endpoint.hostname + endpoint.path:
        raise Refusal()
    return values

def publish(values):
    observed = datetime.datetime.now(datetime.timezone.utc).replace(second=0, microsecond=0).strftime('%Y-%m-%dT%H:%M:00Z')
    # These fixed enum values are the complete outbound data allowlist. The agent never reads/logs identifiers, metrics, errors, containers or content.
    payload = json.dumps({
        'nodeRole': values['LEMTEL_NODE_STATUS_NODE_ROLE'], 'observedAt': observed,
        'agentState': values['LEMTEL_NODE_STATUS_AGENT_STATE'], 'runtimeState': values['LEMTEL_NODE_STATUS_RUNTIME_STATE'],
        'replicationState': values['LEMTEL_NODE_STATUS_REPLICATION_STATE'], 'storageState': values['LEMTEL_NODE_STATUS_STORAGE_STATE'],
    }, separators=(',', ':'))
    proof = hmac.new(values['LEMTEL_NODE_STATUS_SECRET'].encode(), payload.encode(), hashlib.sha256).hexdigest()
    quote = lambda text: '"' + text.replace('\\', '\\\\').replace('"', '\\"') + '"'
    curl_config = '\n'.join((
        'url = ' + quote(values['LEMTEL_NODE_STATUS_ENDPOINT']),
        'header = "Content-Type: application/json"',
        'header = ' + quote('X-Lemtel-Node-Status-Signature: sha256=' + proof),
        'data = ' + quote(payload),
    )) + '\n'
    result = subprocess.run([
        'curl', '--config', '-', '--silent', '--request', 'POST', '--proto', '=https', '--proto-redir', '=https',
        '--max-redirs', '0', '--noproxy', '*', '--connect-timeout', '5', '--max-time', '15',
        '--output', '/dev/null', '--write-out', '%{http_code}',
    ], input=curl_config, text=True, capture_output=True, timeout=20, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'})
    return ('published', 0) if result.returncode == 0 and result.stdout == '204' else ('delivery_failed', 1)

def main():
    try:
        values = configuration()
        status_key, code = ('config_ready', 0) if sys.argv[1:] == ['--check-config'] else publish(values)
    except Exception:
        status_key, code = 'publisher_refused', 78
    print('status=' + status_key)
    return code

if __name__ == '__main__':
    sys.exit(main())
PY
