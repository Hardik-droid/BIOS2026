#!/bin/sh
set -eu

: "${RAILWAY_VOLUME_MOUNT_PATH:?Attach a persistent Railway volume at /var/lib/diwan}"
if [ "$RAILWAY_VOLUME_MOUNT_PATH" != /var/lib/diwan ]; then
  echo 'Mount the persistent volume at /var/lib/diwan.' >&2
  exit 1
fi
: "${DIWAN_JWT_SECRET:?Set a random JWT secret in Railway service variables}"
: "${DIWAN_ADMIN_PASSWORD:?Set a random login password in Railway service variables}"
if [ "${#DIWAN_JWT_SECRET}" -lt 32 ] || [ "${#DIWAN_ADMIN_PASSWORD}" -lt 20 ]; then
  echo 'Use at least 32 characters for the JWT secret and 20 for the login password.' >&2
  exit 1
fi
case "$DIWAN_ADMIN_PASSWORD" in
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

mkdir -p /var/lib/diwan/data /var/lib/diwan/uploads
chown diwan:diwan /var/lib/diwan /var/lib/diwan/data /var/lib/diwan/uploads
umask 077
cat > /tmp/diwan-config.yaml <<EOF
server:
  addr: "0.0.0.0:$port"
  data_dir: "/var/lib/diwan/data"
  uploads_dir: "/var/lib/diwan/uploads"
auth:
  enabled: true
  password: "$DIWAN_ADMIN_PASSWORD"
storage:
  type: "local"
collab:
  builtin_rendezvous: true
EOF
chown diwan:diwan /tmp/diwan-config.yaml
# Bootstrap the owner before exposing HTTP, closing first-user registration.
# The migration reads the password from config.yaml rather than argv.
cd /tmp
ln -sf /tmp/diwan-config.yaml /tmp/config.yaml
su-exec diwan /usr/local/bin/diwan migrate-credential -admin self -db /var/lib/diwan/data/userauth.db
cd /var/lib/diwan
exec su-exec diwan /usr/local/bin/diwan -config /tmp/diwan-config.yaml
