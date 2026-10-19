#!/usr/bin/env bash
# Prepared, NOT installed: validates a signed arbiter command for the current
# DO writer -> Hostinger private standby topology. Default review mode never
# promotes or starts runtime; execute mode requires an exact root-only config.
set +x
set -euo pipefail
umask 077

blocked() {
  printf 'hostinger_failover_agent_status=blocked\nreason=%s\n' "$1" >&2
  exit 78
}
[ "$(id -u)" -eq 0 ] || blocked root_required
[ "${LEMTEL_HA_EXECUTE:-}" = 'run_hostinger_failover_agent' ] || blocked execution_gate_required
[ "${LEMTEL_HA_ROLE:-}" = 'hostinger_standby' ] || blocked invalid_role
case "${1:-preflight}" in preflight|poll) ;; *) blocked invalid_mode ;; esac
[ "$#" -le 1 ] || blocked invalid_arguments
[ -x /usr/bin/python3 ] || blocked python3_required

# No shell sourcing, eval, environment overrides, command-line secrets or alternate config path.
/usr/bin/python3 -I - "${1:-preflight}" <<'PY'
import base64
import hashlib
import hmac
import json
import os
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CONFIG = '/etc/lemtel-ha/failover-agent.env'
STATE = '/var/lib/lemtel-ha/failover-agent'
EVIDENCE = '/var/lib/lemtel-ha/current-topology-evidence'
STAGE_ATTEST = '/opt/lemtel-ha/automatic-failover/lemtel-ha-hostinger-current-topology-stage-attest.sh'
PROMOTION = '/opt/lemtel-ha/automatic-failover/lemtel-ha-hostinger-current-topology-promote.sh'
RUNTIME = '/opt/lemtel-ha/automatic-failover/lemtel-ha-hostinger-current-topology-runtime-start.sh'
MAX_BODY = 65536
STAGE_DIR = '/opt/lemtel-ha/runtime-stage'
STAGE_COMPOSE = ['/usr/bin/docker', 'compose', '--project-name', 'lemtel-ha-hostinger-promoted',
                 '--project-directory', STAGE_DIR, '--env-file', STAGE_DIR + '/.env',
                 '-f', STAGE_DIR + '/docker-compose.yml', '-f', STAGE_DIR + '/docker-compose.caddy.yml',
                 '-f', STAGE_DIR + '/docker-compose.lemtel-private.yml', '-f', STAGE_DIR + '/docker-compose.lemtel-db-init.yml']

class Blocked(Exception):
    pass

def deny(reason):
    raise Blocked(reason)

def secure_path(path, file_mode=None):
    # Check every ancestor: a root-owned file inside a writable/symlinked directory is unsafe.
    current = '/'
    parts = path.strip('/').split('/')
    for index, part in enumerate(parts):
        current = os.path.join(current, part)
        try:
            info = os.lstat(current)
        except OSError:
            deny('required_local_path_missing')
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o022:
            deny('local_path_not_root_only')
        if index < len(parts) - 1 and not stat.S_ISDIR(info.st_mode):
            deny('invalid_local_directory')
    if file_mode is not None:
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != file_mode:
            deny('local_file_permissions_invalid')
    return info

def load_config():
    secure_path(CONFIG, 0o600)
    with open(CONFIG, encoding='utf-8') as handle:
        text = handle.read(MAX_BODY + 1)
    if len(text) > MAX_BODY:
        deny('configuration_too_large')
    allowed = {'FAILOVER_MODE', 'ARBITER_URL', 'AGENT_SHARED_SECRET',
               'DO_WRITER_DROPLET_ID', 'LEMTEL_HA_LOCAL_POSTGRES_CONTAINER',
               'PROMOTION_EXECUTION_MODE', 'EXECUTION_ACK'}
    values = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key not in allowed or key in values or value != value.strip():
            deny('configuration_format_invalid')
        # Literal KEY=value only; not a shell program. Quoting/expansion is intentionally unsupported.
        if any(char in value for char in ('\x00', '\r', '\n', '"', "'", '`', '$')):
            deny('configuration_format_invalid')
        values[key] = value
    if values.get('FAILOVER_MODE') != 'active':
        deny('mode_not_active')
    if not values.get('ARBITER_URL') or len(values.get('AGENT_SHARED_SECRET', '')) < 32:
        deny('arbiter_configuration_required')
    url = urllib.parse.urlsplit(values['ARBITER_URL'])
    if (url.scheme != 'https' or not url.hostname or url.username or url.password or
            url.query or url.fragment or url.path not in ('', '/') or url.port not in (None, 443)):
        deny('arbiter_url_invalid')
    if not re.fullmatch(r'[1-9][0-9]*', values.get('DO_WRITER_DROPLET_ID', '')):
        deny('expected_writer_binding_required')
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+', values.get('LEMTEL_HA_LOCAL_POSTGRES_CONTAINER', '')):
        deny('local_standby_container_required')
    mode = values.get('PROMOTION_EXECUTION_MODE', 'review')
    if mode not in ('review', 'execute'):
        deny('promotion_execution_mode_invalid')
    if mode == 'execute' and values.get('EXECUTION_ACK') != 'I_UNDERSTAND_CURRENT_TOPOLOGY_AUTOMATIC_FAILOVER':
        deny('automatic_execution_acknowledgement_required')
    secure_path(STAGE_ATTEST, 0o750)
    secure_path(PROMOTION, 0o750)
    secure_path(RUNTIME, 0o750)
    values['PROMOTION_EXECUTION_MODE'] = mode
    return values

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            deny('duplicate_command_field')
        result[key] = value
    return result

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)

