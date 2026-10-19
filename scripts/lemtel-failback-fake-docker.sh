#!/bin/bash
F="$LEMTEL_FB_TEST_ROOT/fake"; C="$F/containers"
echo "docker $*" >> "$F/log"
last="${@: -1}"
cdir() { echo "$C/$1"; }
case "$1" in
  image) exit 0 ;;
  inspect)
    shift; fmt=""; if [ "$1" = --format ] || [ "$1" = -f ]; then fmt="$2"; shift 2; fi
    c="$1"; [ -d "$C/$c" ] || exit 1
    case "$fmt" in
      *State.Running*) cat "$C/$c/running" ;;
      *Config.Image*) cat "$C/$c/image" ;;
      *Destination*) cat "$C/$c/mount" ;;
      *Config.Env*) cat "$C/$c/env" 2>/dev/null ;;
      *Aliases*) cat "$C/$c/networks" 2>/dev/null ;;
      *Gateway*) echo 172.17.0.1 ;;
      *'$k'*) cat "$C/$c/netips" 2>/dev/null || echo "bridge 172.17.0.5" ;;
      *IPAddress*) echo 172.17.0.5 ;;
      *) echo '{}' ;;
    esac ;;
  ps)
    if [[ "$*" == *"--format {{.Names}}"* ]]; then ls "$C"; exit 0; fi
    p="$(printf '%s' "$*" | sed -n 's/.*compose.project=\([a-z-]*\).*/\1/p')"
    if [[ "$*" == *" -aq"* ]] || [[ "$*" == *" -a -q"* ]]; then cat "$F/project-$p-all" 2>/dev/null; else cat "$F/project-$p-running" 2>/dev/null; fi ;;
  port) exit 0 ;;
  network)
    case "$2" in
      ls) cat "$F/project-networks" 2>/dev/null ;;
      inspect) n="${@: -1}"; case "$*" in *IPAM*) cat "$F/net-$n-gw" 2>/dev/null ;; *bridge.name*) cat "$F/net-$n-if" 2>/dev/null || echo '<no value>' ;; *.Id*) echo abcdef0123456789 ;; esac ;;
      *) : ;;
    esac ;;
  update|cp) exit 0 ;;
  stop) for c in "${@:2}"; do [ -d "$C/$c" ] && echo false > "$C/$c/running"; [[ "$c" == --* ]] || true; done
        for id in "${@:2}"; do grep -qx "$id" "$F"/project-*-running 2>/dev/null && sed -i "/^$id$/d" "$F"/project-*-running; done; exit 0 ;;
  start) for c in "${@:2}"; do [ -d "$C/$c" ] && echo true > "$C/$c/running"; done; exit 0 ;;
  rename) mv "$C/$2" "$C/$3" ;;
  rm) for c in "${@:2}"; do [[ "$c" == -* ]] || rm -rf "$C/$c"; done; exit 0 ;;
  create)
    name="$(printf '%s\n' "$@" | awk 'f{print; exit} $0=="--name"{f=1}')"
    mkdir -p "$C/$name"; echo false > "$C/$name/running"; echo "$last" > "$C/$name/image"; echo /opt/lemtel-ha/postgres/data > "$C/$name/mount"
    echo "$name" >> "$F/created" ;;
  run)
    if [[ "$*" == *"--entrypoint id"* ]]; then echo 101; exit 0; fi
    if [[ "$*" == *"-d --name"* ]]; then
      name="$(printf '%s\n' "$@" | awk 'f{print; exit} $0=="--name"{f=1}')"
      mkdir -p "$C/$name"; echo true > "$C/$name/running"; echo supabase/postgres:17.6.1.136 > "$C/$name/image"; echo /opt/lemtel-ha/postgres/data > "$C/$name/mount"; exit 0
    fi
    if [[ "$*" == *"--entrypoint pg_basebackup"* ]]; then
      [ -f "$F/basebackup-fails" ] && exit 1
      d="$LEMTEL_FB_TEST_ROOT/opt/lemtel-ha/postgres/data"; : > "$d/standby.signal"
      printf "primary_conninfo = 'host=x'\nsynchronous_standby_names = 'FIRST 1 (x)'\nshared_buffers = 128MB\n" > "$d/postgresql.auto.conf"
      echo "basebackup $*" >> "$F/basebackup"; exit 0
    fi
    if [[ "$*" == *IDENTIFY_SYSTEM* ]]; then [ -f "$F/replication-login-refused" ] && exit 2; echo ok; exit 0; fi
    if [[ "$*" == *"--entrypoint psql"* ]]; then sql="$last"; file="$F/client-sql"; else exit 0; fi ;;
  exec)
    if [[ "$*" == *"grep -Fqx"* ]]; then [ -f "$F/hba-has-rule" ]; exit $?; fi
    if [[ "$*" == *"sh -eu -c"* ]]; then echo hba-append >> "$F/hba-writes"; exit 0; fi
    if [[ "$*" == *"test -f /var/lib/postgresql/data/lemtel-ha-replication.pgpass"* ]]; then echo present; exit 0; fi
    if [[ "$*" == *"-h 10.253.47.1"* ]]; then [ -f "$F/hostinger-accepts-logins" ]; exit $?; fi
    if [[ "$*" == *"rolsuper"* ]]; then
      if [[ "$*" == *"-U supabase_admin"* ]]; then [ -f "$F/no-loopback-superuser" ] && exit 2; echo t; else [ -f "$F/postgres-is-superuser" ] && echo t || echo f; fi; exit 0
    fi
    [[ "$*" == *"-U supabase_admin"* ]] && echo "as-superuser $last" >> "$F/log"
    sql="$last"; file="$F/sql" ;;
  *) exit 0 ;;
esac
if [ -n "${sql:-}" ]; then
  while IFS='|' read -r pattern answer; do
    [ -n "$pattern" ] || continue
    if [[ "$sql" == *"$pattern"* ]]; then
      if [[ "$answer" == *",,"* ]]; then
        key="$F/count-$(printf '%s' "$file$pattern" | md5sum | cut -c1-12)"; n=$(cat "$key" 2>/dev/null || echo 0); echo $((n+1)) > "$key"
        IFS=$'\n' read -r -d '' -a parts < <(printf '%s' "$answer" | sed 's/,,/\n/g'; printf '\0'); i=$n; [ "$i" -lt "${#parts[@]}" ] || i=$(( ${#parts[@]} - 1 )); answer="${parts[$i]}"
      fi
      [ "$answer" = FAIL ] && exit 1; printf '%s\n' "$answer"; echo "sql $sql" >> "$F/log"; exit 0; fi
  done < "$file"
  echo "sql-unmatched $sql" >> "$F/log"; exit 1
fi
