---
title: Free-tier self-host
description: One opinionated path — Hetzner CX22 (~€4/month) + Docker Compose + Caddy + Tailscale. Step by step.
---

There's no truly free VPS that runs Kryton well — the semantic-search worker alone wants ~200 MB. The cheapest viable path is a **Hetzner CX22** at €4.50/month (2 vCPU, 4 GB RAM, 40 GB SSD). This walkthrough takes you from a fresh `ssh root@…` to a logged-in browser, in one opinionated sitting.

Stack:

- **Ubuntu 24.04** on Hetzner CX22
- **Docker Compose** for Kryton + Postgres
- **Caddy** for automatic HTTPS via Let's Encrypt
- **Tailscale** if you want it private to your tailnet (optional)

## 1. Provision

Sign in to [Hetzner Cloud](https://console.hetzner.cloud/), create a project, then create a server:

- **Location**: closest to you.
- **Image**: Ubuntu 24.04.
- **Type**: CX22 (€4.50/mo, 2 vCPU, 4 GB RAM, 40 GB SSD).
- **SSH keys**: upload your public key.
- **Name**: `kryton`.

Wait ~30 seconds. Hetzner emails you the IP.

## 2. Initial hardening

```bash
ssh root@<server-ip>

# Update + install essentials
apt update && apt upgrade -y
apt install -y docker.io docker-compose-plugin ufw

# Firewall: only SSH + HTTP + HTTPS
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# A non-root user
adduser --disabled-password --gecos "" kryton
usermod -aG docker kryton
mkdir -p /home/kryton/.ssh
cp ~/.ssh/authorized_keys /home/kryton/.ssh/
chown -R kryton:kryton /home/kryton/.ssh
chmod 700 /home/kryton/.ssh
chmod 600 /home/kryton/.ssh/authorized_keys
```

From here on, `ssh kryton@<server-ip>`. You shouldn't need root again.

## 3. DNS

Point an A record at the server. With Cloudflare, Route 53, or any DNS provider:

```
kryton.example.com.   A   <server-ip>
```

Wait for it to propagate (`dig +short kryton.example.com` should return your IP).

## 4. Deploy Kryton

```bash
ssh kryton@<server-ip>
git clone https://github.com/azrtydxb/kryton.git
cd kryton

cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
APP_URL=https://kryton.example.com
BETTER_AUTH_URL=https://kryton.example.com
EOF
chmod 600 .env

docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f kryton
```

Kryton is now listening on `localhost:3100`. Don't open that port to the internet directly — Caddy is next.

## 5. Caddy for HTTPS

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

The Caddyfile (`/etc/caddy/Caddyfile`):

```caddyfile
kryton.example.com {
    encode zstd gzip

    # Yjs WebSocket needs an upgrade-friendly proxy.
    reverse_proxy localhost:3100 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # Reasonable defaults for file uploads (attachments).
    request_body {
        max_size 50MB
    }
}
```

Reload:

```bash
sudo systemctl reload caddy
```

Caddy auto-provisions a Let's Encrypt cert on first request. Visit `https://kryton.example.com` — register the first account; that account becomes admin.

## 6. (Optional) Tailscale instead of public HTTPS

If you'd rather not expose Kryton to the internet, run it on your tailnet:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --advertise-tags=tag:kryton --ssh
```

Approve the device in the Tailscale admin console. The server is now reachable at `kryton` (the tailnet name) from any of your other tailnet devices.

Adjust the Caddyfile to listen on the tailnet IP and skip public TLS, or drop Caddy entirely and just port-forward `100.x.y.z:3100` over the tailnet — your call.

## 7. Backups

For this scale, a nightly `pg_dump` + `tar` of `notes/` is plenty. Add a cron:

```bash
mkdir -p /home/kryton/backups
cat > /home/kryton/backup.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /home/kryton/kryton
TS=$(date +%Y%m%d-%H%M%S)
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U kryton --format=custom kryton > "/home/kryton/backups/db-$TS.dump"
tar czf "/home/kryton/backups/notes-$TS.tar.gz" notes/
find /home/kryton/backups -mtime +30 -delete
EOF
chmod +x /home/kryton/backup.sh

(crontab -l 2>/dev/null; echo "0 3 * * * /home/kryton/backup.sh") | crontab -
```

`rclone` or `rsync` the `backups/` dir to S3 / B2 / a second VPS — the details are out of scope. See [Backups and restore](/kryton/advanced/deployment/backups-restore/) for the full restore drill.

## 8. Upgrades

```bash
cd /home/kryton/kryton
git pull
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Drizzle migrations run automatically on boot. See [Upgrades and migrations](/kryton/advanced/deployment/upgrades-and-migrations/).

## Where next

You now have a working, HTTPS-terminated Kryton instance with backups. If your team grows past one machine, or you want multiple Kryton instances on shared infra, graduate to:

- [Helm chart](/kryton/advanced/deployment/helm/) for Kubernetes.
- [Kubernetes Operator](/kryton/advanced/deployment/operator/) for declarative multi-instance + managed backups.
