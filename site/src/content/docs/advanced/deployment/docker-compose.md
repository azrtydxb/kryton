---
title: Docker Compose
description: Run Kryton with the bundled docker-compose stacks — development and production.
---

Kryton ships two compose files at the repo root:

- `docker-compose.yml` — builds the server from source, exposes Postgres on the host, hard-codes a development password. Use for local hacking.
- `docker-compose.prod.yml` — pulls the published `ghcr.io/azrtydxb/kryton/kryton:latest` image, keeps Postgres internal, takes credentials from environment.

Both stacks use the [`pgvector/pgvector:pg16`](https://hub.docker.com/r/pgvector/pgvector) Postgres image. The `vector` extension is enabled by the init script under `packages/server/docker/postgres-init/` on first boot of the development file; the production file relies on the entrypoint's Drizzle migrator to find the extension already present.

## Development stack

From a checkout of the repo:

```bash
docker compose up -d
```

This builds the image from the local `Dockerfile`, starts Postgres, and exposes the server on `http://localhost:3000`. The compose file:

- Builds the image with `build: .`.
- Publishes Postgres on host port `5432:5432` (so you can connect a SQL client).
- Mounts `./notes` from the host into `/notes` in the container.
- Names the Postgres volume `postgres-data`.
- Sets `BETTER_AUTH_SECRET=change-me-use-openssl-rand-hex-32` — fine for local, never deploy this.

The kryton service has no restart policy in the dev file; it stops when you stop compose.

## Production stack

`docker-compose.prod.yml` is the file to copy onto a VPS. From a working directory containing only that file and a `.env`:

```bash
docker compose -f docker-compose.prod.yml up -d
```

The image tag is `:latest` — pin it to a release tag (e.g. `:v4.6.4`) before promoting to production.

### Required environment

Both variables are referenced via `${VAR:?…}` syntax, so compose refuses to start if they're empty:

| Variable | Source | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | you generate it | Used both for the Postgres init and the assembled `POSTGRES_URL`. |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` | Better-Auth session signing key. Must be ≥32 characters or the server refuses to boot. |

Optional with defaults:

| Variable | Default | Purpose |
|---|---|---|
| `APP_URL` | `http://localhost:3100` | Public URL of the client app — used for OAuth redirects and CORS. |
| `BETTER_AUTH_URL` | `http://localhost:3100` | Public URL the server is reachable at. Match this to your reverse proxy's external URL. |

Anything else from `packages/server/src/config/env.ts` (OAuth client IDs, SMTP, log level, semantic-search tuning) can be added under the `kryton.environment:` block in the compose file — Compose merges them with the file's existing list.

### Volumes and persistence

| Volume | Mount | Contains |
|---|---|---|
| `kryton-postgres` (named) | `/var/lib/postgresql/data` in the postgres container | All Postgres state, including notes data, vector embeddings, users, sessions. |
| `kryton-data` (named) | `/data` in the kryton container | Free for future server-side state. |
| `./notes` (host bind) | `/notes` in the kryton container | Note files. `NOTES_DIR=/notes` is set so the server writes here. |

`docker compose down` does not delete named volumes. `docker compose down -v` does — use it deliberately.

### Restart and health

Both `postgres` and `kryton` declare `restart: unless-stopped` in the production file. Postgres has a healthcheck on `pg_isready`; `kryton` depends on it with `condition: service_healthy`, so the server is not started until Postgres accepts connections.

### Port mapping

`kryton` publishes `3100:3000` — the container listens on its internal default `3000`; the host port is `3100`. Front this with a reverse proxy (see [Free-tier self-host](/advanced/deployment/free-tier-self-host/) for a Caddy + Tailscale walkthrough).

## .env template for the production stack

```dotenv
POSTGRES_PASSWORD=replace-with-strong-password
BETTER_AUTH_SECRET=replace-with-openssl-rand-hex-32

# Optional — public URL of the deployment.
APP_URL=https://kryton.example.com
BETTER_AUTH_URL=https://kryton.example.com
```

The full list of variables the server accepts is defined in `packages/server/src/config/env.ts`. Defaults that matter when running under compose:

- `PORT=3000` (set by the Dockerfile; do not change unless you also change the published port).
- `HOST=0.0.0.0`.
- `NODE_ENV=production` (set by the Dockerfile).
- `OPENAPI_ENABLED=true` — `/docs` serves OpenAPI UI. Set to `false` to hide it.
- `WEBAUTHN_RP_ID=localhost` — set this to your bare hostname (e.g. `kryton.example.com`) before enabling passkeys in production.

### Mobile app integration (optional)

These variables enable the mobile-client binding features (Universal Links, Android App Links, mobile passkey ceremonies). All are optional — Kryton degrades gracefully when they are unset.

**iOS**

| Variable | Example | Purpose |
|---|---|---|
| `MOBILE_IOS_TEAM_ID` | `ABCDE12345` | Apple Developer Team ID. Required for `apple-app-site-association` (Universal Links + `webcredentials`). |
| `MOBILE_IOS_BUNDLE_ID` | `com.kryton.mobile` | iOS bundle identifier. Also used as the WebAuthn passkey origin (`ios:bundle-id:…`). |

**Android**

| Variable | Example | Purpose |
|---|---|---|
| `MOBILE_ANDROID_PACKAGE` | `com.kryton.mobile` | Android package name. Required for `assetlinks.json` (App Links + login credentials). |
| `MOBILE_ANDROID_SHA256_FINGERPRINTS` | `AA:BB:CC:…` | Comma-separated SHA-256 **certificate** fingerprints for `assetlinks.json`. This is the hash of the signing _certificate_ — **not** the same as `MOBILE_ANDROID_APK_KEY_HASH`. |
| `MOBILE_ANDROID_APK_KEY_HASH` | `base64url…` | Base64url-encoded SHA-256 of the signing **public key**. Used as the WebAuthn passkey origin (`android:apk-key-hash:…`). Different from the certificate fingerprint — do not mix them up. Derive with: `keytool -exportcert -alias <alias> -keystore <ks> \| openssl dgst -sha256 -binary \| openssl base64 \| tr '+/' '-_' \| tr -d '='` |

**Push notifications**

Push notifications require both the APNs block (for iOS) and the FCM block (for Android) to be fully configured. Either block being absent disables dispatch for that platform.

| Variable | Purpose |
|---|---|
| `APNS_KEY_ID` | APNs token-auth key ID (10-char, from Apple Developer portal). |
| `APNS_TEAM_ID` | Apple Developer Team ID for APNs token auth. |
| `APNS_BUNDLE_ID` | iOS app bundle ID for the APNs topic (e.g. `com.kryton.mobile`). |
| `APNS_KEY_PATH` | Filesystem path to the APNs `.p8` private key file. |
| `APNS_PRODUCTION` | `true` for the production APNs gateway, `false` (default) for sandbox. |
| `FCM_SERVICE_ACCOUNT_PATH` | Path to the Firebase service account JSON key file. |
| `FCM_PROJECT_ID` | Firebase project ID (e.g. `my-project-12345`). |

## What runs on boot

The image's entrypoint (`entrypoint.sh`) is two lines:

```sh
node scripts/migrate-prod.mjs
exec node dist/server.js
```

The migrator (`packages/server/scripts/migrate-prod.mjs`) applies any pending Drizzle migrations from `dist/db/migrations/` against `POSTGRES_URL`, then the server starts. Boot fails loudly if migrations fail — the container exits non-zero and Compose restarts it under `unless-stopped`.

## See also

- [Backups & restore](/advanced/deployment/backups-restore/) — `pg_dump` against the bundled Postgres.
- [Upgrades & migrations](/advanced/deployment/upgrades-and-migrations/) — image-tag bumps, migration ordering, `/api/version`.
- [Free-tier self-host](/advanced/deployment/free-tier-self-host/) — end-to-end VPS walkthrough.
