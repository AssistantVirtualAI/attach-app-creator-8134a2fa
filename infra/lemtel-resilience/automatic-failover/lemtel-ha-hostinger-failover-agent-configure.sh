# Lemtel — streamed to `bash -s` on the Hostinger standby, followed on the same stdin by the agent
# configuration (six KEY=value lines). Writes /etc/lemtel-ha/failover-agent.env (root, 0600) and validates
# it with the agent's own read-only preflight. Never enables or starts the agent, never promotes, never
# touches the standby database. Any failure restores the previous state.
set -euo pipefail
umask 077
fail() { printf 'agent_config_status=failed\nreason=%s\n' "$1"; exit 1; }
[ "$(id -u)" = 0 ] || fail root_required
for unit in lemtel-ha-hostinger-failover-agent.service lemtel-ha-hostinger-failover-agent.timer; do
  case "$(systemctl is-active "$unit" 2>/dev/null || true)" in active|activating|reloading) fail "${unit}_active" ;; esac
  case "$(systemctl is-enabled "$unit" 2>/dev/null || true)" in enabled|enabled-runtime) fail "${unit}_enabled" ;; esac
done
[ "$(docker exec -u postgres lemtel-postgres-hostinger-standby psql -X -At -d postgres -c 'SELECT pg_is_in_recovery()')" = t ] || fail standby_not_in_recovery
[ -d /etc/lemtel-ha ] && [ ! -L /etc/lemtel-ha ] || install -d -o root -g root -m 0755 /etc/lemtel-ha
[ "$(stat -c '%u:%g' /etc/lemtel-ha)" = 0:0 ] && (( (8#$(stat -c '%a' /etc/lemtel-ha) & 8#022) == 0 )) || fail config_directory_unsafe
[ -x /opt/lemtel-ha/automatic-failover/lemtel-ha-hostinger-failover-agent.sh ] || fail agent_missing
exec /usr/bin/python3 -I -c '
import os, re, subprocess, sys, time
CONFIG = "/etc/lemtel-ha/failover-agent.env"
BACKUP_DIR = "/var/lib/lemtel-ha/failover-agent"
def fail(reason):
    print("agent_config_status=failed\nreason=" + reason); sys.exit(1)
data = sys.stdin.buffer.read(4097)
if len(data) > 4096: fail("configuration_too_large")
lines = [line for line in data.decode("ascii").splitlines() if line.strip()]
patterns = {"FAILOVER_MODE": r"active", "ARBITER_URL": r"https://lemtel-failover-arbiter\.[a-z0-9-]+\.workers\.dev",
            "AGENT_SHARED_SECRET": r"[A-Za-z0-9_-]{43}", "DO_WRITER_DROPLET_ID": r"[1-9][0-9]{0,19}",
            "LEMTEL_HA_LOCAL_POSTGRES_CONTAINER": r"lemtel-postgres-hostinger-standby", "PROMOTION_EXECUTION_MODE": r"review"}
seen = {}
for line in lines:
    key, sep, value = line.partition("=")
    if not sep or key not in patterns or key in seen or not re.fullmatch(patterns[key], value): fail("configuration_invalid")
    seen[key] = value
if set(seen) != set(patterns): fail("configuration_incomplete")
backup = None
if os.path.lexists(CONFIG):
    if os.path.islink(CONFIG): fail("existing_config_is_symlink")
    backup = "%s/agent-env-backup.%d" % (BACKUP_DIR, int(time.time()))
    os.makedirs(BACKUP_DIR, mode=0o700, exist_ok=True)
    with open(CONFIG, "rb") as source, os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as target:
        target.write(source.read()); target.flush(); os.fsync(target.fileno())
tmp = CONFIG + ".tmp.%d" % os.getpid()
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, "w") as handle:
    handle.write("".join("%s=%s\n" % (key, seen[key]) for key in patterns)); handle.flush(); os.fsync(handle.fileno())
os.chown(tmp, 0, 0); os.chmod(tmp, 0o600); os.replace(tmp, CONFIG)
def restore():
    if backup: os.replace(backup, CONFIG)
    else: os.unlink(CONFIG)
try:
    check = subprocess.run(["/opt/lemtel-ha/automatic-failover/lemtel-ha-hostinger-failover-agent.sh", "preflight"],
        env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LEMTEL_HA_EXECUTE": "run_hostinger_failover_agent",
             "LEMTEL_HA_ROLE": "hostinger_standby"}, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    ok = check.returncode == 0 and b"hostinger_failover_agent_status=preflight_ready_no_action" in check.stdout
except Exception:
    ok = False
if not ok:
    restore(); fail("agent_preflight_refused_previous_state_restored")
print("agent_config_written=true\nagent_preflight=ready_no_action\npromotion_execution_mode=review\nagent_enabled=false\nagent_started=false")
print("standby_postgres_touched=false\nprevious_config_backed_up=%s\nagent_config_status=complete" % ("true" if backup else "false"))
'
