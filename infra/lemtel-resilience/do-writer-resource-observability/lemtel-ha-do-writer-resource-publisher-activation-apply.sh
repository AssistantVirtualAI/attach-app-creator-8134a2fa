#!/usr/bin/env bash
# Root-only activation of the writer’s redacted resource publisher; no failover behavior.
set -euo pipefail
set +x
umask 077

scope() {
  printf 'hostinger_contacted=false\ncloudflare_or_dns_changed=false\nautomatic_failover_enabled=false\nfencing_executed=false\ntelephony_contacted=false\ncredential_values_emitted=false\n'
}
fail() {
  printf 'do_writer_resource_publisher_activation_status=failed\nreason=%s\n' "$1"
  scope
  exit 78
}
[[ "$EUID" -eq 0 ]] || fail root_required
[[ "$#" -eq 0 ]] || fail invalid_arguments
[[ "${LEMTEL_HA_ROLE:-}" = digitalocean_writer ]] || fail writer_role_required
[[ "${LEMTEL_DO_WRITER_RESOURCE_PUBLISHER_EXECUTE:-}" = activate_verified_do_writer_resource_publisher ]] || fail intent_required
[[ "${LEMTEL_DO_WRITER_RESOURCE_PUBLISHER_SNAPSHOT_ATTESTATION:-}" = FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED ]] || fail fresh_snapshot_attestation_required
[[ "${LEMTEL_DO_WRITER_RESOURCE_PUBLISHER_PACKAGE_REVIEW:-}" = REVIEWED_DO_WRITER_RESOURCE_PUBLISHER ]] || fail package_review_required
[[ -x /usr/bin/python3 ]] || fail local_runtime_required
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec /usr/bin/python3 - "$source_dir" 2>/dev/null <<'PY'
import fcntl, hashlib, json, os, re, secrets, signal, stat, subprocess, sys, tempfile
from pathlib import Path
os.umask(0o077)
SOURCE=Path(sys.argv[1])
ROOT=Path('/var/lib/lemtel-ha/do-writer-resource-publisher')
CONFIG=Path('/etc/lemtel-ha/do-writer-resource-publisher.env')
LIB=Path('/usr/local/libexec/lemtel-do-writer-resource-publisher')
PUBLISHER=LIB/'publish.sh'
SERVICE=Path('/etc/systemd/system/lemtel-do-writer-resource-publisher.service')
TIMER=Path('/etc/systemd/system/lemtel-do-writer-resource-publisher.timer')
WANTS=Path('/etc/systemd/system/timers.target.wants/lemtel-do-writer-resource-publisher.timer')
EDGE_CONFIG=ROOT/'edge-config'
EDGE_ENV=EDGE_CONFIG/'edge-secret.env'
OVERRIDE=EDGE_CONFIG/'edge-resource-publisher.override.yaml'
LOCK=Path('/run/lemtel-do-writer-resource-publisher-activation.lock')
MANIFEST=SOURCE/'publisher-activation-manifest.json'
KEY='LEMTEL_DO_WRITER_RESOURCE_SECRET'
ENDPOINT='https://lemtel.assistantvirtualai.com/functions/v1/lemtel-do-writer-resource-ingest'
class Refusal(Exception): pass
def require(value):
    if not value: raise Refusal()
def scope():
    for value in ('hostinger_contacted=false','cloudflare_or_dns_changed=false','automatic_failover_enabled=false','fencing_executed=false','telephony_contacted=false','credential_values_emitted=false'): print(value)
def exists(path): return os.path.lexists(path)
def identity(meta): return (meta.st_dev, meta.st_ino)
def secure_directory(path):
    for item in (path, *path.parents):
        meta=item.lstat(); require(stat.S_ISDIR(meta.st_mode) and meta.st_uid==0 and not meta.st_mode & 0o022)
