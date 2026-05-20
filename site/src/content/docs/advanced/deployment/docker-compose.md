---
title: Docker Compose
description: Run Kryton in production with Docker Compose — annotated reference, env vars, volumes, and operational knobs.
---

The fastest production-grade path. One Compose file boots Postgres (with pgvector), the Kryton server, and persistent volumes for notes and database state.

## The file

Kryton ships a `docker-compose.prod.yml` at the repo root:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      - POSTGRES_USER=kryton
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}
      - POSTGRES_DB=kryton
    volumes:
      - kryton-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "kryton", "-d", "kryton"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

  kryton:
    image: ghcr.io/azrtydxb/kryton/kryton:latest
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3100:3000"
    volumes:
      - ./notes:/notes
      - kryton-data:/data
    environment:
      - POSTGRES_URL=postgres://kryton:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}@postgres:5432/kryton
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:?Set BETTER_AUTH_SECRET}
      - APP_URL=${APP_URL:-http://localhost:3100}
      - BETTER_AUTH_URL=${BETTER_AUTH_URL:-http://localhost:3100}
      - NOTES_DIR=/notes
    restart: unless-stopped

volumes:
  kryton-data:
  kryton-postgres:
```

## First boot

```bash
git clone https://github.com/azrtydxb/kryton.git
cd kryton
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
APP_URL=https://kryton.example.com
BETTER_AUTH_URL=https://kryton.example.com
EOF
docker compose -f docker-compose.prod.yml up -d
```

The first user to register through the UI becomes admin. Visit `http://<host>:3100` and create that account immediately — registration is open until the first user lands, then closes by default.

## Services

### `postgres`

Image: `pgvector/pgvector:pg16`. The `pgvector` extension is required for semantic search; the stock `postgres:16` image will **not** work. The image initialises with user `kryton`, database `kryton`. The healthcheck runs every 5 s — the `kryton` service waits for it before starting so first-boot migrations don't race the DB.

### `kryton`

Image: `ghcr.io/azrtydxb/kryton/kryton:latest`. In production, pin to a specific tag (e.g. `:4.6.0`) — the `latest` tag drifts. Drizzle migrations run automatically on boot.

## Environment variables

The Compose file references only the env it needs from your `.env`. The full env-var reference lives at [/advanced/reference/env-vars/](/kryton/advanced/reference/env-vars/). The ones that matter here:

| Variable | Required | Example | Notes |
|---|---|---|---|
| `POSTGRES_PASSWORD` | yes | `openssl rand -hex 16` | Used by both Postgres and the server's DSN. |
| `BETTER_AUTH_SECRET` | yes | `openssl rand -hex 32` | At least 32 chars. The server refuses to boot otherwise. |
| `APP_URL` | yes for OAuth | `https://kryton.example.com` | Public URL of the app. Used for OAuth redirects and CORS. |
| `BETTER_AUTH_URL` | yes for OAuth | same as `APP_URL` | Public URL the auth callback targets. |
| `POSTGRES_URL` | derived | n/a | Synthesised from `POSTGRES_PASSWORD`. Override if pointing at an external DB. |
| `NOTES_DIR` | no | `/notes` | Path inside the container. Matches the bind-mount. |

Add OAuth, SMTP, and WebAuthn settings to `.env` as you need them — they're picked up automatically because the Kryton server reads its full process env.

## Volumes

| Mount | Purpose |
|---|---|
| `./notes` → `/notes` | Markdown files on disk. Bind-mount so you can `ls notes/` from the host and back it up with rsync. |
| `kryton-data` → `/data` | Plugin data, attachments, generated assets. Named volume. |
| `kryton-postgres` → `/var/lib/postgresql/data` | Database files. Never bind-mount this onto a network filesystem — Postgres assumes POSIX semantics. |

## Reverse proxy

Compose exposes port 3100 on the host. In production, terminate TLS in front of it. See [Reverse proxy and TLS](/kryton/advanced/security/reverse-proxy-and-tls/) for full Caddy / Nginx / Traefik examples.

If you're behind a proxy, the server already trusts `X-Forwarded-*` headers when `NODE_ENV=production` (the default container env). No extra config needed.

## Production knobs

```yaml
environment:
  - NODE_ENV=production       # already set by the image; keep
  - LOG_LEVEL=info            # info | warn | error | debug | trace
  - PORT=3000                 # inside the container
  - CORS_ORIGINS=https://kryton.example.com
  - RATE_LIMIT_MAX=1000
  - RATE_LIMIT_WINDOW=1 minute
```

### Restart policy

`restart: unless-stopped` keeps the services up across host reboots without overriding a deliberate `docker compose stop`. For systemd-managed hosts, you can also wrap this in a unit file — the policy is idempotent either way.

### Resource limits

Compose v2 honours `deploy.resources.limits`. A reasonable starting point:

```yaml
services:
  kryton:
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 1G
        reservations:
          cpus: "0.25"
          memory: 256M
  postgres:
    deploy:
      resources:
        limits:
          memory: 1G
```

The semantic-search worker downloads a ~23 MB MiniLM model on first boot and keeps it resident — budget ~150 MB of headroom for the embedder alone. Set `SEMANTIC_PROVIDER=off` to disable it entirely if you don't need semantic search.

## Operations

### Upgrade

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Migrations run on boot. See [Upgrades and migrations](/kryton/advanced/deployment/upgrades-and-migrations/).

### Logs

```bash
docker compose logs -f kryton
docker compose logs -f postgres
```

### Backup

See [Backups and restore](/kryton/advanced/deployment/backups-restore/) — the short version is `pg_dump` + an rsync of `./notes`.

### Reset

Destroys all data:

```bash
docker compose -f docker-compose.prod.yml down -v
```

The `-v` deletes the named volumes. Without it, your data survives the next `up`.

## See also

- [Helm chart](/kryton/advanced/deployment/helm/) — Kubernetes-native, with Postgres + ingress + secrets.
- [Kubernetes Operator](/kryton/advanced/deployment/operator/) — multi-instance with managed backups.
- [Free-tier self-host](/kryton/advanced/deployment/free-tier-self-host/) — Compose on a €4/month VPS with Caddy + Tailscale.
