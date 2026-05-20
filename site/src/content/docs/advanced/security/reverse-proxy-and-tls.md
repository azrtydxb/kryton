---
title: Reverse proxy and TLS
description: Caddy, Nginx, and Traefik recipes for fronting Kryton — TLS termination, proxy headers, and the Yjs WebSocket upgrade.
---

Kryton expects to sit behind a reverse proxy in production. The server speaks plain HTTP and trusts `X-Forwarded-*` headers when `NODE_ENV=production` (the default in the official image). All you have to do is point the proxy at it.

Three working configs follow. Pick whichever matches your stack — the substance is the same.

## What the proxy needs to do

1. Terminate TLS (Let's Encrypt or your own cert).
2. Forward HTTP to `kryton:3000` (Compose) or `kryton:3001` (Helm), preserving:
   - `Host` header.
   - `X-Real-IP` / `X-Forwarded-For`.
   - `X-Forwarded-Proto` (so the server emits HTTPS-aware redirects and sets `Secure` cookies confidently).
3. Allow **WebSocket upgrades** for the Yjs collaborative-editing endpoint at `/ws/yjs/:docId`. Most proxies do this by default.
4. Allow request bodies large enough for attachment uploads (default 50 MB is comfortable).

## Caddy

The simplest path — auto-HTTPS via Let's Encrypt with one line.

```caddyfile
kryton.example.com {
    encode zstd gzip

    reverse_proxy localhost:3100 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    request_body {
        max_size 50MB
    }
}
```

Drop in `/etc/caddy/Caddyfile`, `systemctl reload caddy`. Caddy provisions a Let's Encrypt cert on first request and renews automatically. WebSocket upgrade is handled transparently by `reverse_proxy`.

## Nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name kryton.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name kryton.example.com;

    ssl_certificate     /etc/letsencrypt/live/kryton.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kryton.example.com/privkey.pem;

    client_max_body_size 50M;

    location / {
        proxy_pass         http://127.0.0.1:3100;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Yjs WebSocket upgrade
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Yjs connections stay open. Default 60s is too short.
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
    }
}
```

Get the cert with [`certbot --nginx`](https://certbot.eff.org/), then `systemctl reload nginx`.

## Traefik (file provider)

```yaml
http:
  routers:
    kryton:
      rule: Host(`kryton.example.com`)
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      service: kryton

  services:
    kryton:
      loadBalancer:
        servers:
          - url: "http://kryton:3000"
        passHostHeader: true
```

In a Compose deployment, the equivalent label-based form on the kryton service:

```yaml
services:
  kryton:
    labels:
      - traefik.enable=true
      - traefik.http.routers.kryton.rule=Host(`kryton.example.com`)
      - traefik.http.routers.kryton.entrypoints=websecure
      - traefik.http.routers.kryton.tls.certresolver=letsencrypt
      - traefik.http.services.kryton.loadbalancer.server.port=3000
```

Traefik handles WebSocket upgrades transparently. Make sure your `letsencrypt` cert resolver is wired up at the Traefik static config level.

## Kubernetes ingress

The Helm chart's `ingress` block emits an Ingress resource. The chart docs cover [nginx-ingress + cert-manager](/kryton/advanced/deployment/helm/#nginx-ingress--cert-manager) and [Traefik](/kryton/advanced/deployment/helm/#traefik). The same WebSocket and timeout concerns apply.

For nginx-ingress, set:

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: 50m
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
```

## Trust-proxy behaviour

The server already trusts the standard set of proxy headers in production. You do **not** need to set `TRUSTED_PROXIES` env or similar — Express's `trust proxy` is enabled in `production` mode and reads the first hop. If you sit behind multiple proxies (e.g. Cloudflare → nginx → kryton), make sure each forwards `X-Forwarded-For` so the chain stays intact; the server logs the first non-trusted IP for rate-limit and audit purposes.

In dev (`NODE_ENV=development`), proxy headers are ignored and the server treats every request as a direct connection. Don't run prod with `NODE_ENV=development` — sessions, cookies, and rate-limiting won't behave.

## Verifying

```bash
# Yjs WebSocket upgrade
curl -i -N \
  -H "Upgrade: websocket" \
  -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  -H "Sec-WebSocket-Version: 13" \
  https://kryton.example.com/ws/yjs/test
# Expect: HTTP/1.1 101 Switching Protocols
```

```bash
# Health probes
curl -fsS https://kryton.example.com/healthz   # alive
curl -fsS https://kryton.example.com/readyz    # alive + DB
```

If `/healthz` returns 200 but `/readyz` returns 503, the database isn't reachable from inside the container.

## See also

- [Auth providers](/kryton/advanced/security/auth-providers/) — session cookies need HTTPS.
- [Yjs WebSocket](/kryton/advanced/api/yjs-websocket/) — protocol details for the collaborative-editing endpoint.
- [Helm ingress](/kryton/advanced/deployment/helm/#ingress-examples) — Kubernetes-native equivalents.
