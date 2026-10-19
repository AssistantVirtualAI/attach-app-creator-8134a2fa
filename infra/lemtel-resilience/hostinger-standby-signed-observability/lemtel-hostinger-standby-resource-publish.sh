#!/usr/bin/env bash
# Hostinger standby resource publisher: role-bound signed publication (NOT a secure enrollment). Observation only:
# no runtime, PostgreSQL promotion, DNS, routing or failover action. Installation is a separate reviewed transaction.
set -euo pipefail
set +x
umask 077
[ "${EUID}" -eq 0 ] || { printf 'status=root_required\n'; exit 78; }
[ "$#" -le 1 ] && { [ "$#" -eq 0 ] || [ "$1" = --check-config ]; } || { printf 'status=invalid_arguments\n'; exit 78; }
python3 - "$@" 2>/dev/null <<'PY'
import datetime, hashlib, hmac, json, os, pathlib, re, stat, subprocess, sys, time, urllib.parse
CONFIG = pathlib.Path('/etc/lemtel-ha/hostinger-standby-resource-publisher.env')
class Refusal(Exception): pass
def secure_config():
    for parent in CONFIG.parents:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022: raise Refusal()
    fd = os.open(CONFIG, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'r', encoding='utf-8') as stream:
        info = os.fstat(stream.fileno()); text = stream.read(1025)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or len(text) > 1024: raise Refusal()
    values = {}
    for line in text.splitlines():
        if not line or line.startswith('#'): continue
        key, sep, value = line.partition('=')
        if not sep or key not in ('LEMTEL_HOSTINGER_STANDBY_RESOURCE_ENDPOINT','LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET') or key in values or not value: raise Refusal()
        values[key] = value
    if set(values) != {'LEMTEL_HOSTINGER_STANDBY_RESOURCE_ENDPOINT','LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET'} or not re.fullmatch(r'[a-f0-9]{64}', values['LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET']): raise Refusal()
    endpoint = urllib.parse.urlsplit(values['LEMTEL_HOSTINGER_STANDBY_RESOURCE_ENDPOINT'])
    if endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.port or endpoint.query or endpoint.fragment or endpoint.path != '/functions/v1/lemtel-hostinger-standby-resource-ingest' or re.fullmatch(r'[0-9.]+', endpoint.hostname): raise Refusal()
    return values
def percent(n, d):
    if d <= 0: raise Refusal()
    value = (n * 100 + d // 2) // d
    if value < 0 or value > 100: raise Refusal()
    return value
def resources():
    def cpu():
        with open('/proc/stat', encoding='ascii') as stream: fields = stream.readline().split()
        if len(fields) < 6 or fields[0] != 'cpu': raise Refusal()
        values = [int(v) for v in fields[1:]]
        return sum(values), values[3] + values[4]
    first_total, first_idle = cpu(); time.sleep(.125); second_total, second_idle = cpu()
    total, idle = second_total - first_total, second_idle - first_idle
    if total <= 0 or idle < 0 or idle > total: raise Refusal()
    memory = {}
    with open('/proc/meminfo', encoding='ascii') as stream:
        for line in stream:
            key, sep, value = line.partition(':')
            if sep and key in ('MemTotal','MemAvailable'): memory[key] = int(value.strip().split()[0])
    total_memory, available = memory.get('MemTotal', 0), memory.get('MemAvailable', -1)
    disk = os.statvfs('/')
    if total_memory <= 0 or not 0 <= available <= total_memory or disk.f_blocks <= 0 or not 0 <= disk.f_bavail <= disk.f_blocks: raise Refusal()
    loads = tuple(int(value * 1000 + .5) for value in os.getloadavg())
    if len(loads) != 3 or any(value < 0 or value > 1_000_000 for value in loads): raise Refusal()
    return {'cpuPercent':percent(total-idle,total),'memoryPercent':percent(total_memory-available,total_memory),'diskPercent':percent(disk.f_blocks-disk.f_bavail,disk.f_blocks),'load1Milli':loads[0],'load5Milli':loads[1],'load15Milli':loads[2]}
def publish(values):
    payload = json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).replace(second=0,microsecond=0).strftime('%Y-%m-%dT%H:%M:00Z'), **resources()}, separators=(',',':'))
    proof = hmac.new(values['LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET'].encode(), payload.encode(), hashlib.sha256).hexdigest()
    quote=lambda value: '"'+value.replace('\\','\\\\').replace('"','\\"')+'"'
    config='\n'.join(('url = '+quote(values['LEMTEL_HOSTINGER_STANDBY_RESOURCE_ENDPOINT']),'header = "Content-Type: application/json"','header = '+quote('X-Lemtel-Hostinger-Standby-Resource-Signature: sha256='+proof),'data = '+quote(payload)))+'\n'
    result=subprocess.run(['curl','--config','-','--silent','--request','POST','--proto','=https','--proto-redir','=https','--max-redirs','0','--noproxy','*','--connect-timeout','5','--max-time','15','--output','/dev/null','--write-out','%{http_code}'],input=config,text=True,capture_output=True,timeout=20,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin'})
    if result.returncode != 0: return 'transport'
    if result.stdout == '204': return 'published'
    return 'http_'+result.stdout if re.fullmatch(r'[1-5][0-9]{2}',result.stdout) else 'http_unexpected'
def smoke(values):
    # Edge may require a short process-start interval after an intentional recreation.
    deadline=time.monotonic()+30; last='transport'
    while True:
        last=publish(values)
        if last=='published': return last
        if last not in ('transport','http_502','http_503','http_504') or time.monotonic()>=deadline: return last
        time.sleep(2)
try:
    values=secure_config(); state = 'config_ready' if sys.argv[1:] == ['--check-config'] else smoke(values)
    print('status='+state); sys.exit(0 if state in ('config_ready','published') else 1)
except Exception: print('status=publisher_refused'); sys.exit(78)
PY