def verify(secret, context, payload, signature):
    if not isinstance(signature, str) or not re.fullmatch(r'[a-f0-9]{64}', signature):
        deny('signature_invalid')
    expected = hmac.new(secret.encode(), (context + '\n' + canonical(payload)).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        deny('signature_invalid')

def exact_fields(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields):
        deny('command_schema_invalid')

def valid_integer(value):
    return type(value) is int and 0 <= value <= 9007199254740991

def validate_command(command, cfg):
    exact_fields(command, ('payload', 'signature'))
    payload = command['payload']
    exact_fields(payload, ('format', 'name', 'incident_id', 'nonce', 'writer_role', 'target_role',
                           'issued_at', 'expires_at', 'fence_receipt'))
    verify(cfg['AGENT_SHARED_SECRET'], 'lemtel-promotion-command-v1', payload, command['signature'])
    if (payload['format'] != 'lemtel_promotion_command_v1' or payload['name'] != 'promotion' or
            payload['writer_role'] != 'do_writer' or payload['target_role'] != 'hostinger_standby'):
        deny('command_role_or_name_invalid')
    if not isinstance(payload['incident_id'], str) or not re.fullmatch(r'[a-z0-9-]{8,80}', payload['incident_id']):
        deny('incident_id_invalid')
    if not isinstance(payload['nonce'], str) or not re.fullmatch(r'[a-f0-9-]{36}', payload['nonce']):
        deny('nonce_invalid')
    now = int(time.time())
    issued, expiry = payload['issued_at'], payload['expires_at']
    if (not valid_integer(issued) or not valid_integer(expiry) or issued > now + 15 or
            issued > expiry or expiry <= now or expiry - issued < 30 or expiry - issued > 300):
        deny('command_expired_or_time_invalid')
    receipt = payload['fence_receipt']
    exact_fields(receipt, ('payload', 'signature'))
    proof = receipt['payload']
    exact_fields(proof, ('format', 'incident_id', 'writer_role', 'writer_droplet_id', 'provider_action_id',
                         'provider_action_type', 'terminal_action_status', 'terminal_power_state',
                         'confirmations', 'observed_at'))
    verify(cfg['AGENT_SHARED_SECRET'], 'lemtel-fence-receipt-v1', proof, receipt['signature'])
    if (proof['format'] != 'lemtel_do_writer_fence_receipt_v1' or proof['incident_id'] != payload['incident_id'] or
            proof['writer_role'] != 'do_writer' or proof['writer_droplet_id'] != cfg['DO_WRITER_DROPLET_ID'] or
            proof['terminal_power_state'] != 'off' or proof['terminal_action_status'] != 'completed' or
            proof['provider_action_type'] not in ('shutdown', 'power_off') or
            not valid_integer(proof['provider_action_id']) or proof['provider_action_id'] == 0 or
            not valid_integer(proof['confirmations']) or proof['confirmations'] < 2 or
            not valid_integer(proof['observed_at']) or proof['observed_at'] > issued or
            issued - proof['observed_at'] > 120):
        deny('fence_receipt_not_terminal_or_bound_to_incident')
    return payload

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        deny('arbiter_redirect_refused')

def runtime_images_present(env):
    # Every image of the staged runtime must already be local: a failover must never depend on a
    # registry download in the middle of an outage (the runtime start uses --pull never).
    try:
        listed = run_command(STAGE_COMPOSE + ['config', '--images'], env, 30)
        images = sorted(set(line.strip() for line in listed.stdout.decode().splitlines() if line.strip()))
        if listed.returncode != 0 or len(images) < 10:
            return False
        return all(run_command(['/usr/bin/docker', 'image', 'inspect', image], env, 15).returncode == 0 for image in images)
    except Exception:
        return False

def standby_readiness(cfg):
    # Read-only local facts the arbiter requires before it may ever fence the writer:
    # the standby PostgreSQL answers and is still in recovery, and the runtime stage is present.
    in_recovery = False
    try:
        result = run_command(['/usr/bin/docker', 'exec', '-u', 'postgres', cfg['LEMTEL_HA_LOCAL_POSTGRES_CONTAINER'],
                              'psql', '-X', '-At', '-d', 'postgres', '-c', 'SELECT pg_is_in_recovery()'],
                             {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'}, 15)
        in_recovery = result.returncode == 0 and result.stdout.strip() == b't'
    except Exception:
        in_recovery = False
    local_env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'}
    stage = all(os.path.isfile(os.path.join(STAGE_DIR, name)) and not os.path.islink(os.path.join(STAGE_DIR, name))
                for name in ('docker-compose.yml', '.env', 'volumes/pooler/pooler.exs'))
    stage = stage and runtime_images_present(local_env)
    payload = {'format': 'lemtel_standby_readiness_v1', 'target_role': 'hostinger_standby',
               'observed_at': int(time.time()), 'ready': bool(in_recovery and stage),
               'standby_in_recovery': bool(in_recovery), 'runtime_stage_present': bool(stage)}
    signature = hmac.new(cfg['AGENT_SHARED_SECRET'].encode(),
                         ('lemtel-standby-readiness-v1\n' + canonical(payload)).encode(), hashlib.sha256).hexdigest()
    envelope = canonical({'payload': payload, 'signature': signature}).encode()
    return base64.urlsafe_b64encode(envelope).decode().rstrip('=')

def poll(cfg):
    # The only remote endpoint in this agent is the authenticated arbiter command mailbox.
    # Every poll also carries the signed standby readiness the arbiter requires before any fencing.
    request = urllib.request.Request(cfg['ARBITER_URL'].rstrip('/') + '/agent/command',
        headers={'Authorization': 'Bearer ' + cfg['AGENT_SHARED_SECRET'], 'Accept': 'application/json',
                 'X-Lemtel-Standby-Readiness': standby_readiness(cfg)}, method='GET')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=8) as response:
        if response.status != 200 or response.headers.get_content_type() != 'application/json':
            deny('arbiter_response_invalid')
        raw = response.read(MAX_BODY + 1)
    if len(raw) > MAX_BODY:
        deny('arbiter_response_too_large')
    return json.loads(raw, object_pairs_hook=unique_object,
                      parse_constant=lambda _value: deny('nonfinite_command_value'))

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def claim_incident(incident_id):
    secure_path('/var/lib/lemtel-ha')
    try:
        os.mkdir(STATE, 0o700)
        sync_directory('/var/lib/lemtel-ha')
    except FileExistsError:
        pass
    info = secure_path(STATE)
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700:
        deny('incident_ledger_not_private')
    path = STATE + '/' + incident_id + '.consumed'
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        deny('incident_already_consumed_manual_review')
    # Claim is durable BEFORE running any guard; crashes/failures never reopen the incident.
    with os.fdopen(fd, 'w') as handle:
        handle.write('status=received_guard_pending\n')
        handle.flush()
        os.fsync(handle.fileno())
    sync_directory(STATE)
    return path

def write_ledger(path, state):
    secure_path(path, 0o600)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    with os.fdopen(fd, 'w') as handle:
        handle.write('status=' + state + '\n')
        handle.flush()
        os.fsync(handle.fileno())
    sync_directory(STATE)

def persist_fence_receipt(incident_id, payload):
    # The receipt was fully HMAC-verified before this function. Persist only the
    # fixed, validated fields required by the local promotion/runtime actions.
    try:
        os.mkdir(EVIDENCE, 0o700)
        sync_directory('/var/lib/lemtel-ha')
    except FileExistsError:
        pass
    info = secure_path(EVIDENCE)
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700:
        deny('fence_evidence_directory_not_private')
    target = EVIDENCE + '/do-writer-fence-receipt.state'
    proof = payload['fence_receipt']['payload']
    lines = [
        'format=lemtel_do_writer_fence_receipt_v1',
        'incident_id=' + incident_id,
        'writer_role=do_writer',
        'writer_droplet_id=' + proof['writer_droplet_id'],
        'provider_action_id=' + str(proof['provider_action_id']),
        'provider_action_type=' + proof['provider_action_type'],
        'terminal_action_status=completed',
        'terminal_power_state=off',
        'confirmations=' + str(proof['confirmations']),
        'receipt_hmac_verified=true',
    ]
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        deny('fence_receipt_already_persisted_manual_review')
    with os.fdopen(fd, 'w') as handle:
        handle.write('\n'.join(lines) + '\n')
        handle.flush()
        os.fsync(handle.fileno())
    sync_directory(EVIDENCE)

def execution_environment(incident, cfg, phase):
    env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C',
           'LEMTEL_HA_INCIDENT_ID': incident}
    if phase == 'stage_attest':
        env.update({'LEMTEL_HA_EXECUTE': 'attest_current_topology_hostinger_runtime_stage',
                    'LEMTEL_HA_ROLE': 'hostinger_private_hot_standby'})
    elif phase == 'promotion':
        env.update({'LEMTEL_HA_EXECUTE': 'promote_current_topology_hostinger_after_verified_fence',
                    'LEMTEL_HA_ROLE': 'hostinger_private_hot_standby',
                    'LEMTEL_HA_ALLOW_CURRENT_TOPOLOGY_PROMOTION': 'I_UNDERSTAND_HOSTINGER_BECOMES_THE_ONLY_WRITER'})
    else:
        env.update({'LEMTEL_HA_EXECUTE': 'activate_current_topology_hostinger_runtime',
                    'LEMTEL_HA_ROLE': 'hostinger_promoted_writer',
                    'LEMTEL_HA_ALLOW_CURRENT_TOPOLOGY_RUNTIME_START': 'I_UNDERSTAND_PROMOTED_HOSTINGER_RUNTIME_WILL_START'})
    return env

def run_command(argv, env, timeout):
    return subprocess.run(argv, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, timeout=timeout, check=False)

def run_local(path, env, timeout):
    return run_command(['/usr/bin/bash', path], env, timeout).returncode == 0

def main():
    cfg = load_config()
    if sys.argv[1] == 'preflight':
        print('hostinger_failover_agent_status=preflight_ready_no_action')
        print('automatic_promotion_enabled=false\nautomatic_runtime_start_enabled=false\nautomatic_traffic_routing_enabled=false')
        return
    reply = poll(cfg)
    if isinstance(reply, dict) and reply == {'state': 'no_command'}:
        print('hostinger_failover_agent_status=no_command')
        return
    exact_fields(reply, ('state', 'command'))
    if reply['state'] != 'command_available':
        deny('no_valid_command')
    command = validate_command(reply['command'], cfg)
    incident = command['incident_id']
    ledger = claim_incident(incident)
    persist_fence_receipt(incident, command)
    if not run_local(STAGE_ATTEST, execution_environment(incident, cfg, 'stage_attest'), 45):
        deny('runtime_stage_attestation_blocked_incident_consumed')
    if cfg['PROMOTION_EXECUTION_MODE'] == 'review':
        write_ledger(ledger, 'manual_promotion_action_required')
        print('hostinger_failover_agent_status=manual_promotion_action_required')
        print('promotion_executed=false\nruntime_start_executed=false\nautomatic_traffic_routing_enabled=false')
        return
    write_ledger(ledger, 'promotion_execution_started')
    if not run_local(PROMOTION, execution_environment(incident, cfg, 'promotion'), 240):
        write_ledger(ledger, 'promotion_execution_failed_manual_recovery_required')
        deny('promotion_execution_failed_manual_recovery_required')
    write_ledger(ledger, 'runtime_start_started')
    if not run_local(RUNTIME, execution_environment(incident, cfg, 'runtime'), 180):
        write_ledger(ledger, 'runtime_start_failed_manual_recovery_required')
        deny('runtime_start_failed_manual_recovery_required')
    write_ledger(ledger, 'promotion_and_runtime_completed')
    print('hostinger_failover_agent_status=promotion_and_runtime_completed')
    print('promotion_executed=true\nruntime_start_executed=true\nautomatic_traffic_routing_enabled=false')

try:
    main()
except Blocked as error:
    print('hostinger_failover_agent_status=blocked\nreason=' + str(error), file=sys.stderr)
    sys.exit(78)
except Exception:
    # Never print exceptions, HTTP bodies, configuration, signatures or secrets.
    print('hostinger_failover_agent_status=blocked\nreason=local_or_arbiter_error_manual_review', file=sys.stderr)
    sys.exit(78)
PY
