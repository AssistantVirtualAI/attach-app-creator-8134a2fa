#!/usr/bin/env bash
# Root-only static Lemtel Operations portal refresh on the existing DO writer.
# No database, Edge, Caddy configuration, runtime, provider, Hostinger, telephony or HA control is changed.
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077

failure_reason=''
fail() { failure_reason="$1"; printf 'operations_portal_static_refresh_status=failed\nreason=%s\n' "$failure_reason" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail root_required
[ "${LEMTEL_OPERATIONS_STATIC_REFRESH_EXECUTE:-}" = 'refresh_verified_operations_portal_static' ] || fail execution_token_required
[ "${LEMTEL_HA_ROLE:-}" = 'digitalocean_writer' ] || fail writer_role_required
[ "${LEMTEL_OPERATIONS_STATIC_REFRESH_REVIEW:-}" = 'REVIEWED_DO_WRITER_STATIC_PORTAL_REFRESH' ] || fail review_attestation_required

release_root='/var/lib/lemtel-ha/operations-portal-static-refresh/releases'
work_root='/var/lib/lemtel-ha/operations-portal-static-refresh/work'
backup_root='/var/lib/lemtel-ha/operations-portal-static-refresh/backups'
transaction_journal="$work_root/active-transaction.json"
release_archive="${LEMTEL_OPERATIONS_STATIC_REFRESH_RELEASE:-$release_root/lemtel-operations-portal-static-refresh.tar}"
release_sidecar="${release_archive}.sha256"
caddy_container='supabase-caddy'
portal_marker='# LEMTEL_OPERATIONS_PORTAL_V1'
max_release_bytes=$((42 * 1024 * 1024))
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
zip_helper="$script_directory/lemtel-verified-portal-zip.py"
transaction_helper="$script_directory/lemtel-portal-static-refresh-transaction.py"

secure_root_directory() {
  local directory="$1" mode
  [ -d "$directory" ] && [ ! -L "$directory" ] || return 1
  [ "$(stat -c '%u' "$directory")" = 0 ] || return 1
  mode="$(stat -c '%a' "$directory")" || return 1
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$mode & 8#022) == 0 ))
}
secure_root_regular_file() {
  local file="$1" mode
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  [ "$(stat -c '%u' "$file")" = 0 ] || return 1
  mode="$(stat -c '%a' "$file")" || return 1
  [ "$mode" = 600 ]
}
secure_root_nonwritable_regular_file() {
  local file="$1" mode
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  [ "$(stat -c '%u' "$file")" = 0 ] || return 1
  mode="$(stat -c '%a' "$file")" || return 1
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$mode & 8#022) == 0 ))
}
secure_root_executable_file() {
  local file="$1" mode
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  [ "$(stat -c '%u' "$file")" = 0 ] || return 1
  mode="$(stat -c '%a' "$file")" || return 1
  [ "$mode" = 755 ]
}
secure_parent_chain() {
  local path="$1" parent
  parent="$(dirname "$path")"
  while :; do
    secure_root_directory "$parent" || return 1
    [ "$parent" = / ] && return 0
    parent="$(dirname "$parent")"
  done
}
verify_release_sidecar() {
  /usr/bin/python3 - "$release_sidecar" "$(basename "$release_archive")" <<'PY'
import re, sys
try: data = open(sys.argv[1], 'rb').read()
except OSError: raise SystemExit(1)
if re.fullmatch(rb'[a-f0-9]{64}  ' + re.escape(sys.argv[2].encode()) + rb'\n', data) is None: raise SystemExit(1)
sys.stdout.write(data[:64].decode())
PY
}
extract_sealed_release() {
  /usr/bin/python3 - "$release_archive" "$release_dir" <<'PY'
import os, sys, tarfile
archive, destination = sys.argv[1:]
allowed = {'deployment-metadata.json':32768, 'manifest.sha256':2048, 'portal-artifact.zip':30*1024*1024, 'portal-artifact.attestation.jsonl':10*1024*1024, 'trusted-root.jsonl':10*1024*1024}
try:
  with tarfile.open(archive, 'r:') as bundle:
    members=bundle.getmembers()
    if len(members) != len(allowed) or {item.name for item in members} != set(allowed): raise ValueError
    for item in members:
      if not item.isfile() or item.issym() or item.islnk() or item.size < 1 or item.size > allowed[item.name]: raise ValueError
      source=bundle.extractfile(item)
      if source is None: raise ValueError
      fd=os.open(os.path.join(destination,item.name), os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
      try:
        with os.fdopen(fd,'wb') as output: output.write(source.read())
      finally: source.close()
except Exception: raise SystemExit(1)
PY
}
validate_release_metadata() {
  /usr/bin/python3 - "$release_dir/deployment-metadata.json" "$release_dir/portal-artifact.zip" <<'PY'
import hashlib, json, re, sys
metadata, artifact_path = sys.argv[1:]
def no_duplicates(pairs):
  result={}
  for key,value in pairs:
    if key in result: raise ValueError
    result[key]=value
  return result
try:
  raw=open(metadata,'rb').read()
  if not raw or len(raw)>32768: raise ValueError
  data=json.loads(raw,object_pairs_hook=no_duplicates)
  expected={'package_format','scope','source_revision','target_role','github_actions_portal_artifact','github_native_attestation','secrets_in_bundle','personal_data_in_bundle','ip_addresses_in_bundle','traffic_content_in_bundle','database_mutation','edge_function_mutation','caddyfile_mutation','portal_static_files_mutation','collector_activation','collector_timer_enabled','gateway_route_changed','global_jwt_bypass','automatic_failover_enabled','hostinger_contacted','cloudflare_contacted','telephony_contacted','failover_contacted','deployment_authorized'}
  if set(data)!=expected or data['package_format']!='lemtel_operations_portal_static_refresh_package_v3' or data['scope']!='lemtel_operations_portal_static_refresh' or data['target_role']!='digitalocean_writer': raise ValueError
  source=data['source_revision']
  if not isinstance(source,str) or re.fullmatch(r'[a-f0-9]{40}',source) is None: raise ValueError
  artifact=data['github_actions_portal_artifact']
  if set(artifact)!={'github_repository','github_repository_identifier','github_workflow','github_run_id','github_run_head_sha','github_artifact_id','github_artifact_name','github_artifact_sha256'}: raise ValueError
  identifier=artifact['github_repository_identifier']
  if artifact['github_repository']!='AssistantVirtualAI/attach-app-creator-8134a2fa' or artifact['github_workflow']!='.github/workflows/lemtel-operations-portal-build.yml' or artifact['github_run_head_sha']!=source or not isinstance(artifact['github_run_id'],int) or artifact['github_run_id']<=0 or not isinstance(artifact['github_artifact_id'],int) or artifact['github_artifact_id']<=0 or not isinstance(identifier,str) or re.fullmatch(r'[1-9][0-9]{0,18}',identifier) is None: raise ValueError
  if artifact['github_artifact_name'] != f"lemtel-operations-portal-{artifact['github_run_id']}" or re.fullmatch(r'[a-f0-9]{64}',artifact['github_artifact_sha256']) is None or hashlib.sha256(open(artifact_path,'rb').read()).hexdigest()!=artifact['github_artifact_sha256']: raise ValueError
  attestation=data['github_native_attestation']
  expected_attestation={'subject_file','bundle_file','trusted_root_file','verifier','signer_workflow','source_ref','source_digest','source_repository_identifier','deny_self_hosted_runners'}
  wanted={'subject_file':'portal-artifact.zip','bundle_file':'portal-artifact.attestation.jsonl','trusted_root_file':'trusted-root.jsonl','verifier':'gh_attestation_verify','signer_workflow':'AssistantVirtualAI/attach-app-creator-8134a2fa/.github/workflows/lemtel-operations-portal-build.yml','source_ref':'refs/heads/lemtel/integration','source_digest':source,'source_repository_identifier':identifier,'deny_self_hosted_runners':True}
  if set(attestation)!=expected_attestation or attestation!=wanted: raise ValueError
  if data['portal_static_files_mutation'] is not True: raise ValueError
  for key in expected-{'package_format','scope','source_revision','target_role','github_actions_portal_artifact','github_native_attestation','portal_static_files_mutation'}:
    if data[key] is not False: raise ValueError
  print(source+'\t'+identifier)
except Exception: raise SystemExit(1)
PY
}
validate_inner_manifest() {
  /usr/bin/python3 - "$release_dir/manifest.sha256" "$release_dir" <<'PY'
import hashlib, re, sys
manifest,root=sys.argv[1:]
names=['deployment-metadata.json','portal-artifact.attestation.jsonl','portal-artifact.zip','trusted-root.jsonl']
try:
  expected=b''.join(hashlib.sha256(open(root+'/'+name,'rb').read()).hexdigest().encode()+b'  '+name.encode()+b'\n' for name in names)
  if open(manifest,'rb').read()!=expected: raise ValueError
except Exception: raise SystemExit(1)
PY
}
verify_offline_attestation() {
  local -a identifiers=()
  local gh_bin
  gh_bin="$(command -v gh || true)"
  [ -n "$gh_bin" ] && [ -x "$gh_bin" ] || return 1
  mapfile -t identifiers < <("$gh_bin" attestation verify "$release_dir/portal-artifact.zip" --repo AssistantVirtualAI/attach-app-creator-8134a2fa --bundle "$release_dir/portal-artifact.attestation.jsonl" --custom-trusted-root "$release_dir/trusted-root.jsonl" --signer-workflow AssistantVirtualAI/attach-app-creator-8134a2fa/.github/workflows/lemtel-operations-portal-build.yml --source-ref refs/heads/lemtel/integration --source-digest "$source_revision" --deny-self-hosted-runners --format json --jq '.[].verificationResult.signature.certificate.sourceRepositoryIdentifier') || return 1
  [ "${#identifiers[@]}" -gt 0 ] || return 1
  local identifier
  for identifier in "${identifiers[@]}"; do [ "$identifier" = "$repository_identifier" ] || return 1; done
}
validate_portal_tree() {
  /usr/bin/python3 - "$1" <<'PY'
import os, re, stat, sys
root=sys.argv[1]; asset=re.compile(r'^assets/[A-Za-z0-9][A-Za-z0-9._-]{0,191}\.(css|js|woff2?|ttf|svg|png|jpe?g|webp)$'); seen=set(); total=0
try:
  for current,dirs,files in os.walk(root,topdown=True,followlinks=False):
    for name in dirs:
      p=os.path.join(current,name); info=os.lstat(p)
      if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o755: raise ValueError
    for name in files:
      p=os.path.join(current,name); info=os.lstat(p); relative=os.path.relpath(p,root).replace(os.sep,'/')
      if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o644 or relative in seen or (relative!='lemtel-portal.html' and not asset.fullmatch(relative)): raise ValueError
      seen.add(relative); total+=info.st_size
  root_info=os.lstat(root)
  if stat.S_IMODE(root_info.st_mode)!=0o755 or len(seen)<2 or len(seen)>100 or total>25*1024*1024 or 'lemtel-portal.html' not in seen or not any(asset.fullmatch(name) for name in seen): raise ValueError
except Exception: raise SystemExit(1)
PY
}
validate_existing_caddy_route() {
  /usr/bin/python3 - "$caddyfile" "$portal_marker" <<'PY'
import re,sys
text=open(sys.argv[1],encoding='utf-8').read(); marker=re.escape(sys.argv[2])
try:
  if len(re.findall(r'(?m)^\s*'+marker+r'\s*$',text))!=1: raise ValueError
  blocks=re.findall(r'(?ms)^\s*handle\s+@lemtel_operations_portal\s*\{\s*(.*?)^\s*\}',text)
  if len(blocks)!=1: raise ValueError
  block=blocks[0]
  for line in (r'^\s*uri\s+strip_prefix\s+/lemtel-portal\s*$',r'^\s*root\s+\*\s+/etc/caddy/lemtel-portal\s*$',r'^\s*try_files\s+\{path\}\s+/lemtel-portal\.html\s*$',r'^\s*file_server\s*$'):
    if len(re.findall(line,block,re.M))!=1: raise ValueError
except Exception: raise SystemExit(1)
PY
}

secure_root_regular_file "$release_archive" && secure_root_regular_file "$release_sidecar" && secure_parent_chain "$release_archive" || fail release_input_insecure
secure_root_executable_file "$zip_helper" && secure_parent_chain "$zip_helper" || fail zip_helper_insecure
secure_root_executable_file "$transaction_helper" && secure_parent_chain "$transaction_helper" || fail transaction_helper_insecure
release_size="$(stat -c '%s' "$release_archive" 2>/dev/null || true)"; [[ "$release_size" =~ ^[0-9]+$ ]] && [ "$release_size" -le "$max_release_bytes" ] || fail release_size_invalid
expected_release_digest="$(verify_release_sidecar || true)"; [[ "$expected_release_digest" =~ ^[a-f0-9]{64}$ ]] || fail release_sidecar_invalid
[ "$(sha256sum "$release_archive" | awk '{print $1}')" = "$expected_release_digest" ] || fail release_digest_mismatch
for directory in "$work_root" "$backup_root"; do [ ! -e "$directory" ] || secure_root_directory "$directory" || fail local_state_insecure; install -d -o root -g root -m 0700 "$directory"; done
lock_file="$work_root/refresh.lock"; [ ! -e "$lock_file" ] || secure_root_regular_file "$lock_file" || fail lock_file_insecure; exec 9>>"$lock_file" || fail lock_file_open_failed; secure_root_regular_file "$lock_file" || fail lock_file_insecure; flock -n 9 || fail concurrent_static_refresh

release_dir="$(mktemp -d "$work_root/release.XXXXXX")"; portal_stage=''; portal_dir=''; succeeded=false
cleanup() {
  local code=$?; trap - EXIT INT TERM
  if [ "$succeeded" != true ]; then
    if [ -n "$portal_dir" ] && { [ -e "$transaction_journal" ] || [ -L "$transaction_journal" ]; }; then "$transaction_helper" recover "$transaction_journal" "$portal_dir" >/dev/null 2>&1 || code=1; fi
    [ -n "$portal_stage" ] && [ -d "$portal_stage" ] && rm -rf -- "$portal_stage" || true
    [ -d "$release_dir" ] && rm -rf -- "$release_dir" || true
    [ -z "$failure_reason" ] && printf 'operations_portal_static_refresh_status=failed\nreason=transaction_failed\n' >&2
  else
    [ -n "$portal_stage" ] && [ -d "$portal_stage" ] && rm -rf -- "$portal_stage" || true; [ -d "$release_dir" ] && rm -rf -- "$release_dir" || true
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

extract_sealed_release || fail release_archive_invalid
validate_inner_manifest || fail release_manifest_invalid
metadata_context="$(validate_release_metadata || true)"; [[ "$metadata_context" == *$'\t'* ]] || fail release_metadata_invalid
IFS=$'\t' read -r source_revision repository_identifier <<< "$metadata_context"
verify_offline_attestation || fail github_native_attestation_offline_verification_failed

docker inspect "$caddy_container" >/dev/null 2>&1 || fail caddy_container_missing
[ "$(docker inspect --format '{{.State.Running}}' "$caddy_container")" = true ] || fail caddy_container_not_running
mapfile -t caddy_mounts < <(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{"\n"}}{{end}}{{end}}' "$caddy_container")
[ "${#caddy_mounts[@]}" -eq 1 ] || fail caddy_mount_ambiguous
caddy_source="${caddy_mounts[0]}"; caddyfile="$caddy_source/Caddyfile"; portal_dir="$caddy_source/lemtel-portal"
secure_root_directory "$caddy_source" && secure_root_nonwritable_regular_file "$caddyfile" && secure_root_directory "$portal_dir" || fail caddy_mount_or_portal_insecure
validate_existing_caddy_route || fail portal_route_missing_or_ambiguous
validate_portal_tree "$portal_dir" || fail portal_current_contents_invalid
if [ -e "$transaction_journal" ] || [ -L "$transaction_journal" ]; then secure_root_regular_file "$transaction_journal" || fail stale_transaction_insecure; "$transaction_helper" recover "$transaction_journal" "$portal_dir" >/dev/null || fail stale_transaction_recovery_failed; fi

backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)-$$"; install -d -o root -g root -m 0700 "$backup_dir"; backup_portal="$backup_dir/lemtel-portal"
cp -a -- "$portal_dir" "$backup_portal" || fail backup_copy_failed
chown -R root:root "$backup_portal" || fail backup_ownership_failed
find "$backup_portal" -type d -exec chmod 0700 {} +; find "$backup_portal" -type f -exec chmod 0600 {} +
(
 cd "$backup_portal"; find . -type f -printf '%P\0' | LC_ALL=C sort -z | xargs -0r sha256sum
) > "$backup_dir/lemtel-portal.sha256"
[ -s "$backup_dir/lemtel-portal.sha256" ] && (cd "$backup_portal" && sha256sum -c ../lemtel-portal.sha256 >/dev/null) || fail backup_manifest_invalid

portal_stage="$(mktemp -d "$caddy_source/.lemtel-operations-portal-static.XXXXXX")"; chmod 0755 "$portal_stage"
/usr/bin/python3 "$zip_helper" --extract "$release_dir/portal-artifact.zip" "$portal_stage" >/dev/null || fail portal_artifact_zip_invalid
validate_portal_tree "$portal_stage" || fail portal_stage_invalid
"$transaction_helper" prepare "$transaction_journal" "$portal_dir" "$portal_stage" >/dev/null || fail transaction_prepare_failed
"$transaction_helper" swap "$transaction_journal" "$portal_dir" >/dev/null || fail transaction_swap_failed
[ "$(docker inspect --format '{{.State.Running}}' "$caddy_container")" = true ] || fail caddy_container_not_running_after_static_refresh
validate_portal_tree "$portal_dir" || fail portal_install_invalid
"$transaction_helper" commit "$transaction_journal" "$portal_dir" >/dev/null || fail transaction_commit_failed

succeeded=true; trap - EXIT INT TERM
rm -rf -- "$portal_stage" || true; rm -rf -- "$release_dir" || true
printf 'operations_portal_static_refresh_format=lemtel_operations_portal_static_refresh_v3\nwriter=digitalocean_writer\nportal_bundle=deployed\ngithub_native_attestation_offline_verified=true\ndatabase_mutation=false\nedge_function_mutation=false\ncaddyfile_mutation=false\ncollector_activation=false\nhostinger_runtime_started=false\ncloudflare_or_dns_changed=false\nautomatic_failover_enabled=false\ntelephony_contacted=false\noperations_portal_static_refresh_status=complete\n'
