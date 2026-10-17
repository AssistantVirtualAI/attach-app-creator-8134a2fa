#!/usr/bin/python3
"""Lemtel signer relay — source-only, disabled unless explicitly configured.

The process accepts a single framed JSON request from one configured local UID
through a Unix socket. It cannot take a URL, HTTP method, credential path,
purpose, or action from the caller. It has no listener on a network interface.
No deployment unit or active configuration is provided by this source file.
"""

import http.client
import json
import os
import re
import socket
import stat
import ssl
import struct
import sys
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

SOCKET_PATH = "/run/lemtel-platform-signer/relay.sock"
CONFIG_PATH = "/etc/lemtel-platform-signer/relay.conf"
SIGNER_HOST = "signer.lemtel.assistantvirtualai.com"
SIGNER_PATH = "/v1/node-enrollment-delivery"
MAX_REQUEST_BYTES = 6144
MAX_RESPONSE_BYTES = 4096
LOCAL_TIMEOUT_SECONDS = 3
OUTBOUND_TIMEOUT_SECONDS = 5
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 3
PURPOSE = "node_enrollment_publication_delivery"
DO_WRITER_ROLE = "do_writer"
# The relay reserves a short, bounded UTC leeway so a request cannot become
# expired between its local validation and the one permitted outbound call.
MINIMUM_EXPIRY_LEEWAY_SECONDS = 30
MAX_REQUEST_TTL_SECONDS = 300
CREDENTIAL_NAMES = ("client-cert.pem", "client-key.pem")
ENCRYPTED_CREDENTIALS_DIRECTORY = "/etc/lemtel-platform-signer/credentials"
ENCRYPTED_CREDENTIAL_NAMES = tuple(f"{name}.cred" for name in CREDENTIAL_NAMES)
REPLAY_STATE_DIRECTORY = "/var/lib/lemtel-platform-signer"
REPLAY_LEDGER_PATH = f"{REPLAY_STATE_DIRECTORY}/replay-ledger.json"
REPLAY_LEDGER_MAX_ENTRIES = 64
MAX_REPLAY_LEDGER_BYTES = 16384
B64URL = re.compile(r"^[A-Za-z0-9_-]+$")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
UNAVAILABLE = b'{"result":"unavailable"}'


class Deny(Exception):
    """Raised for any invalid or uncertain condition without detail."""


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise Deny()
        value[key] = item
    return value


def _regular_root(path: Path, mode: int) -> bool:
    try:
        metadata = path.lstat()
    except OSError:
        return False
    return (
        stat.S_ISREG(metadata.st_mode)
        and not path.is_symlink()
        and metadata.st_uid == 0
        and metadata.st_gid == 0
        and stat.S_IMODE(metadata.st_mode) == mode
        and metadata.st_nlink == 1
    )


def _safe_directory(path: Path, mode: int) -> bool:
    try:
        metadata = path.lstat()
    except OSError:
        return False
    return (
        stat.S_ISDIR(metadata.st_mode)
        and not path.is_symlink()
        and metadata.st_uid == 0
        and metadata.st_gid == 0
        and stat.S_IMODE(metadata.st_mode) == mode
    )


def _encrypted_credential_sources() -> tuple[Path, Path]:
    """Require pre-existing encrypted sources by metadata only, never by content."""
    root = Path(ENCRYPTED_CREDENTIALS_DIRECTORY)
    if not _safe_directory(root, 0o700):
        raise Deny()
    cert, key = (root / name for name in ENCRYPTED_CREDENTIAL_NAMES)
    if not all(_regular_root(path, 0o600) for path in (cert, key)):
        raise Deny()
    return cert, key


def _credential_paths(credentials_directory: str | None) -> tuple[Path, Path]:
    if not isinstance(credentials_directory, str) or not credentials_directory:
        raise Deny()
    root = Path(credentials_directory)
    if not root.is_absolute() or root.parent != Path("/run/credentials") or not _safe_directory(root, 0o700):
        raise Deny()
    cert, key = (root / name for name in CREDENTIAL_NAMES)
    if not all(_regular_root(path, 0o400) for path in (cert, key)):
        raise Deny()
    return cert, key


