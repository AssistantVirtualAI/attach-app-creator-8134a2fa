#!/usr/bin/python3
"""Durable transaction journal for Lemtel portal directory exchange and recovery."""
import ctypes
import json
import os
import shutil
import stat
import sys

AT_FDCWD = -100
RENAME_EXCHANGE = 2


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def directory_identity(path):
    info = os.lstat(path)
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise ValueError
    return {'device': info.st_dev, 'inode': info.st_ino}


def exchange(left, right):
    if os.path.dirname(left) != os.path.dirname(right):
        raise ValueError
    left_id = directory_identity(left)
    right_id = directory_identity(right)
    if left_id['device'] != right_id['device']:
        raise ValueError
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = libc.renameat2
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    if renameat2(AT_FDCWD, os.fsencode(left), AT_FDCWD, os.fsencode(right), RENAME_EXCHANGE) != 0:
        raise OSError(ctypes.get_errno(), 'renameat2')
    fsync_directory(os.path.dirname(left))


def load(journal, live):
    raw = open(journal, 'rb').read()
    if not raw or len(raw) > 4096:
        raise ValueError
    data = json.loads(raw, object_pairs_hook=no_duplicates)
    if set(data) != {'format', 'live_path', 'stage_path', 'live_before', 'stage_before'}:
        raise ValueError
    if data['format'] != 'lemtel_portal_static_refresh_transaction_v1' or data['live_path'] != live:
        raise ValueError
    stage = data['stage_path']
    if not isinstance(stage, str) or os.path.dirname(stage) != os.path.dirname(live):
        raise ValueError
    for key in ('live_before', 'stage_before'):
        value = data[key]
        if set(value) != {'device', 'inode'} or not isinstance(value['device'], int) or not isinstance(value['inode'], int):
            raise ValueError
    return data


def state(data):
    live_now = directory_identity(data['live_path'])
    stage_now = directory_identity(data['stage_path'])
    if live_now == data['live_before'] and stage_now == data['stage_before']:
        return 'not_swapped'
    if live_now == data['stage_before'] and stage_now == data['live_before']:
        return 'swapped'
    return 'ambiguous'


def clear(journal):
    os.unlink(journal)
    fsync_directory(os.path.dirname(journal))


def discard_uncommitted_stage(data):
    info = os.lstat(data['stage_path'])
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise ValueError
    shutil.rmtree(data['stage_path'])
    fsync_directory(os.path.dirname(data['stage_path']))


def prepare(journal, live, stage):
    if os.path.exists(journal) or os.path.islink(journal):
        raise ValueError
    if os.path.dirname(live) != os.path.dirname(stage):
        raise ValueError
    document = {
        'format': 'lemtel_portal_static_refresh_transaction_v1',
        'live_path': live,
        'stage_path': stage,
        'live_before': directory_identity(live),
        'stage_before': directory_identity(stage),
    }
    fd = os.open(journal, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(document, output, sort_keys=True, separators=(',', ':'))
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
    finally:
        fsync_directory(os.path.dirname(journal))


def main() -> int:
    try:
        if len(sys.argv) < 4:
            return 64
        command, journal, live = sys.argv[1:4]
        if command == 'prepare':
            if len(sys.argv) != 5:
                return 64
            prepare(journal, live, sys.argv[4])
            print('transaction_prepared=true')
            return 0
        if command not in ('recover', 'commit', 'swap') or len(sys.argv) != 4:
            return 64
        if not os.path.exists(journal):
            if command == 'recover':
                print('transaction_recovery=no_pending')
                return 0
            return 65
        data = load(journal, live)
        current = state(data)
        if command == 'swap':
            if current != 'not_swapped':
                return 65
            exchange(data['live_path'], data['stage_path'])
            if state(data) != 'swapped':
                return 66
            print('transaction_swap=complete')
            return 0
        if command == 'commit':
            if current != 'swapped':
                return 65
            clear(journal)
            print('transaction_commit=complete')
            return 0
        if current == 'swapped':
            exchange(data['live_path'], data['stage_path'])
            if state(data) != 'not_swapped':
                return 66
        elif current != 'not_swapped':
            return 66
        discard_uncommitted_stage(data)
        clear(journal)
        print('transaction_recovery=complete')
        return 0
    except (AttributeError, OSError, ValueError, json.JSONDecodeError):
        return 66


if __name__ == '__main__':
    raise SystemExit(main())
