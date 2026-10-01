#!/bin/sh
# Lemtel Control Plane local config guard. Prints setting names only, never values.
fail=0
check() {
  name="$1"; value="$2"; min="$3"
  if [ -z "$(printf '%s' "$value" | tr -d '[:space:]')" ]; then echo "config_guard: $name missing"; fail=1; return; fi
  if [ "${#value}" -lt "$min" ]; then echo "config_guard: $name too short"; fail=1; return; fi
  if printf '%s' "$value" | grep -Eiq 'changeme|change-me|replace-me|replaceme|default|secret|password|example|placeholder|xxx'; then echo "config_guard: $name weak"; fail=1; return; fi
  if printf '%s' "$value" | grep -Eq '^(.)\1*$'; then echo "config_guard: $name weak"; fail=1; return; fi
  if ! printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_.~+=-]+$'; then echo "config_guard: $name malformed"; fail=1; return; fi
}
check CONTROL_PLANE_SERVICE_TOKEN "$CONTROL_PLANE_SERVICE_TOKEN" 32
check CONTROL_PLANE_DB_PASSWORD "$CONTROL_PLANE_DB_PASSWORD" 24
check CONTROL_PLANE_REDIS_PASSWORD "$CONTROL_PLANE_REDIS_PASSWORD" 24
if [ "$fail" -ne 0 ]; then echo "config_guard: refusing to start; set strong values in the ignored local .env"; exit 1; fi
echo "config_guard: ok"