def load_config(path: str = CONFIG_PATH) -> dict[str, Any]:
    file_path = Path(path)
    if not _regular_root(file_path, 0o600):
        raise Deny()
    try:
        text = file_path.read_text(encoding="ascii")
    except (OSError, UnicodeError):
        raise Deny() from None
    allowed = {"RELAY_MODE", "EDGE_PEER_UID"}
    value: dict[str, str] = {}
    for line in text.splitlines():
        if not line or line.startswith("#") or "=" not in line:
            raise Deny()
        key, item = line.split("=", 1)
        if key not in allowed or key in value or not item or item.strip() != item:
            raise Deny()
        value[key] = item
    if set(value) != allowed or value["RELAY_MODE"] not in {"disabled", "active"}:
        raise Deny()
    if not value["EDGE_PEER_UID"].isdigit():
        raise Deny()
    peer_uid = int(value["EDGE_PEER_UID"])
    if peer_uid <= 0 or peer_uid > 2**31 - 1:
        raise Deny()
    return {"mode": value["RELAY_MODE"], "peer_uid": peer_uid}


def _b64(value: Any, lower: int, upper: int) -> bool:
    return isinstance(value, str) and lower <= len(value) <= upper and B64URL.fullmatch(value) is not None


def _utc_now_seconds() -> int:
    """Return the current UTC Unix timestamp without accepting a caller clock."""
    return int(datetime.now(timezone.utc).timestamp())


def _valid_expires_at(value: Any, now: int | None = None) -> bool:
    """Require an integer UTC expiry with bounded local leeway and maximum TTL."""
    if type(value) is not int:
        return False
    current = _utc_now_seconds() if now is None else now
    return value > current + MINIMUM_EXPIRY_LEEWAY_SECONDS and value <= current + MAX_REQUEST_TTL_SECONDS


def _validate_sealed(value: Any, now: int | None = None) -> bool:
    if not isinstance(value, dict) or set(value) != {"challenge", "ephemeralKey", "iv", "ciphertext"}:
        return False
    challenge = value["challenge"]
    return (
        isinstance(challenge, dict) and set(challenge) == {"requestId", "role", "fingerprint", "purpose", "nonce", "expiresAt"} and
        isinstance(challenge["requestId"], str) and challenge["role"] == DO_WRITER_ROLE and
        isinstance(challenge["fingerprint"], str) and re.fullmatch(r"sha256:[a-f0-9]{64}", challenge["fingerprint"]) is not None and
        challenge["purpose"] == "claim" and isinstance(challenge["nonce"], str) and HEX64.fullmatch(challenge["nonce"]) is not None and
        _valid_expires_at(challenge["expiresAt"], now) and _b64(value["ephemeralKey"], 87, 87) and _b64(value["iv"], 16, 16) and _b64(value["ciphertext"], 22, 2800)
    )


def parse_request(raw: bytes) -> dict[str, Any]:
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_REQUEST_BYTES:
        raise Deny()
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_strict_object)
    except (UnicodeError, json.JSONDecodeError, Deny):
        raise Deny() from None
    if not isinstance(value, dict) or set(value) != {"purpose", "requestId", "role", "recipientFingerprint", "sealed", "authorization"}:
        raise Deny()
    if (
        value["purpose"] != PURPOSE or not isinstance(value["requestId"], str) or
        value["role"] != DO_WRITER_ROLE or
        not isinstance(value["recipientFingerprint"], str) or re.fullmatch(r"sha256:[a-f0-9]{64}", value["recipientFingerprint"]) is None or
        not _validate_sealed(value["sealed"]) or not isinstance(value["authorization"], str) or not _b64(value["authorization"], 32, 2048)
    ):
        raise Deny()
    try:
        parsed = uuid.UUID(value["requestId"])
    except (ValueError, AttributeError):
        raise Deny() from None
    if str(parsed) != value["requestId"] or parsed.version != 4:
        raise Deny()
    if value["sealed"]["challenge"]["requestId"] != value["requestId"] or value["sealed"]["challenge"]["role"] != value["role"] or value["sealed"]["challenge"]["fingerprint"] != value["recipientFingerprint"]:
        raise Deny()
    if raw != canonical_request(value):
        raise Deny()
    return value


