---
title: Install with Docker
description: Bring up a Kryton server with docker compose using the published image.
---

The production compose file in the repo runs two containers: `pgvector/pgvector:pg16` for storage and `ghcr.io/azrtydxb/kryton/kryton:latest` for the server.

## 1. Get the compose file

```sh
curl -O https://raw.githubusercontent.com/azrtydxb/kryton/main/docker-compose.prod.yml
```

## 2. Set the required environment variables

The compose file requires two secrets (both fail-fast if unset):

```sh
export POSTGRES_PASSWORD="$(openssl rand -hex 16)"
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
```

Optional overrides (defaults shown):

| Variable | Default |
|---|---|
| `APP_URL` | `http://localhost:3100` |
| `BETTER_AUTH_URL` | `http://localhost:3100` |

## 3. Start the stack

```sh
docker compose -f docker-compose.prod.yml up -d
```

The server listens on host port `3100` (container port `3000`). Notes live in a `./notes` directory mounted into the container at `/notes`; Postgres data and the server's own data volume are managed by Docker.

## 4. Sign in

Open `http://localhost:3100` and create the first account.

![Kryton login screen](/kryton/screenshots/login.png)

## Next

[Connect your AI](/kryton/start/connect-ai/) — one command wires every supported AI host to the server you just started.
