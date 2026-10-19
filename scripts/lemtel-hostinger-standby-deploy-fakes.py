#!/usr/bin/env python3
"""Test-only fake for docker, curl and systemctl used by lemtel-hostinger-standby-deploy.test.mjs.

State lives in $FAKE_STATE (JSON). Every invocation is appended to $FAKE_STATE.log. Never used outside tests.
"""
import json, os, re, sys
from pathlib import Path

STATE = Path(os.environ['FAKE_STATE'])
tool = Path(sys.argv[0]).name
args = sys.argv[1:]
state = json.loads(STATE.read_text())
with open(str(STATE) + '.log', 'a') as log:
    log.write(json.dumps([tool, *args]) + '\n')

def save():
    STATE.write_text(json.dumps(state))

def out(text, code=0):
    sys.stdout.write(text); save(); sys.exit(code)

def edge():
    return state['edge']

def compose_inputs(argv):
    envs, files = [], []
    for i, value in enumerate(argv):
        if value == '--env-file': envs.append(argv[i + 1])
        if value == '-f': files.append(argv[i + 1])
    return envs, files

def hash_for(envs, files):
    if envs == state['base_env_files'] and files == state['base_config_files']:
        return state['base_hash']
    return 'f' * 64

if tool == 'docker':
    if args[:1] == ['ps']:
        if '--filter' in args:
            name = args[args.index('--filter') + 1].split('^/')[1].rstrip('$')
            out(edge()['id'] + '\n' if name == 'supabase-edge-functions' else '')
        out(''.join(f'{n}|{img}\n' for n, img in state['containers'].items()))
    if args[:1] == ['inspect']:
        template, target = args[2], args[3]
        if target == state.get('standby_name'):
            out('true\n' if state.get('standby_running', True) else 'false\n')
        e = edge()
        if template == '{{.State.Running}}': out('true\n')
        m = re.fullmatch(r'\{\{index \.Config\.Labels "([^"]+)"\}\}', template)
        if m: out(e['labels'].get(m.group(1), '') + '\n')
        m = re.search(r'eq \(index \(split \. "="\) 0\) "([A-Z_]+)"', template)
        if m: out(('present' if m.group(1) in e['env'] else '') + '\n')
        if '.Mounts' in template: out('bind:' + state['functions_mount'] + ';\n')
        out('\n', 1)
    if args[:1] == ['exec']:
        joined = ' '.join(args)
        if 'pg_is_in_recovery' in joined:
            out(('t' if state.get('recovery') else 'f') + ('rue\n' if state.get('recovery') else 'alse\n'))
        if 'to_regclass' in joined: out(state['schema'] + '\n')
        if '-i' in args:
            sys.stdin.read(); state['schema'] = 'present'; out('')
        if '${#v}' in joined:
            out('', 0 if 'LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET' in edge()['env'] else 1)
        out('', 1)
    if args[:1] == ['compose']:
        envs, files = compose_inputs(args)
        if 'config' in args and '--hash' in args: out(f"{args[-1]} {hash_for(envs, files)}\n")
        if 'config' in args and '--quiet' in args:
            out('', 0 if all(Path(state['root'] + p if not p.startswith(state['root']) else p).exists() for p in envs) else 1)
        if 'up' in args:
            if state.get('fail_recreate'): out('', 1)
            e = edge(); e['id'] = format(int(e['id'][:8], 16) + 1, '08x') + e['id'][8:]
            strip = lambda p: p[len(state['root']):] if p.startswith(state['root']) else p
            e['labels']['com.docker.compose.project.config_files'] = ','.join(strip(p) for p in files)
            e['labels']['com.docker.compose.project.environment_file'] = ','.join(strip(p) for p in envs)
            e['labels']['com.docker.compose.config-hash'] = hash_for(envs, files)
            e['env'] = list(state['base_env_keys']) + (['LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET'] if any(p.endswith('hostinger-standby/edge-config/edge-secret.env') or p.endswith('hostinger-standby-publisher/edge-config/edge-secret.env') for p in envs) else [])
            out('')
    if args[:1] == ['restart']: out('')
    out('', 1)

if tool == 'curl':
    sys.stdin.read()
    out(state.get('probe_status', '401'))

if tool == 'systemctl':
    if args[:1] == ['show']:
        name = args[1]
        scheduled = state.get('timers_scheduled', True) and name in state.setdefault('enabled', [])
        out(f"ActiveState={'active' if scheduled else 'inactive'}\nUnitFileState={'enabled' if scheduled else 'disabled'}\nNextElapseUSecMonotonic={'123456789' if scheduled else '0'}\n")
    if '--now' in args and 'enable' in args:
        state.setdefault('enabled', []).append(args[-1]); out('')
    if 'disable' in args:
        if args[-1] in state.setdefault('enabled', []): state['enabled'].remove(args[-1])
        out('')
    out('')

out('', 1)
