#!/usr/bin/env python3
"""One-shot authenticated transfer of a public mTLS CA from the Lemtel DO writer.

The DO sender reads the platform signer only through an anonymous stdin pipe from
systemd-creds. The receiver accepts one CA only after an ECDSA proof bound to its
fresh nonce. Private signer material is never written to disk or emitted.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "lemtel-public-ca-signed-transfer-v1"
CONTEXT = b"lemtel/public-ca-signed-transfer/v1\x00"
EXPECTED_PIN_FINGERPRINT = "sha256:ccff99d6194dff45060349181a721a6a8a8453d2f2a43db3076532a380f45c90"
MAX_CA_BYTES = 16_384
MAX_BODY_BYTES = 32_768
MAX_SIGNATURE_BYTES = 72
B64URL = re.compile(r"^[A-Za-z0-9_-]+$")
HEX = re.compile(r"^[a-f0-9]{64}$")
P256_ORDER = int("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)


def fail(reason: str) -> None:
    raise ValueError(reason)


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def no_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            fail("duplicate_key")
        value[key] = item
    return value


def parse_json(raw: bytes) -> object:
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=no_duplicates)
    except Exception as error:
        raise ValueError("json_invalid") from error


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def b64url_decode(value: object, minimum: int, maximum: int) -> bytes:
    if not isinstance(value, str) or not B64URL.fullmatch(value):
        fail("b64url_invalid")
    try:
        raw = base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))
    except Exception as error:
        raise ValueError("b64url_invalid") from error
    if not minimum <= len(raw) <= maximum or b64url_encode(raw) != value:
        fail("b64url_invalid")
    return raw


def public_pin(value: object) -> tuple[dict[str, str], bytes]:
    if not isinstance(value, dict) or set(value) != {"format", "platformSigningKey", "fingerprint"}:
        fail("public_pin_shape")
    fmt = value.get("format")
    key = value.get("platformSigningKey")
    fingerprint = value.get("fingerprint")
    if fmt != "lemtel-platform-signing-public-v1" or not isinstance(key, str) or not isinstance(fingerprint, str):
        fail("public_pin_shape")
    point = b64url_decode(key, 65, 65)
    if point[0] != 4:
        fail("public_pin_point")
    core = {"format": fmt, "platformSigningKey": key}
    derived = "sha256:" + hashlib.sha256(
        ("lemtel-platform-signing-v1:public\n" + canonical(core)).encode("utf-8")
    ).hexdigest()
    if fingerprint != derived or fingerprint != EXPECTED_PIN_FINGERPRINT:
        fail("public_pin_untrusted")
    return {"format": fmt, "platformSigningKey": key, "fingerprint": fingerprint}, point


def private_key(value: object, point: bytes) -> bytes:
    if not isinstance(value, dict) or set(value) != {"crv", "d", "kty", "x", "y"}:
        fail("private_jwk_shape")
    if value.get("kty") != "EC" or value.get("crv") != "P-256":
        fail("private_jwk_shape")
    scalar = b64url_decode(value.get("d"), 32, 32)
    x = b64url_decode(value.get("x"), 32, 32)
    y = b64url_decode(value.get("y"), 32, 32)
    if not 0 < int.from_bytes(scalar, "big") < P256_ORDER:
        fail("private_jwk_scalar")
    if point != b"\x04" + x + y:
        fail("private_jwk_pin_mismatch")
    # RFC 5915 ECPrivateKey: P-256 parameters are explicit; no private bytes touch disk.
    return b"\x30\x31\x02\x01\x01\x04\x20" + scalar + b"\xa0\x0a\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07"


def spki(point: bytes) -> bytes:
    # SubjectPublicKeyInfo for id-ecPublicKey / prime256v1 and an uncompressed point.
    if len(point) != 65 or point[0] != 4:
        fail("public_pin_point")
    return bytes.fromhex("3059301306072a8648ce3d020106082a8648ce3d030107034200") + point


@contextmanager
def memory_file(label: str, value: bytes):
    if not hasattr(os, "memfd_create"):
        fail("memfd_unavailable")
    descriptor = os.memfd_create(label, os.MFD_CLOEXEC)
    try:
        offset = 0
        while offset < len(value):
            count = os.write(descriptor, value[offset:])
            if count < 1:
                fail("memfd_write")
            offset += count
        os.lseek(descriptor, 0, os.SEEK_SET)
        yield descriptor, f"/proc/self/fd/{descriptor}"
    finally:
        try:
            os.close(descriptor)
        except OSError:
            pass


def openssl(arguments: list[str], data: bytes, descriptors: tuple[int, ...]) -> bytes:
    try:
        result = subprocess.run(
            ["/usr/bin/openssl", *arguments], input=data, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, timeout=5, check=False, pass_fds=descriptors,
            close_fds=True,
        )
    except Exception as error:
        raise ValueError("openssl_unavailable") from error
    if result.returncode != 0:
        fail("openssl_rejected")
    return result.stdout


def signature_der(raw: bytes) -> None:
    # Strict short-form ECDSA DER: one SEQUENCE, exactly two positive INTEGERs.
    if len(raw) < 8 or len(raw) > MAX_SIGNATURE_BYTES or raw[:1] != b"\x30" or raw[1] != len(raw) - 2:
        fail("signature_der_invalid")
    index = 2
    for _ in range(2):
        if index + 2 > len(raw) or raw[index] != 2:
            fail("signature_der_invalid")
        length = raw[index + 1]
        index += 2
        if length < 1 or length > 33 or index + length > len(raw):
            fail("signature_der_invalid")
        part = raw[index:index + length]
        index += length
        if part[0] & 0x80 or (len(part) > 1 and part[0] == 0 and not part[1] & 0x80):
            fail("signature_der_invalid")
    if index != len(raw):
        fail("signature_der_invalid")


def sign(key_der: bytes, message: bytes) -> bytes:
    with memory_file("lemtel-platform-signing-jwk", key_der) as (descriptor, path):
        signature = openssl(["dgst", "-sha256", "-keyform", "DER", "-sign", path], message, (descriptor,))
    signature_der(signature)
    return signature


def verify(public_der: bytes, message: bytes, signature: bytes) -> None:
    signature_der(signature)
    with memory_file("lemtel-platform-signing-public", public_der) as (key_descriptor, key_path):
        openssl(["pkey", "-pubin", "-inform", "DER", "-in", key_path, "-pubcheck", "-noout"], b"", (key_descriptor,))
        with memory_file("lemtel-platform-signature", signature) as (signature_descriptor, signature_path):
            openssl(
                ["dgst", "-sha256", "-keyform", "DER", "-verify", key_path, "-signature", signature_path],
                message, (key_descriptor, signature_descriptor),
            )


def ca_der(pem: bytes) -> bytes:
    if not 1 <= len(pem) <= MAX_CA_BYTES:
        fail("ca_size")
    try:
        text = pem.decode("ascii")
    except UnicodeDecodeError as error:
        raise ValueError("ca_encoding") from error
    if text.count("-----BEGIN CERTIFICATE-----") != 1 or text.count("-----END CERTIFICATE-----") != 1 or not text.endswith("-----END CERTIFICATE-----\n"):
        fail("ca_shape")
    try:
        der = ssl.PEM_cert_to_DER_cert(text)
    except ValueError as error:
        raise ValueError("ca_invalid") from error
    # The payload must be a self-signed CA certificate, not an arbitrary leaf or bundle.
    with memory_file("lemtel-public-ca", pem) as (descriptor, path):
        openssl(["verify", "-CAfile", path, "-check_ss_sig", path], b"", (descriptor,))
        detail = openssl(["x509", "-in", path, "-noout", "-text"], b"", (descriptor,)).decode("utf-8", "replace")
    if "CA:TRUE" not in detail:
        fail("ca_not_authority")
    return der


def message(nonce: bytes, pem: bytes) -> bytes:
    if len(nonce) != 32:
        fail("nonce_invalid")
    digest = hashlib.sha256(pem).digest()
    return CONTEXT + nonce + digest + len(pem).to_bytes(4, "big") + pem


def sender(receiver: str) -> None:
    if not receiver.startswith("https://") or not receiver.endswith("/ca") or "?" in receiver or "#" in receiver:
        fail("receiver_url_invalid")
    pin_raw = Path("/etc/lemtel-node-platform-signer/public-pin.json").read_bytes()
    pin, point = public_pin(parse_json(pin_raw))
    jwk = parse_json(sys.stdin.buffer.read(4096))
    key_der = private_key(jwk, point)
    pem = Path("/etc/lemtel-platform-signer/cloudflare-access-root-ca.pem").read_bytes()
    ca_der(pem)
    nonce_url = receiver[:-3] + "/challenge"
    try:
        with urllib.request.urlopen(nonce_url, timeout=10) as response:
            nonce = response.read(33)
            if response.status != 200 or len(nonce) != 32:
                fail("challenge_rejected")
    except Exception as error:
        if isinstance(error, ValueError):
            raise
        raise ValueError("challenge_unavailable") from error
    payload = {
        "caPem": b64url_encode(pem), "nonce": b64url_encode(nonce), "publicPin": pin,
        "signature": b64url_encode(sign(key_der, message(nonce, pem))), "version": VERSION,
    }
    raw = canonical(payload).encode("ascii")
    try:
        request = urllib.request.Request(receiver, data=raw, method="POST", headers={"content-type": "application/json"})
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 204 or response.read(1):
                fail("receiver_rejected")
    except Exception as error:
        if isinstance(error, ValueError):
            raise
        raise ValueError("receiver_rejected") from error


class Receiver:
    def __init__(self, destination: Path):
        self.destination = destination
        self.nonce = secrets.token_bytes(32)
        self.lock = threading.Lock()
        self.state = "pending"

    def accept(self, raw: bytes) -> None:
        if len(raw) < 1 or len(raw) > MAX_BODY_BYTES:
            fail("body_size")
        value = parse_json(raw)
        if not isinstance(value, dict) or set(value) != {"caPem", "nonce", "publicPin", "signature", "version"} or value.get("version") != VERSION:
            fail("response_shape")
        nonce = b64url_decode(value.get("nonce"), 32, 32)
        if not secrets.compare_digest(nonce, self.nonce):
            fail("nonce_invalid")
        pin, point = public_pin(value.get("publicPin"))
        pem = b64url_decode(value.get("caPem"), 1, MAX_CA_BYTES)
        ca_der(pem)
        signature = b64url_decode(value.get("signature"), 8, MAX_SIGNATURE_BYTES)
        with self.lock:
            if self.state != "pending":
                fail("nonce_consumed")
            self.state = "verifying"
        try:
            verify(spki(point), message(nonce, pem), signature)
            if self.destination.exists() or self.destination.is_symlink():
                fail("destination_exists")
            descriptor, temporary = tempfile.mkstemp(prefix=".lemtel-public-ca-", dir=self.destination.parent)
            try:
                os.fchmod(descriptor, 0o600)
                with os.fdopen(descriptor, "wb") as handle:
                    handle.write(pem)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self.destination)
                os.chmod(self.destination, 0o600)
            except Exception:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
                try:
                    os.unlink(temporary)
                except OSError:
                    pass
                raise
        except Exception:
            with self.lock:
                self.state = "failed"
            raise
        with self.lock:
            self.state = "consumed"


def receiver(port: int, destination: Path) -> None:
    if port < 1024 or port > 65535 or destination.exists() or destination.is_symlink():
        fail("receiver_configuration")
    state = Receiver(destination)

    class Handler(BaseHTTPRequestHandler):
        server_version = "LemtelSignedPublicCA/1"
        def log_message(self, _format: str, *_args: object) -> None:
            return
        def reply(self, code: int, body: bytes = b"") -> None:
            self.send_response(code)
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            if body:
                self.wfile.write(body)
        def do_GET(self) -> None:
            if self.path != "/challenge" or state.state != "pending":
                self.reply(404); return
            self.reply(200, state.nonce)
        def do_POST(self) -> None:
            if self.path != "/ca":
                self.reply(404); return
            try:
                length = int(self.headers.get("content-length", ""))
                if length < 1 or length > MAX_BODY_BYTES:
                    raise ValueError("body_size")
                state.accept(self.rfile.read(length))
            except Exception:
                self.reply(403); return
            self.reply(204)
            print("public_ca_receive_status=accepted", flush=True)
            print("public_ca_receive_authentication=platform_signer_ecdsa", flush=True)
            threading.Thread(target=self.server.shutdown, daemon=True).start()

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    threading.Timer(900, server.shutdown).start()
    print("public_ca_receive_status=listening", flush=True)
    server.serve_forever()
    server.server_close()
    if state.state != "consumed":
        print("public_ca_receive_status=closed_without_acceptance", flush=True)
        raise SystemExit(1)


def main() -> int:
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "send" and os.geteuid() == 0:
            sender(sys.argv[2]); print("public_ca_transfer_status=complete", flush=True); return 0
        if len(sys.argv) == 4 and sys.argv[1] == "receive" and os.geteuid() != 0:
            receiver(int(sys.argv[2]), Path(sys.argv[3])); return 0
        fail("arguments_or_privilege")
    except Exception as error:
        print(f"public_ca_transfer_status=failed\nreason={str(error)[:80]}", file=sys.stderr, flush=True)
        return 78


if __name__ == "__main__":
    sys.exit(main())