def canonical_request(value: dict[str, Any]) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("ascii")
    except (TypeError, UnicodeError):
        raise Deny() from None


class ReplayLedger:
    """A root-only, secret-free, crash-safe claim ledger for one-time entries."""

    def __init__(self, path: str = REPLAY_LEDGER_PATH):
        self.path = Path(path)

    @staticmethod
    def _valid_claim(value: Any) -> bool:
        if not isinstance(value, dict) or set(value) != {"requestId", "nonce", "expiresAt"}:
            return False
        try:
            request_id = uuid.UUID(value["requestId"])
        except (ValueError, AttributeError, TypeError):
            return False
        return (
            str(request_id) == value["requestId"] and request_id.version == 4 and
            isinstance(value["nonce"], str) and HEX64.fullmatch(value["nonce"]) is not None and
            type(value["expiresAt"]) is int and value["expiresAt"] > 0
        )

    def _load(self) -> list[dict[str, Any]]:
        if not _safe_directory(self.path.parent, 0o700):
            raise Deny()
        try:
            metadata = self.path.lstat()
        except FileNotFoundError:
            return []
        except OSError:
            raise Deny() from None
        if not _regular_root(self.path, 0o600):
            raise Deny()
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(self.path, flags)
            try:
                opened = os.fstat(descriptor)
                if (
                    not stat.S_ISREG(opened.st_mode) or opened.st_uid != 0 or opened.st_gid != 0 or
                    stat.S_IMODE(opened.st_mode) != 0o600 or opened.st_nlink != 1 or opened.st_ino != metadata.st_ino
                ):
                    raise Deny()
                chunks: list[bytes] = []
                remaining = MAX_REPLAY_LEDGER_BYTES + 1
                while remaining:
                    chunk = os.read(descriptor, remaining)
                    if not chunk:
                        break
                    chunks.append(chunk)
                    remaining -= len(chunk)
                raw = b"".join(chunks)
            finally:
                os.close(descriptor)
        except (OSError, Deny):
            raise Deny() from None
        if not raw or len(raw) > MAX_REPLAY_LEDGER_BYTES:
            raise Deny()
        try:
            value = json.loads(raw.decode("ascii"), object_pairs_hook=_strict_object)
        except (UnicodeError, json.JSONDecodeError, Deny):
            raise Deny() from None
        if not isinstance(value, dict) or set(value) != {"version", "claims"} or value["version"] != 1 or not isinstance(value["claims"], list):
            raise Deny()
        claims = value["claims"]
        if len(claims) > REPLAY_LEDGER_MAX_ENTRIES or not all(self._valid_claim(claim) for claim in claims):
            raise Deny()
        request_ids = [claim["requestId"] for claim in claims]
        nonces = [claim["nonce"] for claim in claims]
        if len(set(request_ids)) != len(request_ids) or len(set(nonces)) != len(nonces):
            raise Deny()
        if raw != canonical_request(value):
            raise Deny()
        return claims

    def _persist(self, claims: list[dict[str, Any]]) -> None:
        if not _safe_directory(self.path.parent, 0o700) or len(claims) > REPLAY_LEDGER_MAX_ENTRIES:
            raise Deny()
        raw = canonical_request({"version": 1, "claims": claims})
        if not raw or len(raw) > MAX_REPLAY_LEDGER_BYTES:
            raise Deny()
        temporary = self.path.with_name(f".{self.path.name}.tmp")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor: int | None = None
        try:
            descriptor = os.open(temporary, flags, 0o600)
            os.fchmod(descriptor, 0o600)
            os.fchown(descriptor, 0, 0)
            written = os.write(descriptor, raw)
            if written != len(raw):
                raise Deny()
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = None
            os.replace(temporary, self.path)
            if not _regular_root(self.path, 0o600):
                raise Deny()
            directory_descriptor = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_CLOEXEC", 0))
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
        except (OSError, Deny):
            raise Deny() from None
        finally:
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                raise Deny() from None

    def prepare(self) -> None:
        """Reject unsafe storage and atomically prune expired records at startup."""
        now = _utc_now_seconds()
        claims = self._load()
        live = [claim for claim in claims if claim["expiresAt"] > now]
        if len(live) != len(claims):
            self._persist(live)

    def claim(self, request_id: str, nonce: str, expires_at: int) -> None:
        """Persist a requestId/nonce pair before the sole permitted network call."""
        now = _utc_now_seconds()
        if not _valid_expires_at(expires_at, now):
            raise Deny()
        claims = self._load()
        live = [claim for claim in claims if claim["expiresAt"] > now]
        if any(claim["requestId"] == request_id or claim["nonce"] == nonce for claim in live):
            raise Deny()
        if len(live) >= REPLAY_LEDGER_MAX_ENTRIES:
            raise Deny()
        live.append({"requestId": request_id, "nonce": nonce, "expiresAt": expires_at})
        self._persist(live)


