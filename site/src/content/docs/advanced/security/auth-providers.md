---
title: Auth providers
description: Email + password, Google and GitHub OAuth, Passkeys, TOTP 2FA, and the open / invite-only registration switch.
---

Kryton's auth stack is [Better Auth](https://better-auth.com) mounted at
`/api/auth/*`. All of the methods below share that catch-all — they're
configured server-side via environment variables and feature-flagged
client-side based on what's present at boot.

## Email and password

Always on.

- Min length 8, max 72 characters — see `emailAndPassword` in
  `packages/server/src/modules/identity/auth-config.ts`.
- `autoSignIn: true` — newly registered users are logged in immediately.
- Password reset emails are sent only when `SMTP_HOST` is set; otherwise
  the reset URL is logged at info level and the request silently succeeds.
  Configure with `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_FROM` (all defined in `config/env.ts`).

## OAuth — Google and GitHub

Each provider activates only when both its client ID and secret are set.

| Provider | Env vars |
|----------|----------|
| Google   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |

Both are defined in `config/env.ts` and wired in
`auth-config.ts → socialProviders`. The login page reads
`GET /api/auth/config` and shows only the buttons for providers whose
secrets are present.

No other OAuth providers are wired today.

## Passkeys (WebAuthn)

Wired via the `@better-auth/passkey` plugin. The relying-party ID comes
from `WEBAUTHN_RP_ID` (defaults to `localhost`); for production set it to
the public hostname (e.g. `kryton.example.com`). The relying-party origin
is taken from `APP_URL`.

Users enroll passkeys from **Account Settings → Security** (rendered by
`packages/client/src/components/Security/PasskeyManager.tsx`). Registration
and authentication flow through the Better Auth catch-all.

## Two-factor authentication (TOTP)

Wired via Better Auth's `twoFactor` plugin. Settings (from
`auth-config.ts`):

- Issuer: `Kryton`
- TOTP period: 30 s, 6 digits
- 10 backup codes generated at enrollment

Users opt in from **Account Settings → Security** (rendered by
`packages/client/src/components/Security/TwoFactorManager.tsx`).

## Registration mode — open vs invite-only

The first user to register automatically becomes `admin` (the
`databaseHooks.user.create.before` hook in `auth-config.ts`). After that,
the `registration_mode` setting controls who can sign up:

- `open` (default) — anyone with a valid email can register.
- `invite-only` — registration requires an `inviteCode` in the request
  body. Invite codes are single-use and atomically claimed to avoid
  races; admins manage them via the admin UI.

Switch the mode from **Admin → Settings**, which calls
`PUT /api/admin/settings/registration-mode` (see
`packages/server/src/modules/platform/routes/admin-settings.routes.ts`).

## Sessions

- 7-day expiry, sliding 1-day refresh — `session.expiresIn` /
  `session.updateAge` in `auth-config.ts`.
- Cookie cache enabled, 5-minute TTL.
- Signing secret: `BETTER_AUTH_SECRET` (minimum 32 chars, enforced in
  `config/env.ts`).
- Trusted origins are `APP_URL`, `kryton://` (the desktop scheme), and
  any extras pushed in by the tunnel module.
