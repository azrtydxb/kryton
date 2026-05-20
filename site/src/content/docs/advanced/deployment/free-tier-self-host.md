---
title: Cheap self-host
description: One opinionated path — small VPS + Docker Compose + Caddy + Tailscale, step by step.
---

One opinionated, end-to-end path: a small Hetzner VPS (CX22 — small VPS, ~€4/month, check current pricing) running Ubuntu 24.04, Docker Compose for Kryton + Postgres, Caddy in front for TLS, and Tailscale so you can choose between a public hostname or a private overlay.

Anything more elaborate (Kubernetes, multi-region, HA Postgres) is documented in the [Helm](/advanced/deployment/helm/) and [Operator](/advanced/deployment/operator/) pages.

## 1. Provision the VPS

Sign up at hetzner.com, create a CX22 (or any cheap VPS — Hetzner CX22 is the reference here), pick **Ubuntu 24.04**. Add your SSH key. Note the public IPv4.

If you want a public hostname, point an `A` record at the IP. If you only want a Tailnet-private install, you can skip the DNS step entirely.

## 2. Initial server setup

SSH in as `root`:

```bash
ssh root@<server-ip>
```

Then:

```bash
apt-get update && apt-get -y upgrade
apt-get -y install ufw

# Firewall: keep it tight. SSH + 80/443.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Unattended security updates.
apt-get -y install unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

# Create a non-root user.
adduser --disabled-password --gecos "" kryton
usermod -aG sudo kryton
mkdir -p /home/kryton/.ssh
cp ~/.ssh/authorized_keys /home/kryton/.ssh/
chown -R kryton:kryton /home/kryton/.ssh
chmod 700 /home/kryton/.ssh
chmod 600 /home/kryton/.ssh/authorized_keys
```

Re-login as `kryton` from now on:

```bash
ssh kryton@<server-ip>
```

## 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker compose version   # sanity check
```

## 4. Install Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up --ssh
```

Follow the URL printed by `tailscale up` and authenticate. After this the box has a `100.x.y.z` Tailnet address and a `<hostname>.tail-scale.ts.net` MagicDNS name.

You now have a choice:

- **Public**: front Kryton with a real domain + Let's Encrypt. Keep reading section 5.
- **Tailnet-only**: skip ports 80/443 from the public firewall (you can run `ufw delete allow 80/tcp` and `ufw delete allow 443/tcp`) and use the MagicDNS hostname. See section 7.

## 5. Lay out the project

```bash
mkdir -p ~/kryton/notes
cd ~/kryton
```

Create `docker-compose.yml` — this is `docker-compose.prod.yml` from the Kryton repo, verbatim:

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
      - "127.0.0.1:3100:3000"
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

The only change from the in-repo file is the port binding: `127.0.0.1:3100:3000` keeps the server off the public interface — Caddy proxies to it locally.

Create `.env`:

```dotenv
POSTGRES_PASSWORD=$(openssl rand -hex 24)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
APP_URL=https://kryton.example.com
BETTER_AUTH_URL=https://kryton.example.com
```

(Substitute the `openssl` output and your real hostname literally — `.env` is not a shell script.)

Pull and start:

```bash
docker compose pull
docker compose up -d
docker compose logs -f kryton
```

Wait for the line `Server listening at http://0.0.0.0:3000`. Migrations run on boot — failures show in the log.

## 6. Front it with Caddy (public hostname path)

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

Replace `/etc/caddy/Caddyfile` with exactly:

```caddyfile
kryton.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3100
}
```

Reload:

```bash
sudo systemctl reload caddy
sudo journalctl -u caddy -f
```

Caddy fetches a Let's Encrypt certificate automatically. Browse to `https://kryton.example.com` — sign up the first account, then disable open registration in the admin UI.

> Before enabling passkeys for production, set
> `WEBAUTHN_RP_ID=kryton.example.com` under the `kryton.environment:` block
> (it defaults to `localhost`).

## 7. Tailscale-only path

Skip Caddy and skip DNS. The server is already bound to `127.0.0.1:3100`. To reach it from another Tailnet device, use `tailscale serve`:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:3100
```

Tailscale provisions a cert for `<hostname>.<tailnet>.ts.net` and proxies it to the local port. Set `APP_URL` / `BETTER_AUTH_URL` to that name, then `docker compose up -d` to restart.

## 8. Updates

```bash
cd ~/kryton
docker compose pull
docker compose up -d
```

Migrations run automatically on boot. For backup/restore steps see [Backups & restore](/advanced/deployment/backups-restore/).

## 9. Backups (one-liner)

A daily root cron entry. As root:

```bash
mkdir -p /var/backups/kryton
cat >/etc/cron.daily/kryton-backup <<'SH'
#!/bin/sh
set -e
ts=$(date -u +%Y%m%dT%H%M%SZ)
cd /home/kryton/kryton
docker compose exec -T postgres pg_dump -U kryton --format=custom kryton \
  > /var/backups/kryton/kryton-${ts}.dump
tar czf /var/backups/kryton/notes-${ts}.tar.gz -C /home/kryton/kryton notes
find /var/backups/kryton -mtime +30 -delete
SH
chmod +x /etc/cron.daily/kryton-backup
```

The richer story (encrypted off-server backups, restore drill) is in [Backups & restore](/advanced/deployment/backups-restore/).

## Cost notes

The only number quoted here is "Hetzner CX22 ~€4/month" — check Hetzner's current pricing before relying on that. Other unavoidable line items: a domain (~€10–15/year for `.com`) if you want the public-hostname path. Tailscale's free tier covers everything in this guide.