class RateLimiter:
    def __init__(self, now: Callable[[], float] = time.monotonic):
        self.now = now
        self.samples: deque[float] = deque()

    def consume(self) -> None:
        current = self.now()
        while self.samples and current - self.samples[0] >= RATE_LIMIT_WINDOW_SECONDS:
            self.samples.popleft()
        if len(self.samples) >= RATE_LIMIT_MAX_REQUESTS:
            raise Deny()
        self.samples.append(current)


def _tls_context(credentials_directory: str | None) -> ssl.SSLContext:
    cert, key = _credential_paths(credentials_directory)
    context = ssl.create_default_context(purpose=ssl.Purpose.SERVER_AUTH)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    try:
        context.load_cert_chain(certfile=str(cert), keyfile=str(key))
    except (OSError, ssl.SSLError):
        raise Deny() from None
    return context


def forward_to_signer(raw: bytes, credentials_directory: str | None) -> bytes:
    """Single POST to the only allowed signer endpoint; never follows redirects or retries."""
    connection: http.client.HTTPSConnection | None = None
    try:
        connection = http.client.HTTPSConnection(SIGNER_HOST, 443, context=_tls_context(credentials_directory), timeout=OUTBOUND_TIMEOUT_SECONDS)
        connection.request("POST", SIGNER_PATH, body=raw, headers={"Content-Type": "application/json", "Content-Length": str(len(raw))})
        reply = connection.getresponse()
        content_type = (reply.getheader("Content-Type") or "").split(";", 1)[0].strip().lower()
        body = reply.read(MAX_RESPONSE_BYTES + 1)
        if reply.status != 200 or content_type != "application/json" or not body or len(body) > MAX_RESPONSE_BYTES:
            raise Deny()
        parse_delivery(body)
        return body
    except (OSError, ValueError, http.client.HTTPException, ssl.SSLError, Deny):
        raise Deny() from None
    finally:
        if connection is not None:
            connection.close()


def parse_delivery(raw: bytes) -> dict[str, Any]:
    """Only a complete, request-bound sealed delivery can return to the local caller."""
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_strict_object)
    except (UnicodeError, json.JSONDecodeError, Deny):
        raise Deny() from None
    if not isinstance(value, dict) or set(value) != {"sealed", "signature"}:
        raise Deny()
    if not _validate_sealed(value["sealed"]):
        raise Deny()
    signature = value["signature"]
    if not isinstance(signature, str) or len(signature) != 86 or B64URL.fullmatch(signature) is None:
        raise Deny()
    return value


