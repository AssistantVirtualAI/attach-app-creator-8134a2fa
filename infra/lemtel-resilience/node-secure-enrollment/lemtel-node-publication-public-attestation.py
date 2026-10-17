#!/usr/bin/env python3
# Root-only public descriptor attestation for a local node-publication key file.
# It emits only a fingerprint of public key material. It never writes, publishes,
# installs a service, contacts a network, or performs provider/HA/telephony work.
import base64
import hashlib
import json
import os
import re
import stat
import sys

CONFIG = '/etc/lemtel-node-publication'
STATE = '/var/lib/lemtel-node-publication'
KEYS = CONFIG + '/keys.json'
VERSION = 'lemtel-node-enrollment-v1'


def blocked():
    raise RuntimeError('blocked')


def canonical(value):
    if isinstance(value, dict):
        return '{' + ','.join(json.dumps(key, ensure_ascii=True, separators=(',', ':')) + ':' + canonical(value[key]) for key in sorted(value)) + '}'
    if isinstance(value, list):
        return '[' + ','.join(canonical(entry) for entry in value) + ']'
    if value is None or isinstance(value, (bool, int, str)):
        return json.dumps(value, ensure_ascii=True, separators=(',', ':'))
    blocked()


def no_duplicate_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            blocked()
        value[key] = item
    return value


def secure_directory(path):
    metadata = os.lstat(path)
    return stat.S_ISDIR(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_gid == 0 and stat.S_IMODE(metadata.st_mode) == 0o700


def secure_parents(path):
    current = ''
    for item in path.strip('/').split('/'):
        current += '/' + item
        metadata = os.lstat(current)
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != 0 or (stat.S_IMODE(metadata.st_mode) & 0o022) != 0:
            return False
    return True


def read_canonical_key_file():
    if not secure_parents(CONFIG) or not secure_parents(STATE) or not secure_directory(CONFIG) or not secure_directory(STATE):
        blocked()
    before = os.lstat(KEYS)
    if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) or before.st_uid != 0 or before.st_gid != 0 or stat.S_IMODE(before.st_mode) != 0o600 or before.st_nlink != 1 or before.st_size <= 0 or before.st_size > 4096:
        blocked()
    descriptor = os.open(KEYS, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        after = os.fstat(descriptor)
        if after.st_dev != before.st_dev or after.st_ino != before.st_ino or not stat.S_ISREG(after.st_mode) or after.st_uid != 0 or after.st_gid != 0 or stat.S_IMODE(after.st_mode) != 0o600 or after.st_nlink != 1 or after.st_size != before.st_size:
            blocked()
        raw = b''
        while len(raw) <= 4096:
            chunk = os.read(descriptor, 4097 - len(raw))
            if not chunk:
                break
            raw += chunk
        if len(raw) != before.st_size or len(raw) > 4096:
            blocked()
    finally:
        os.close(descriptor)
    text = raw.decode('utf-8')
    value = json.loads(text, object_pairs_hook=no_duplicate_object)
    if text != canonical(value):
        blocked()
    return value


def public_key(value):
    if not isinstance(value, str) or not re.fullmatch(r'[-_A-Za-z0-9]{86,88}', value):
        blocked()
    try:
        raw = base64.urlsafe_b64decode(value + '=' * ((4 - len(value) % 4) % 4))
    except Exception:
        blocked()
    if len(raw) != 65 or raw[0] != 4:
        blocked()
    return value


def fingerprint(value):
    if not isinstance(value, dict) or set(value) != {'descriptor', 'signingPrivate', 'encryptionPrivate'}:
        blocked()
    descriptor = value['descriptor']
    if not isinstance(descriptor, dict) or set(descriptor) != {'signingKey', 'encryptionKey'}:
        blocked()
    signing = public_key(descriptor['signingKey'])
    encryption = public_key(descriptor['encryptionKey'])
    if signing == encryption:
        blocked()
    return 'sha256:' + hashlib.sha256((VERSION + ':descriptor\n' + canonical(descriptor)).encode('utf-8')).hexdigest()


def main():
    try:
        if os.geteuid() != 0 or sys.argv != [sys.argv[0], 'attest-public'] or os.environ.get('LEMTEL_NODE_PUBLIC_ATTEST_APPROVAL') != 'attest_public_descriptor_only' or os.environ.get('LEMTEL_NODE_PUBLIC_ATTEST_ROLE') not in {'do_writer', 'hostinger_standby'}:
            blocked()
        value = read_canonical_key_file()
        result = fingerprint(value)
        print('node_publication_public_attestation_format=lemtel_node_publication_public_attestation_v1')
        print('node_role=' + os.environ['LEMTEL_NODE_PUBLIC_ATTEST_ROLE'])
        print('descriptor_shape=valid')
        print('private_key_material_output=false')
        print('private_key_proof=false')
        print('public_fingerprint=' + result)
        print('filesystem_mutation=false')
        print('network_access=false')
        print('publication_configured=false')
        print('publication_executed=false')
        print('service_installed=false')
        print('timer_enabled=false')
        print('provider_contacted=false')
        print('cloudflare_or_dns_changed=false')
        print('promotion_executed=false')
        print('fencing_executed=false')
        print('automatic_failover_enabled=false')
        print('telephony_contacted=false')
        print('node_publication_public_attestation_status=complete')
    except Exception:
        print('node_publication_public_attestation_status=blocked', file=sys.stderr)
        return 78
    return 0


if __name__ == '__main__':
    sys.exit(main())