def secure_file(path, mode=None):
    secure_directory(path.parent); meta=path.lstat()
    require(stat.S_ISREG(meta.st_mode) and meta.st_uid==0 and meta.st_nlink==1 and not meta.st_mode & 0o022)
    if mode is not None: require(stat.S_IMODE(meta.st_mode)==mode)
    return meta
def read_protected(path, mode=None, limit=1048576):
    meta=secure_file(path,mode); fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        require(identity(os.fstat(stream.fileno()))==identity(meta)); value=stream.read(limit+1); require(len(value)<=limit)
    return value
def checked_path(value):
    require(re.fullmatch(r'/[A-Za-z0-9/_.-]+',value) is not None and '//' not in value)
    path=Path(value); require(str(path)==value and not any(part in ('.','..') for part in path.parts)); return path
def command(argv, timeout=90):
    process=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/','LANG':'C','DOCKER_CONFIG':'/proc/self','DOCKER_HOST':'unix:///var/run/docker.sock'},cwd='/',start_new_session=True)
    try: out,err=process.communicate(timeout=timeout)
    except BaseException:
        os.killpg(process.pid,signal.SIGKILL); process.communicate(); raise Refusal() from None
    require(process.returncode==0 and len(out)<=1048576 and len(err)<=1048576)
    return out.decode('utf-8','strict'),err.decode('utf-8','strict')
def quiet(argv, timeout=90):
    out,err=command(argv,timeout); require(not out and not err)
def docker_value(template, container):
    out,err=command(['docker','inspect','--format',template,container]); require(not err and out.endswith('\n') and '\n' not in out[:-1]); return out[:-1]
def hash_file(path):
    return hashlib.sha256(read_protected(path)).hexdigest()
def container_for(name):
    out,err=command(['docker','ps','-a','--no-trunc','--filter','name=^/'+name+'$','--format','{{.ID}}'])
    rows=out.splitlines(); require(not err and len(rows)==1 and re.fullmatch(r'[a-f0-9]{64}',rows[0]))
    require(docker_value('{{.Name}}',rows[0])=='/'+name and docker_value('{{.State.Running}}',rows[0])=='true'); return rows[0]
def label(container,key): return docker_value('{{with index .Config.Labels "'+key+'"}}{{.}}{{end}}',container)
def mount_for(container,destination):
    value=docker_value('{{range .Mounts}}{{if eq .Destination "'+destination+'"}}{{.Type}}:{{.Source}};{{end}}{{end}}',container)
    require(value.startswith('bind:') and value.count(';')==1 and value.endswith(';')); return checked_path(value[5:-1])
def path_list(value):
    values=[checked_path(part) for part in value.split(',') if part]; require(values and len(values)<=16 and len(set(values))==len(values)); return values