def _same_delivery(request: dict[str, Any], response: dict[str, Any]) -> bool:
    return response["sealed"] == request["sealed"]


def dispatch(raw: bytes, peer_uid: int, config: dict[str, Any], limiter: RateLimiter, forwarder: Callable[[bytes, str | None], bytes], credentials_directory: str | None, ledger: ReplayLedger) -> bytes:
    """Authorize locally before any credential access or outbound network call."""
    if config.get("mode") != "active" or not isinstance(peer_uid, int) or peer_uid != config.get("peer_uid"):
        raise Deny()
    request = parse_request(raw)
    limiter.consume()
    challenge = request["sealed"]["challenge"]
    ledger.claim(request["requestId"], challenge["nonce"], challenge["expiresAt"])
    reply = forwarder(canonical_request(request), credentials_directory)
    if not _same_delivery(request, parse_delivery(reply)):
        raise Deny()
    return reply


def _peer_uid(connection: socket.socket) -> int:
    try:
        raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        _pid, uid, _gid = struct.unpack("3i", raw)
    except (OSError, struct.error):
        raise Deny() from None
    return uid


def _receive_exact(connection: socket.socket, size: int) -> bytes:
    if size < 1 or size > MAX_REQUEST_BYTES:
        raise Deny()
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = connection.recv(remaining)
        if not chunk:
            raise Deny()
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _receive_framed(connection: socket.socket) -> bytes:
    size = struct.unpack("!I", _receive_exact(connection, 4))[0]
    return _receive_exact(connection, size)


def _safe_socket_parent(path: Path, peer_uid: int) -> None:
    parent = path.parent
    if parent.exists():
        if not _safe_directory(parent, 0o711):
            raise Deny()
    else:
        parent.mkdir(mode=0o711, parents=True)
        os.chown(parent, 0, 0)
        if not _safe_directory(parent, 0o711):
            raise Deny()
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return
    except OSError:
        raise Deny() from None
    if not stat.S_ISSOCK(metadata.st_mode) or metadata.st_uid != peer_uid or metadata.st_gid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise Deny()
    try:
        path.unlink()
    except OSError:
        raise Deny() from None


def run() -> int:
    server: socket.socket | None = None
    socket_path = Path(SOCKET_PATH)
    bound = False
    try:
        if os.geteuid() != 0:
            raise Deny()
        _encrypted_credential_sources()
        _credential_paths(os.environ.get("CREDENTIALS_DIRECTORY"))
        config = load_config()
        if config["mode"] != "active":
            raise Deny()
        ledger = ReplayLedger()
        ledger.prepare()
        _safe_socket_parent(socket_path, config["peer_uid"])
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.settimeout(LOCAL_TIMEOUT_SECONDS)
        server.bind(SOCKET_PATH)
        bound = True
        os.chown(SOCKET_PATH, config["peer_uid"], 0)
        os.chmod(SOCKET_PATH, 0o600)
        limiter = RateLimiter()
        while True:
            connection: socket.socket | None = None
            try:
                connection, _ = server.accept()
                connection.settimeout(LOCAL_TIMEOUT_SECONDS)
                peer = _peer_uid(connection)
                raw = _receive_framed(connection)
                result = dispatch(raw, peer, config, limiter, forward_to_signer, os.environ.get("CREDENTIALS_DIRECTORY"), ledger)
                connection.sendall(result)
            except (Deny, OSError):
                if connection is not None:
                    try:
                        connection.sendall(UNAVAILABLE)
                    except OSError:
                        pass
            finally:
                if connection is not None:
                    connection.close()
    except (Deny, OSError):
        return 78
    finally:
        if server is not None:
            server.close()
        if bound:
            try:
                socket_path.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                return 78
    return 78


if __name__ == "__main__":
    sys.exit(run())
