---
title: Kryton Connect (get a public URL)
description: Optional managed reverse tunnel that gives your self-hosted Kryton a public `<subdomain>.my.kryton.ai` hostname without port forwarding or TLS certificates.
---

**Kryton Connect** is an optional managed networking service that takes
your self-hosted Kryton and gives it a public hostname like
`yourname.my.kryton.ai` — no port forwarding, no DNS records, no
certificates of your own to renew. If you want to access your notes
off your home network or share them with collaborators, this is the
easiest path.

It is a paid service operated by kryton.ai. Self-hosting works fine
without it; this page only matters if you want managed remote access.

## How it works

The Kryton server already ships a tunnel client
(`packages/server/src/modules/tunnel/`). When you configure a JWT,
the server dials `tunnel.kryton.ai` over HTTP/2 CONNECT, runs a yamux
session over the resulting body, and pipes each inbound stream into
your local Fastify listener via TCP loopback. The browser sees
`https://yourname.my.kryton.ai`; the bytes terminate inside your
process.

No extra binary to run. No daemon to babysit. The tunnel client lives
inside your Kryton process, restarts with it, and surfaces its state in
the admin panel.

## Setup

1. **Sign up at the Connect dashboard.** Open
   [`kryton.ai/tunnels/dashboard`](https://kryton.ai/tunnels/dashboard)
   and create a tunnel. You will be issued a JWT.
2. **Open Kryton as an admin.** Go to Settings → Admin → **Tunnel**.
3. **Paste the token.** The "Token from kryton.ai dashboard" field
   accepts the JWT; click Save.
4. **Confirm.** The status block on the same tab will show your
   subdomain (`<subdomain>.my.kryton.ai`) and connection state. Open it
   in a new tab to confirm.

Clearing the JWT (the same tab has a clear-token control) stops the
tunnel and your instance reverts to whatever local hostname you were
using.

## Operational notes

- **Traffic stats** — the Tunnel tab shows requests, bytes in/out per
  day. Backed by the `TunnelTrafficDaily` table in your Postgres.
- **Force reconnect** — `POST /api/admin/tunnel/reconnect` (also a
  button in the tab) triggers a reconnect without restarting the
  server.
- **Trusted origin** — when a tunnel is active the server
  automatically adds `https://<subdomain>.my.kryton.ai` to better-auth
  trusted origins; you do not need to configure CORS manually.
- **Override the server URL** — `KRYTON_TUNNEL_SERVER_URL` and
  `KRYTON_TUNNEL_PUBLIC_HOST` env vars exist for self-hosted tunnel
  servers if you ever want to run one (advanced; not the supported
  path).

## Alternative: roll your own tunnel

Kryton Connect is optional. The standard self-hosted recipe is your
own reverse proxy in front of the Kryton container — see
[Reverse proxy and TLS](/kryton/advanced/security/reverse-proxy-and-tls/)
for Caddy / Nginx / Traefik examples. Tailscale, Cloudflare Tunnel,
ngrok, and similar tools all work without any Kryton-side config.
