---
title: Get a public URL with Kryton Connect
description: One paid add-on that gives your self-hosted Kryton a public address like you.my.kryton.ai — no port forwarding, no certificates, no DNS to manage.
---

Your Kryton is running on your machine. Now you want it reachable from
your phone, from a friend, or from your AI tools running on a different
computer. **Kryton Connect** is the one-click way to make that happen.

## What you get

- A public address like `you.my.kryton.ai`.
- HTTPS already set up. No certificates to buy, install, or renew.
- Nothing to open on your router. No port forwarding. No DNS records.
- Works from anywhere you have internet — home, cafe, plane.
- Your AI tools can reach Kryton over the same address.

It is a paid add-on run by the kryton.ai team. Self-hosting works fine
without it; this is the easy button if you do not want to wrestle with
networking.

## Set it up in four steps

1. **Sign up.** Go to [kryton.ai/tunnels/dashboard](https://kryton.ai/tunnels/dashboard)
   and create a tunnel. You will be given a token — a long string of
   letters and numbers. Copy it.
2. **Open Kryton.** Sign in as an admin (the first user you registered).
3. **Paste the token.** Settings → Admin → **Tunnel** → paste into
   "Token from kryton.ai dashboard" → Save.
4. **You are online.** The same screen shows your new address. Click
   it to open in a new tab.

That is it. Bookmark the address on your phone, log in there, your
notes follow you around.

## Connecting AI tools to your remote Kryton

Use the same one-shot installer from [Connect your AI](/kryton/start/connect-ai/),
but when it asks for your Kryton server URL, give it your new
`https://you.my.kryton.ai` address instead of `http://localhost:3000`.
Claude, Cursor, Codex, Claude Desktop — all work from anywhere now.

## Turning it off

The Tunnel tab has a Clear button. Press it and your instance is back
to being local-only.

---

Prefer to do it yourself? Anyone comfortable with a reverse proxy can
set up a public URL using Caddy, Cloudflare Tunnel, Tailscale, or
similar — see [Reverse proxy and TLS](/kryton/advanced/security/reverse-proxy-and-tls/)
in the advanced section. Kryton Connect just removes that step.
