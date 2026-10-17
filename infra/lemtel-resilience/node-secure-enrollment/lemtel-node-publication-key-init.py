#!/usr/bin/env python3
# Root-only local P-256 key generation using the pre-installed OpenSSL provider.
# No network, package install, service, timer, publisher, route, provider action,
# promotion, fencing, failover or telephony action occurs.
import base64
import hashlib
import json
import os
import stat
import subprocess
import sys

CONFIG = '/etc/lemtel-node-publication'
STATE = '/var/lib/lemtel-node-publication'
VERSION = 'lemtel-node-enrollment-v1'


def blocked():
    raise RuntimeError('blocked')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def b64(value):
    return base64.urlsafe_b64encode(value).decode('ascii').rstrip('=')


def read_length(raw, index):
    if index >= len(raw):
        blocked()
    first = raw[index]
    if first < 0x80:
        return first, index + 1
    count = first & 0x7f
    if count == 0 or count > 2 or index + 1 + count > len(raw):
        blocked()
    value = int.from_bytes(raw[index + 1:index + 1 + count], 'big')
    if value < 0x80:
        blocked()
    return value, index + 1 + count


def tlv(raw, index, tag):
    if index >= len(raw) or raw[index] != tag:
        blocked()
    length, start = read_length(raw, index + 1)
    end = start + length
    if end > len(raw):
        blocked()
    return raw[start:end], end


def parse_sec1_p256(raw):
    body, end = tlv(raw, 0, 0x30)
    if end != len(raw):
        blocked()
    version, index = tlv(body, 0, 0x02)
    private, index = tlv(body, index, 0x04)
    if version != b'\x01' or len(private) != 32:
        blocked()
    public = None
    parameters_seen = False
    while index < len(body):
        tag = body[index]
        if tag == 0xa0 and not parameters_seen:
            _, index = tlv(body, index, 0xa0)
            parameters_seen = True
        elif tag == 0xa1 and public is None:
            wrapped, index = tlv(body, index, 0xa1)
            bits, bit_end = tlv(wrapped, 0, 0x03)
            if bit_end != len(wrapped) or len(bits) != 66 or bits[0] != 0 or bits[1] != 4:
                blocked()
            public = bits[1:]
        else:
            blocked()
    if public is None or len(public) != 65:
        blocked()
    return private, public


def generate_private_material():
    try:
        result = subprocess.run(
            ['openssl', 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-outform', 'DER'],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        blocked()
    return parse_sec1_p256(result.stdout)


def key_from_material():
    private, public = generate_private_material()
    return {
        'raw': b64(public),
        'jwk': {
            'crv': 'P-256',
            'd': b64(private),
            'kty': 'EC',
            'x': b64(public[1:33]),
            'y': b64(public[33:65]),
        },
    }


def secure_directory(path):
    try:
        metadata = os.lstat(path)
    except OSError:
        return False
    return stat.S_ISDIR(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_gid == 0 and stat.S_IMODE(metadata.st_mode) == 0o700


def write_new(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        data = canonical(value).encode('utf-8')
        offset = 0
        while offset < len(data):
            written = os.write(descriptor, data[offset:])
            if written <= 0:
                blocked()
            offset += written
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    parent = os.open(os.path.dirname(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def init(config=CONFIG, state=STATE):
    if not secure_directory(config) or not secure_directory(state) or os.path.lexists(os.path.join(config, 'keys.json')):
        blocked()
    signing = key_from_material()
    encryption = key_from_material()
    if signing['raw'] == encryption['raw']:
        blocked()
    descriptor = {'signingKey': signing['raw'], 'encryptionKey': encryption['raw']}
    fingerprint = 'sha256:' + hashlib.sha256(f'{VERSION}:descriptor\n{canonical(descriptor)}'.encode('utf-8')).hexdigest()
    write_new(os.path.join(config, 'keys.json'), {'descriptor': descriptor, 'signingPrivate': signing['jwk'], 'encryptionPrivate': encryption['jwk']})
    return fingerprint


def main():
    try:
        if os.geteuid() != 0 or sys.argv != [sys.argv[0], 'init'] or os.environ.get('LEMTEL_NODE_LOCAL_APPROVAL') != 'generate_publication_keys_only':
            blocked()
        print(f'status=initialized fingerprint={init()}')
    except Exception:
        print('status=blocked', file=sys.stderr)
        return 78
    return 0


if __name__ == '__main__':
    sys.exit(main())
