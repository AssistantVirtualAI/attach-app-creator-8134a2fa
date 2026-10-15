#!/usr/bin/env bash
# Separate, operator-gated installation phase. Do not run during implementation.
set +x
set -euo pipefail
umask 077
if [[ "$EUID" -ne 0 ]]; then printf 'status=root_required\n'; exit 78; fi
if [[ "$#" -ne 1 || "$1" != 'enable-lemtel-traffic-collector' || "${LEMTEL_TRAFFIC_ACTIVATION_APPROVED:-}" != 'transactional-package-ready' ]]; then
  printf 'status=activation_not_approved\n'; exit 78
fi
if [[ "${LEMTEL_TRAFFIC_ACTIVATION_REVIEW_APPROVED:-}" != 'REVIEWED_LOCAL_COLLECTOR_ACTIVATION' || "${LEMTEL_TRAFFIC_LOCAL_ROLLBACK_ATTESTATION:-}" != 'LOCAL_COLLECTOR_ROLLBACK_REVIEWED' ]]; then
  printf 'status=activation_review_not_approved\n'; exit 78
fi
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! bash "$source_dir/lemtel-traffic-collect.sh" --check-config >/dev/null 2>&1; then
  printf 'status=config_refused\n'; exit 78
fi
# Gate means: reviewed transactional schema/Edge/router package and root-only config are ready.
# This script changes ONLY these local collector files/units; no provider/topology operations.
install -d -o root -g root -m 0700 /usr/local/libexec/lemtel-traffic /var/lib/lemtel-traffic-collector
install -o root -g root -m 0700 "$source_dir/lemtel-traffic-collect.sh" /usr/local/libexec/lemtel-traffic/collect.sh
cat > /etc/systemd/system/lemtel-traffic-collector.service <<'UNIT'
[Unit]
Description=Lemtel private aggregate traffic collector
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
Group=root
UMask=0077
ExecStart=/usr/local/libexec/lemtel-traffic/collect.sh
TimeoutStartSec=30
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ReadWritePaths=/var/lib/lemtel-traffic-collector
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
StandardOutput=journal
StandardError=null
UNIT
cat > /etc/systemd/system/lemtel-traffic-collector.timer <<'UNIT'
[Unit]
Description=Lemtel private aggregate traffic interval
[Timer]
OnBootSec=60s
OnUnitActiveSec=60s
RandomizedDelaySec=10s
AccuracySec=1s
Persistent=false
Unit=lemtel-traffic-collector.service
[Install]
WantedBy=timers.target
UNIT
chmod 0644 /etc/systemd/system/lemtel-traffic-collector.{service,timer}
if ! systemctl daemon-reload >/dev/null 2>&1 || ! systemctl enable --now lemtel-traffic-collector.timer >/dev/null 2>&1; then
  printf 'status=timer_enable_failed\n'; exit 1
fi
printf 'status=timer_enabled\n'
