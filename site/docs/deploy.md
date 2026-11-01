# LocalFirst – Deployment Guide

## Requirements

- Linux host or container runtime
- Go 1.25+ (the module may download its pinned toolchain)
- Node.js 22.12+ or 20.19+ (for frontend build)
- PostgreSQL (optional; defaults to SQLite)

## Quick Start (Docker)

```sh
# Run from this repository root.
docker build -t localfirst:local .
docker run -d \
  --name localfirst \
  -p 8080:8080 \
  -v office-data:/srv/data \
  -v office-uploads:/srv/uploads \
  localfirst:local
```

## Building from Source

```sh
git clone https://github.com/Vasu-Gupta105/BIOS2026.git localfirst
cd localfirst

# Build frontend
npm --prefix web ci
npm --prefix web run build:frontend

# Build backend (no CGO required)
CGO_ENABLED=0 go build -trimpath -o localfirst .
./localfirst
```

## Configuration

Create `config.yaml` in the server working directory (or adapt the tracked `config.yaml`) and set the real configuration fields:

```yaml
server:
  addr: ":8080"
  data_dir: "./data"
  uploads_dir: "./uploads"
auth:
  enabled: true
  password: "<strong-bootstrap-password>"
storage:
  type: local
```

Set `LOCALFIRST_JWT_SECRET` to a strong random secret in the process environment. For PostgreSQL, configure `DATABASE_URL`; there is no `database.driver` YAML field.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel OTLP endpoint (optional) |
| `LOCALFIRST_JWT_SECRET` | HS256 signing secret (required when auth enabled) |
| `LOCALFIRST_REGISTRATION_TOKEN` | Static fallback registration token (optional; prefer invite tokens) |
| `VULOS_USERAUTH_DB` | Per-user credential SQLite DSN (default `./data/userauth.db`) |
| `VULOS_INVITES_DB` | Invite-token SQLite DSN (default `./data/invites.db`) |
| `VULOS_AUDIT_DB` | Append-only audit-log SQLite DSN (default `./data/audit.db`) |
| `VULOS_FILEACL_DB` | File-ACL SQLite DSN, sqlite backend only (default `./data/fileacl.db`) |

## Accounts, registration & invites

- **Login** verifies against a per-user credential store (bcrypt). While **no**
  users are registered, the instance is in OSS single-user mode and the legacy
  shared `auth.password` still authenticates.
- **Registration** on a bootstrapped instance (≥1 user) requires authorization:
  an admin JWT, the static `LOCALFIRST_REGISTRATION_TOKEN`, **or** a
  single-use/expiring **invite token** minted by an admin
  (`POST /api/admin/invites`, or the Admin Console UI). Invite tokens are stored
  hashed; the raw token is shown once at mint time.
- All ACL grants/revokes, registrations, and invite events are recorded in an
  append-only **audit log** (`GET /api/admin/audit`, admin-only).

## Observability

- `GET /metrics` — Prometheus `localfirst_*` metrics.
- OTel traces when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

## Upgrading

Stop, replace binary, restart. SQLite schema is versioned; auto-migrated on startup.

### Upgrading from a shared-password deploy (avoid lockout)

Older deploys used a single shared `auth.password` with client-asserted account
ids. After upgrading, login on a bootstrapped instance requires a **per-user
credential** — so if you add any user without first migrating, existing
operators can no longer log in with the shared password.

Run the one-shot migration **once** after upgrading (before adding other users)
to seed the first per-user credential from your existing shared password:

```bash
# Uses auth.password from config.yaml unless -password is given.
./localfirst migrate-credential -admin you@vulos.org

# Or pass an explicit password / DB path:
./localfirst migrate-credential -admin you@vulos.org -password 's3cret' -db /data/userauth.db
```

The command is **idempotent** — it is a no-op once any user exists, so it is
safe to run on every boot or in an entrypoint script. After migrating, log in
with that account + the shared password, then mint invite tokens (Admin Console
→ Invites, or `POST /api/admin/invites`) to onboard the rest of your team.