class Transaction:
    def __init__(self):
        self.created=[]; self.directories=[]; self.edge=None; self.edge_attempted=False; self.timer_attempted=False; self.committed=False; self.phase='preflight'; self.guard='entry'
    def create(self,path,data,mode):
        secure_directory(path.parent); require(not exists(path)); fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
        try:
            with os.fdopen(fd,'wb') as stream: stream.write(data); stream.flush(); os.fsync(stream.fileno())
        except BaseException: raise Refusal() from None
        os.chown(path,0,0); meta=secure_file(path,mode); self.created.append((path,identity(meta)))
    def mkdir(self,path):
        secure_directory(path.parent); require(not exists(path)); path.mkdir(mode=0o700); os.chown(path,0,0); secure_directory(path); self.directories.append((path,identity(path.lstat())))
    def remove(self,path):
        for item,expected in reversed(self.created):
            if item==path and exists(path): require(identity(secure_file(path))==expected); path.unlink(); return
    def prepare(self):
        self.guard='source_directory'; secure_directory(SOURCE)
        self.guard='source_manifest_read'; data=json.loads(read_protected(MANIFEST).decode('utf-8'))
        self.guard='source_manifest_shape'
        require(data.get('package_format')=='lemtel_do_writer_resource_publisher_activation_v1' and data.get('target_role')=='digitalocean_writer')
        required={'publisher':'lemtel-do-writer-resource-publish.sh','service':'lemtel-do-writer-resource-publisher.service','timer':'lemtel-do-writer-resource-publisher.timer'}
        require(data.get('files')==required and set(data.get('sha256',{}))==set(required))
        self.guard='source_component_hashes'
        for key,name in required.items():
            relative_path=Path(name) if key=='publisher' else Path('systemd')/name
            require(re.fullmatch(r'[a-f0-9]{64}',data['sha256'][key]) is not None and hash_file(SOURCE/relative_path)==data['sha256'][key])
        self.publisher_source=SOURCE/required['publisher']; self.service_source=SOURCE/'systemd'/required['service']; self.timer_source=SOURCE/'systemd'/required['timer']; self.ingest_hash=data.get('ingest_sha256'); self.guard='source_ingest_hash'; require(re.fullmatch(r'[a-f0-9]{64}',self.ingest_hash or '') is not None)
        self.guard='runtime_identity'; self.edge=container_for('supabase-edge-functions'); self.project=label(self.edge,'com.docker.compose.project'); self.service=label(self.edge,'com.docker.compose.service')
        require(re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}',self.project) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,62}',self.service))
        require(label(self.edge,'com.docker.compose.container-number')=='1' and label(self.edge,'com.docker.compose.oneoff')=='False')
        self.config_files=path_list(label(self.edge,'com.docker.compose.project.config_files')); work=label(self.edge,'com.docker.compose.project.working_dir'); self.workdir=checked_path(work) if work else self.config_files[0].parent; secure_directory(self.workdir)
        raw_env=label(self.edge,'com.docker.compose.project.environment_file'); self.base_env=path_list(raw_env) if raw_env else ([self.workdir/'.env'] if exists(self.workdir/'.env') else [])
        for path in [*self.config_files,*self.base_env]: secure_file(path,0o600 if path in self.base_env else None)
        functions=mount_for(self.edge,'/home/deno/functions'); require(hash_file(functions/'lemtel-do-writer-resource-ingest'/'index.ts')==self.ingest_hash)
        self.guard='initial_absence'; presence=docker_value('{{range .Config.Env}}{{if eq (index (split . "=") 0) "'+KEY+'"}}present{{end}}{{end}}',self.edge); require(presence=='')
        for path in (ROOT,CONFIG,LIB,PUBLISHER,SERVICE,TIMER,WANTS,EDGE_CONFIG,EDGE_ENV,OVERRIDE,LOCK): require(not exists(path))
        self.guard='secret_generation'; secret=secrets.token_hex(32); require(re.fullmatch(r'[a-f0-9]{64}',secret) is not None); return secret
    def compose(self,additional):
        value=['docker','compose','--project-name',self.project,'--project-directory',str(self.workdir)]
        for path in self.base_env: value += ['--env-file',str(path)]
        if additional: value += ['--env-file',str(EDGE_ENV)]
        for path in self.config_files: value += ['-f',str(path)]
        if additional: value += ['-f',str(OVERRIDE)]
        return value
    def verify_edge(self,present):
        marker=docker_value('{{range .Config.Env}}{{if eq (index (split . "=") 0) "'+KEY+'"}}present{{end}}{{end}}',self.edge); require((marker=='present')==present)
        if present: quiet(['docker','exec',self.edge,'sh','-eu','-c','set +x; v=${LEMTEL_DO_WRITER_RESOURCE_SECRET-}; [ "${#v}" -eq 64 ]; case "$v" in *[!0-9a-f]*) exit 1;; esac'])
    def apply(self,secret):
        self.phase='configuration'; self.mkdir(ROOT); self.create(LOCK,b'',0o600); fd=os.open(LOCK,os.O_RDWR|os.O_NOFOLLOW); fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.mkdir(CONFIG.parent) if not exists(CONFIG.parent) else None
        self.mkdir(LIB.parent) if not exists(LIB.parent) else None
        self.mkdir(EDGE_CONFIG)
        self.create(CONFIG,(f'LEMTEL_DO_WRITER_RESOURCE_ENDPOINT={ENDPOINT}\n{KEY}={secret}\n').encode(),0o600)
        self.create(EDGE_ENV,(KEY+'='+secret+'\n').encode(),0o600); secret=None
        self.create(OVERRIDE,('services:\n  '+self.service+':\n    environment:\n      '+KEY+': ${'+KEY+':?required}\n').encode(),0o600)
        self.create(PUBLISHER,read_protected(self.publisher_source),0o700); self.create(SERVICE,read_protected(self.service_source),0o644); self.create(TIMER,read_protected(self.timer_source),0o644)
        out,err=command([str(PUBLISHER),'--check-config']); require(not err and out=='status=config_ready\n')
        quiet(self.compose(True)+['config','--quiet']); self.phase='edge_recreate'; self.edge_attempted=True; command(self.compose(True)+['up','--no-deps','--force-recreate','--no-build','--pull','never','-d',self.service]); self.edge=container_for('supabase-edge-functions'); self.verify_edge(True)
        self.phase='smoke_test'; out,err=command([str(PUBLISHER)]); require(not err and out=='status=published\n')
        self.phase='timer'; quiet(['systemctl','daemon-reload']); self.timer_attempted=True; quiet(['systemctl','enable','--now','lemtel-do-writer-resource-publisher.timer']); out,err=command(['systemctl','is-enabled','lemtel-do-writer-resource-publisher.timer']); require(not err and out=='enabled\n'); out,err=command(['systemctl','is-active','lemtel-do-writer-resource-publisher.timer']); require(not err and out=='active\n')
        self.committed=True
    def rollback(self):
        state='complete'
        try:
            if self.timer_attempted: subprocess.run(['systemctl','disable','--now','lemtel-do-writer-resource-publisher.timer'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
            if exists(WANTS):
                require(WANTS.is_symlink() and WANTS.lstat().st_uid==0 and WANTS.resolve()==TIMER); WANTS.unlink()
            for path in (TIMER,SERVICE,PUBLISHER,CONFIG,OVERRIDE,EDGE_ENV,LOCK):
                try: self.remove(path)
                except Exception: state='manual_required'
            if self.edge_attempted:
                try: quiet(self.compose(False)+['config','--quiet']); command(self.compose(False)+['up','--no-deps','--force-recreate','--no-build','--pull','never','-d',self.service]); self.edge=container_for('supabase-edge-functions'); self.verify_edge(False)
                except Exception: state='manual_required'
            for path,expected in reversed(self.directories):
                try:
                    if exists(path) and identity(path.lstat())==expected: path.rmdir()
                except Exception: state='manual_required'
            subprocess.run(['systemctl','daemon-reload'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
        except Exception: state='manual_required'
        return state
transaction=Transaction()
try:
    pending=transaction.prepare(); transaction.apply(pending)
    print('do_writer_resource_publisher_activation_format=lemtel_do_writer_resource_publisher_activation_v1')
    print('writer=digitalocean_writer'); print('edge_secret_configured=true'); print('publisher_smoke_test=published'); print('publisher_timer_enabled=true'); print('publisher_timer_active=true'); scope(); print('do_writer_resource_publisher_activation_status=complete')
except BaseException:
    rollback=transaction.rollback() if transaction.created or transaction.edge_attempted else 'not_required'
    reason=f'{transaction.phase}_{transaction.guard}'
    if not re.fullmatch(r'[a-z_]{1,96}',reason): reason='internal_refusal'
    print('do_writer_resource_publisher_activation_status=failed'); print('reason='+reason); print('rollback_status='+rollback); scope(); sys.exit(78)
PY
