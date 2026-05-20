---
title: Reverse proxy and TLS
description: Caddy, Nginx, and Traefik recipes for fronting Kryton — TLS termination, proxy headers, and the Yjs WebSocket upgrade.
---

Kryton's HTTP server (Fastify, listens on `PORT`, default `3001`) is
designed to sit behind a TLS-terminating reverse proxy in production.

## Trust-proxy is on

`packages/server/src/app.ts` builds Fastify with `trustProxy: true`, so
the server honours `X-Forwarded-For` / `X-Forwarded-Proto` /
`X-Forwarded-Host` from any upstream. **Only run Kryton behind a proxy
you control** — `trustProxy: true` means the server trusts whatever sent
those headers.

## What the proxy must do

1. Terminate TLS.
2. Forward HTTP to Kryton's `PORT`.
3. Pass through the WebSocket upgrade on `/ws/yjs/:docId` (collaborative
   editing) and any plugin WebSocket routes.
4. Match the public URL you configured in `APP_URL` / `BETTER_AUTH_URL`
   — better-auth checks origins against these.
5. If you use passkeys, set `WEBAUTHN_RP_ID` to the public hostname
   without port or scheme, e.g. `kryton.example.com`.

## Caddy

Caddy handles TLS, HTTP/2, and WebSocket upgrades with no extra
configuration.

```caddy
kryton.example.com {
  reverse_proxy localhost:3001
}
```

## Nginx

Nginx needs the WebSocket upgrade map and `proxy_http_version 1.1`:

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 443 ssl http2;
  server_name kryton.example.com;

  ssl_certificate     /etc/letsencrypt/live/kryton.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/kryton.example.com/privkey.pem;

  client_max_body_size 50m;

  location / {
    proxy_pass http://127.0.0.1:3001;

    proxy_http_version 1.1;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        $connection_upgrade;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Yjs WebSockets are long-lived. Without this the proxy will cut
    # collaborative editing sessions after 60 s of idle.
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }
}
```

## Traefik (labels on the Kryton container)

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.kryton.rule=Host(`kryton.example.com`)
  - traefik.http.routers.kryton.entrypoints=websecure
  - traefik.http.routers.kryton.tls.certresolver=letsencrypt
  - traefik.http.services.kryton.loadbalancer.server.port=3001
```

Traefik proxies WebSockets transparently — no extra middleware required.

## Yjs WebSocket — what to forward

The collaborative-editing route is mounted at `/ws/yjs/:docId` (see
`packages/server/src/modules/collab/ws/yjs.handler.ts`). The upgrade
request:

- Method: `GET` with the standard `Upgrade: websocket` /
  `Connection: Upgrade` headers.
- Auth: session cookie **or** an agent bearer token passed in
  `Sec-WebSocket-Protocol` as the pair `kryton-token, <token>`
  (`packages/server/src/lib/ws-auth.ts`). Query-string tokens are
  deliberately rejected because they leak through access logs.

Any proxy that preserves the `Cookie` and `Sec-WebSocket-Protocol`
headers (all three examples above do) works as-is.

## Production checklist

- `APP_URL` and `BETTER_AUTH_URL` set to your public `https://…` origin.
- `CORS_ORIGINS` includes your public origin and nothing else.
- `BETTER_AUTH_SECRET` is at least 32 random characters and stable
  across restarts.
- `WEBAUTHN_RP_ID` set to the public hostname if you use passkeys.
- Reverse-proxy WebSocket timeouts ≥ 1 hour so live editing sessions
  don't get cut.
