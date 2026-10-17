#!/usr/bin/env python3
# Generates a P-256 platform signing JWK only to stdout for a direct encrypted pipe.
# It writes only the non-secret public pin to the supplied root-owned staging path.
import base64
import hashlib
import json
import os
import subprocess
import sys


def fail():
    raise RuntimeError('blocked')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def b64(value):
    return base64.urlsafe_b64encode(value).decode('ascii').rstrip('=')


def read_length(raw, index):
    if index >= len(raw):
        fail()
    first = raw[index]
    if first < 0x80:
        return first, index + 1
    count = first & 0x7f
    if count == 0 or count > 2 or index + 1 + count > len(raw):
        fail()
    value = int.from_bytes(raw[index + 1:index + 1 + count], 'big')
    if value < 0x80:
        fail()
    return value, index + 1 + count


def tlv(raw, index, tag):
    if index >= len(raw) or raw[index] != tag:
        fail()
    length, start = read_length(raw, index + 1)
    end = start + length
    if end > len(raw):
        fail()
    return raw[start:end], end


def parse_sec1_p256(raw):
    body, end = tlv(raw, 0, 0x30)
    if end != len(raw):
        fail()
    version, index = tlv(body, 0, 0x02)
    private, index = tlv(body, index, 0x04)
    if version != b'\x01' or len(private) != 32:
        fail()
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
                fail()
            public = bits[1:]
        else:
            fail()
    if public is None or len(public) != 65:
        fail()
    return private, public


def create_material():
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
        fail()
    private, public = parse_sec1_p256(result.stdout)
    signing_key = b64(public)
    public_pin = {'format': 'lemtel-platform-signing-public-v1', 'platformSigningKey': signing_key}
    fingerprint = 'sha256:' + hashlib.sha256(f'lemtel-platform-signing-v1:public\n{canonical(public_pin)}'.encode('utf-8')).hexdigest()
    private_jwk = {'crv': 'P-256', 'd': b64(private), 'kty': 'EC', 'x': b64(public[1:33]), 'y': b64(public[33:65])}
    return private_jwk, {**public_pin, 'fingerprint': fingerprint}


def write_new(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        data = canonical(value).encode('utf-8')
        offset = 0
        while offset < len(data):
            written = os.write(descriptor, data[offset:])
            if written <= 0:
                fail()
            offset += written
        os.fchmod(descriptor, 0o600)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def main():
    try:
        if os.geteuid() != 0 or len(sys.argv) != 2 or not sys.argv[1].startswith('/'):
            fail()
        private_jwk, public_pin = create_material()
        write_new(sys.argv[1], public_pin)
        sys.stdout.write(canonical(private_jwk))
    except Exception:
        sys.stderr.write('status=blocked\n')
        return 78
    return 0


if __name__ == '__main__':
    sys.exit(main())
