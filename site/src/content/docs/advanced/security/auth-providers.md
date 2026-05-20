---
title: Auth providers
description: Email + password, OAuth (Google, GitHub), Passkeys (WebAuthn), 2FA, and how to lock registration down.
---

Kryton's auth layer is [BetterAuth](https://www.better-auth.com/). The server exposes one sign-in surface that fans out to the providers you've enabled via environment variables. Every provider lands the user in the same session model; the only thing that varies is the credential.

## Email and password

On by default — no env required beyond `BETTER_AUTH_SECRET`.

Passwords are hashed with bcrypt before storage. Minimum length is 8 characters; the form rejects shorter input client-side and the server re-validates.

For password reset to work, configure SMTP:

| Variable | Required for reset email | Example |
|---|---|---|
| `SMTP_HOST` | yes | `smtp.fastmail.com` |
| `SMTP_PORT` | yes | `465` |
| `SMTP_SECURE` | yes | `true` |
| `SMTP_USER` | yes | `kryton@example.com` |
| `SMTP_PASS` | yes | (app password) |
| `SMTP_FROM` | yes | `Kryton <noreply@example.com>` |

Without SMTP, the "forgot password" link still appears in the UI but the email never arrives. Admins can manually reset a user via the admin panel.

## OAuth — Google

1. In the [Google Cloud Console](https://console.cloud.google.com/), create an OAuth 2.0 Client ID (Web application).
2. Authorized redirect URI: `https://kryton.example.com/api/auth/callback/google`.
3. Set the env on the server:

```env
GOOGLE_CLIENT_ID=1234567890-xxxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxx
APP_URL=https://kryton.example.com
BETTER_AUTH_URL=https://kryton.example.com
```

Restart the server. A **Continue with Google** button appears on the login page.

## OAuth — GitHub

1. In your [GitHub Developer Settings](https://github.com/settings/developers), create a new OAuth App.
2. Authorization callback URL: `https://kryton.example.com/api/auth/callback/github`.
3. Set the env:

```env
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Either OAuth provider is optional and independent — enable one, both, or neither.

## Passkeys (WebAuthn)

Passkeys let users sign in with Touch ID, Windows Hello, a YubiKey, or any other FIDO2 authenticator. After an account has a password set, the user can register a passkey from **Account Settings → Security**.

Required env:

```env
WEBAUTHN_RP_ID=kryton.example.com
APP_URL=https://kryton.example.com
```

`WEBAUTHN_RP_ID` must be the **hostname** (no scheme, no port) the user visits. WebAuthn binds credentials to this value — change it after passkeys are registered and they all stop working.

On `localhost`, `WEBAUTHN_RP_ID=localhost` is the only allowed special case. Anything else needs HTTPS.

## Two-factor auth

TOTP-based 2FA is built in. Users enable it from **Account Settings → Security**. The flow:

1. User scans a QR code with their authenticator app (Authy, 1Password, the built-in OS one, …).
2. Confirms with a 6-digit code.
3. Subsequent sign-ins prompt for the TOTP code after the password / OAuth step.

Backup codes are issued at enrolment — one-time-use, ten codes by default.

To enforce 2FA org-wide (admin policy), an admin can flip the "Require 2FA" toggle in **Admin → Auth settings**. Existing users without 2FA are required to set it up on next login.

## Disabling registration

By default after the first user lands, registration mode is `invite-only`. Three modes exist:

| Mode | Behaviour |
|---|---|
| `open` | Anyone with the URL can register. |
| `invite-only` | New users need an invite code minted from **Admin → Invites**. Default after first signup. |
| `closed` | No new sign-ups, period. Existing users keep working. |

Toggle from **Admin → Auth settings**. The setting persists in the database, not in env vars.

## Session cookies

Sessions live in HTTP-only, `Secure`, `SameSite=Lax` cookies. The cookie name is `kryton.session`. Lifetime defaults to 30 days, rotated on every sign-in.

In production (when `NODE_ENV=production`), the server emits `Secure` cookies regardless of CORS config — terminate TLS in front of Kryton or sessions won't stick. See [Reverse proxy and TLS](/kryton/advanced/security/reverse-proxy-and-tls/).

## See also

- [API keys and MCP](/kryton/advanced/security/api-keys-and-mcp/) — programmatic auth for agents and scripts.
- [Reverse proxy and TLS](/kryton/advanced/security/reverse-proxy-and-tls/) — required for cookies to flow.
- [Environment variables](/kryton/advanced/reference/env-vars/) — the full env-var reference.
