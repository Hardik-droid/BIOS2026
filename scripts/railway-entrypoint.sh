#!/bin/sh
set -eu

: "${RAILWAY_VOLUME_MOUNT_PATH:?Attach a persistent Railway volume}"
# An existing mounted data volume must keep its exact path during rebranding.
case "$RAILWAY_VOLUME_MOUNT_PATH" in /var/lib/localfirst|/var/lib/diwan) ;; *)
  echo 'Use the configured LocalFirst data volume mount.' >&2
  exit 1
;; esac
LOCALFIRST_JWT_SECRET="${LOCALFIRST_JWT_SECRET-${DIWAN_JWT_SECRET-}}"
LOCALFIRST_ADMIN_PASSWORD="${LOCALFIRST_ADMIN_PASSWORD-${DIWAN_ADMIN_PASSWORD-}}"
export LOCALFIRST_JWT_SECRET LOCALFIRST_ADMIN_PASSWORD
data_root="$RAILWAY_VOLUME_MOUNT_PATH"
: "${LOCALFIRST_JWT_SECRET:?Set a random JWT secret in Railway service variables}"
: "${LOCALFIRST_ADMIN_PASSWORD:?Set a random login password in Railway service variables}"
if [ "${#LOCALFIRST_JWT_SECRET}" -lt 32 ] || [ "${#LOCALFIRST_ADMIN_PASSWORD}" -lt 20 ]; then
  echo 'Use at least 32 characters for the JWT secret and 20 for the login password.' >&2
  exit 1
fi
case "$LOCALFIRST_ADMIN_PASSWORD" in
  *[!a-zA-Z0-9_.-]*)
    echo 'Use letters, digits, underscore, period, or hyphen in the generated login password.' >&2
    exit 1 ;;
esac

port="${PORT:-8080}"
case "$port" in ''|*[!0-9]*) echo 'PORT must be numeric.' >&2; exit 1 ;; esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo 'PORT must be between 1 and 65535.' >&2
  exit 1
fi

mkdir -p "$data_root/data" "$data_root/uploads"
chown localfirst:localfirst "$data_root" "$data_root/data" "$data_root/uploads"
umask 077
cat > /tmp/localfirst-config.yaml <<EOF
server:
  addr: "0.0.0.0:$port"
  data_dir: "$data_root/data"
  uploads_dir: "$data_root/uploads"
auth:
  enabled: true
  password: "$LOCALFIRST_ADMIN_PASSWORD"
storage:
  type: "local"
collab:
  builtin_rendezvous: true
EOF
chown localfirst:localfirst /tmp/localfirst-config.yaml
# Bootstrap the owner before exposing HTTP, closing first-user registration.
# The migration reads the password from config.yaml rather than argv.
cd /tmp
ln -sf /tmp/localfirst-config.yaml /tmp/config.yaml
su-exec localfirst /usr/local/bin/localfirst migrate-credential -admin self -db "$data_root/data/userauth.db"
cd "$data_root"
exec su-exec localfirst /usr/local/bin/localfirst -config /tmp/localfirst-config.yaml
