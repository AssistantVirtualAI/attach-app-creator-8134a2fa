#!/usr/bin/python3
"""Validate or safely extract the single-file Lemtel Operations portal ZIP artifact."""
import os
import re
import stat
import sys
import zipfile

MAX_FILES = 100
MAX_BYTES = 25 * 1024 * 1024
ASSET = re.compile(r'^assets/[A-Za-z0-9][A-Za-z0-9._-]{0,191}\.(css|js|woff2?|ttf|svg|png|jpe?g|webp)$')
PORTAL_ENTRY = 'lemtel-portal.html'


def normalized(name: str) -> str:
    if not name or name.startswith('/') or '\\' in name or any(part in ('', '.', '..') for part in name.split('/')):
        raise ValueError
    return name


def validate(archive: str):
    files = []
    seen = set()
    total = 0
    with zipfile.ZipFile(archive, 'r') as bundle:
        infos = bundle.infolist()
        if not infos or len(infos) > MAX_FILES + 1:
            raise ValueError
        for info in infos:
            if info.flag_bits & 1:
                raise ValueError
            raw = info.filename
            is_directory = info.is_dir()
            name = raw[:-1] if is_directory and raw.endswith('/') else raw
            normalized(name)
            mode = (info.external_attr >> 16) & 0xFFFF
            kind = stat.S_IFMT(mode)
            if kind == stat.S_IFLNK or (kind and kind not in (stat.S_IFREG, stat.S_IFDIR)):
                raise ValueError
            if is_directory:
                if raw != 'assets/' or kind == stat.S_IFREG:
                    raise ValueError
                continue
            if raw != name or name in seen or (name != PORTAL_ENTRY and not ASSET.fullmatch(name)):
                raise ValueError
            seen.add(name)
            total += info.file_size
            if total > MAX_BYTES:
                raise ValueError
            files.append(info)
        if len(files) < 2 or PORTAL_ENTRY not in seen or not any(ASSET.fullmatch(name) for name in seen):
            raise ValueError
    return files


def extract(archive: str, destination: str) -> None:
    files = validate(archive)
    if not os.path.isdir(destination) or os.path.islink(destination) or os.listdir(destination):
        raise ValueError
    os.chmod(destination, 0o755)
    assets = os.path.join(destination, 'assets')
    with zipfile.ZipFile(archive, 'r') as bundle:
        for info in files:
            name = info.filename
            output = os.path.join(destination, name)
            parent = os.path.dirname(output)
            if parent != destination:
                os.makedirs(parent, mode=0o755, exist_ok=True)
                os.chmod(parent, 0o755)
            fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            try:
                with os.fdopen(fd, 'wb') as target, bundle.open(info, 'r') as source:
                    remaining = info.file_size
                    while remaining:
                        chunk = source.read(min(65536, remaining))
                        if not chunk:
                            raise ValueError
                        target.write(chunk)
                        remaining -= len(chunk)
                    if source.read(1):
                        raise ValueError
                    target.flush()
                    os.fsync(target.fileno())
            except Exception:
                try:
                    os.unlink(output)
                except OSError:
                    pass
                raise
            os.chmod(output, 0o644)
    if os.path.isdir(assets):
        os.chmod(assets, 0o755)


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == '--validate':
        try:
            validate(sys.argv[2])
        except Exception:
            return 65
        print('portal_zip_validation=ok')
        return 0
    if len(sys.argv) == 4 and sys.argv[1] == '--extract':
        try:
            extract(sys.argv[2], sys.argv[3])
        except Exception:
            return 65
        print('portal_zip_extract=ok')
        return 0
    return 64


if __name__ == '__main__':
    raise SystemExit(main())
