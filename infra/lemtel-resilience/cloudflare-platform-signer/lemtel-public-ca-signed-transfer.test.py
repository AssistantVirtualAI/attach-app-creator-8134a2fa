#!/usr/bin/env python3
"""Integration test with an ephemeral key and self-signed public CA only."""
import base64
import hashlib
import importlib.util
import json
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "lemtel-public-ca-signed-transfer.py"
spec = importlib.util.spec_from_file_location("transfer", SOURCE)
transfer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transfer)


def raw_b64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))


def run(arguments: list[str], *, cwd: str) -> bytes:
    return subprocess.run(arguments, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=8).stdout


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


with tempfile.TemporaryDirectory() as directory:
    run(["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "key.pem"], cwd=directory)
    private_der = run(["openssl", "ec", "-in", "key.pem", "-outform", "DER"], cwd=directory)
    marker = private_der.find(b"\x04\x20")
    assert marker >= 0
    scalar = private_der[marker + 2:marker + 34]
    assert len(scalar) == 32
    public_der = run(["openssl", "pkey", "-in", "key.pem", "-pubout", "-outform", "DER"], cwd=directory)
    point = public_der[-65:]
    assert point[:1] == b"\x04"
    pin_core = {"format": "lemtel-platform-signing-public-v1", "platformSigningKey": transfer.b64url_encode(point)}
    fingerprint = "sha256:" + hashlib.sha256(("lemtel-platform-signing-v1:public\n" + transfer.canonical(pin_core)).encode()).hexdigest()
    pin = {**pin_core, "fingerprint": fingerprint}
    transfer.EXPECTED_PIN_FINGERPRINT = fingerprint
    jwk = {"crv": "P-256", "d": transfer.b64url_encode(scalar), "kty": "EC", "x": transfer.b64url_encode(point[1:33]), "y": transfer.b64url_encode(point[33:])}
    run(["openssl", "req", "-x509", "-new", "-key", "key.pem", "-subj", "/CN=lemtel-test-ca", "-days", "1", "-addext", "basicConstraints=critical,CA:true", "-out", "ca.pem"], cwd=directory)
    pem = (Path(directory) / "ca.pem").read_bytes()
    transfer.ca_der(pem)
    port = free_port()
    destination = Path(directory) / "received-ca.pem"
    runner = threading.Thread(target=transfer.receiver, args=(port, destination), daemon=True)
    runner.start()
    for _ in range(30):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/challenge", timeout=1) as reply:
                nonce = reply.read()
                break
        except Exception:
            time.sleep(0.05)
    else:
        raise RuntimeError("receiver_unavailable")
    checked, checked_point = transfer.public_pin(pin)
    signature = transfer.sign(transfer.private_key(jwk, checked_point), transfer.message(nonce, pem))
    payload = transfer.canonical({"caPem": transfer.b64url_encode(pem), "nonce": transfer.b64url_encode(nonce), "publicPin": checked, "signature": transfer.b64url_encode(signature), "version": transfer.VERSION}).encode()
    request = urllib.request.Request(f"http://127.0.0.1:{port}/ca", data=payload, method="POST", headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=4) as reply:
        assert reply.status == 204
    runner.join(3)
    assert destination.read_bytes() == pem
    state = transfer.Receiver(Path(directory) / "second.pem")
    state.nonce = nonce
    state.accept(payload)
    try:
        state.accept(payload)
    except ValueError as error:
        assert str(error) == "nonce_consumed"
    else:
        raise AssertionError("replay_accepted")

print("lemtel_signed_public_ca_transfer_integration=passed")
