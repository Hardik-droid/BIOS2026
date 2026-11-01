# LocalFirst — Getting Started

This guide walks you through running LocalFirst for the first time, whether you want a quick local development environment or a production deployment.

---

## Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Go | 1.25 | Module-pinned toolchain |
| Node.js | 20.19+ or 22.12+ | 22.12+ |
| npm | 9 | 10 |
| OS | Linux / macOS | Linux (production) |

---

## Option A — Development server (recommended first step)

The dev server runs Vite (frontend, hot-reload) and the Go API side by side:

```bash
git clone https://github.com/Vasu-Gupta105/BIOS2026.git localfirst
cd localfirst

npm --prefix web ci
go mod download

npm --prefix web run dev:web
```

- Frontend: [http://localhost:5173](http://localhost:5173)
- Go API: [http://localhost:8080](http://localhost:8080)
- Vite proxies `/api/*` to the Go backend automatically.

Auth is **disabled** by default (`auth.enabled: false` in `config.yaml`), so no login is required for local use.

---

## Option B — Production binary

```bash
# Build the frontend, then compile everything into a single Go binary
npm --prefix web ci
npm --prefix web run build:frontend
go build -o localfirst .

# Run
./localfirst
```

Open [http://localhost:8080](http://localhost:8080).

---

## Option C — Docker

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

The image runs the server from `/srv` (see the Dockerfile), so mount `/srv/data` (SQLite stores + the JSON file/document store) and `/srv/uploads` (uploaded file staging) for persistence — both are declared `VOLUME`s in the image. Pass `-e LOCALFIRST_JWT_SECRET=<secret>` when enabling auth.

---

## Option D — Vulos OS bundle (recommended for production)

If you run the full Vulos OS stack, use the bundle installer which provisions OS + mail + office together:

```sh
# Tigris-backed (default)
curl -fsSL https://get.vulos.org | sudo bash

# Local-MinIO-backed (BYO single-box)
curl -fsSL https://get.vulos.org | sudo bash -s -- --storage=minio

sudo systemctl enable --now vulos-bundle.target
```

See [INSTALL.md](INSTALL.md) for co-location details and shared storage config.

---

## Configuration

Copy or edit `config.yaml` at the repo root:

```yaml
server:
  addr: ":8080"
  data_dir: "./data"
  uploads_dir: "./uploads"

auth:
  enabled: false       # true = require password login
  password: "changeme"
  max_attempts: 5
  lockout_minutes: 15
  session_hours: 24

storage:
  type: "local"        # "local" (JSON files) or "postgres"
  postgres:
    host: "localhost"
    port: 5432
    user: "postgres"
    password: ""
    database: "localfirst"
    sslmode: "disable"
```

For the full environment variable and observability reference see [CONFIGURATION.md](CONFIGURATION.md).

---

## First use

1. Open the app. Without auth the home screen loads immediately.
2. Click **New** to create a document, sheet, or presentation.
3. Open a PDF to view, annotate, or set up signing.

> Calendar and Contacts are no longer part of LocalFirst — they come through the mail
> connector (CalDAV/CardDAV via lilmail). The LocalFirst sidebar deep-links to that surface.

---

## Next steps

- [CONFIGURATION.md](CONFIGURATION.md) — env vars, SMTP, OTEL, org-bucket
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit together
- [DEPLOY.md](DEPLOY.md) — production deployment options
- [INSTALL.md](INSTALL.md) — single-box co-location with Vulos OS
- [../ROADMAP.md](../ROADMAP.md) — planned features
