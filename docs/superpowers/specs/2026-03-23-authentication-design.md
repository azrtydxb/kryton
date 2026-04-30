# Authentication — Multi-User Sub-Project 1 of 3

**Date:** 2026-03-23
**Scope:** Add user authentication to Kryton — email/password + OAuth (Google, GitHub), JWT with refresh tokens, admin role, invite system. No changes to note storage or sharing yet (those are sub-projects 2 and 3).

## Goals

- Users can sign up and log in with email/password or OAuth (Google, GitHub)
- All API routes require authentication
- First user becomes admin
- Admin can manage users, create invite codes, toggle open/invite-only registration
- JWT access tokens (15min) + refresh tokens (30 days) in httpOnly cookies

## Non-Goals

- Per-user file isolation (sub-project 2)
- Note sharing between users (sub-project 3)
- Email verification or password reset (can be added later)
- Rate limiting or brute-force protection (can be added later)

---

## Database Schema

### User

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| email | TEXT | Unique, required |
| name | TEXT | Display name |
| passwordHash | TEXT | Nullable (null for OAuth-only users) |
| role | TEXT | `admin` or `user`, default `user` |
| avatarUrl | TEXT | Nullable |
| disabled | BOOLEAN | Default false |
| createdAt | TIMESTAMP | Auto-set |
| updatedAt | TIMESTAMP | Auto-set |

### AuthProvider

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| userId | UUID | FK → User, CASCADE delete |
| provider | TEXT | `google` or `github` |
| providerAccountId | TEXT | Provider's user ID |
| createdAt | TIMESTAMP | Auto-set |

Unique constraint on `(provider, providerAccountId)`.

### RefreshToken

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| userId | UUID | FK → User, CASCADE delete |
| tokenHash | TEXT | SHA-256 hash of the token (not bcrypt — high-entropy random tokens don't need slow hashing) |
| expiresAt | TIMESTAMP | 30 days from creation |
| createdAt | TIMESTAMP | Auto-set |

### InviteCode

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| code | TEXT | Unique, random string |
| createdBy | UUID | FK → User (admin who created it) |
| usedBy | UUID | FK → User, nullable (who used it) |
| expiresAt | TIMESTAMP | Nullable (null = no expiry) |
| createdAt | TIMESTAMP | Auto-set |

### Existing Settings table

Add row: `registration_mode` = `open` (default). Admin can toggle to `invite-only`.

---

## Auth Flows

### Email/Password Registration

1. `POST /api/auth/register` with `{ email, password, name, inviteCode? }`
2. If `registration_mode` is `invite-only`, require valid unused non-expired invite code
3. Validate email format, password length (min 8 chars, max 72 chars — bcrypt's limit)
4. Hash password with bcrypt (12 rounds)
5. Create User record. If this is the first user in the database, set `role: admin`
6. If invite code was used, mark it as `usedBy` this user
7. Generate JWT access token (15min expiry, payload: `{ sub: user.id, email, role }`)
8. Generate refresh token (random 64-byte hex string), hash with SHA-256, store in RefreshToken table with 30-day expiry
9. Set refresh token cookie as `tokenId:rawToken` (where `tokenId` is the RefreshToken row's UUID) in httpOnly secure cookie (`kryton_refresh`)
10. Return `{ user: { id, email, name, role, avatarUrl }, accessToken }`

### Email/Password Login

1. `POST /api/auth/login` with `{ email, password }`
2. Find user by email. If not found or `disabled`, return 401
3. If user has no `passwordHash` (OAuth-only), return 401 with message "Use OAuth to sign in"
4. Verify password with bcrypt. If wrong, return 401
5. Generate tokens same as registration steps 7-10

### OAuth Flow (Google)

1. `GET /api/auth/google` → redirect to Google OAuth consent screen
   - Scopes: `openid email profile`
   - Callback: `{APP_URL}/api/auth/google/callback`
2. `GET /api/auth/google/callback` → Google redirects back with auth code
3. Passport exchanges code for tokens, extracts profile (email, name, avatar, provider ID)
4. Look up AuthProvider where `provider=google` and `providerAccountId=googleId`
   - **Found:** Log in that user (if not disabled)
   - **Not found, email matches existing user:** Create AuthProvider record linking Google to that user, log in
   - **Completely new user:** If `registration_mode` is `invite-only`, redirect to `{APP_URL}/login?error=invite-required` (user must provide invite code on the frontend first, which is passed via the OAuth `state` parameter — see below). If `open`, create User + AuthProvider. First user → admin.

**OAuth with invite codes:** When registration is invite-only, the frontend collects the invite code before initiating OAuth. The code is passed as the `state` parameter in the OAuth redirect URL. In the callback, the server validates the invite code from `state` before creating the user. This avoids a second round-trip.
5. Generate tokens, set cookie, redirect to `{APP_URL}/?auth=success`

### OAuth Flow (GitHub)

Same as Google but:
- `GET /api/auth/github` → redirect to GitHub OAuth
- `GET /api/auth/github/callback`
- Scopes: `user:email`
- Note: GitHub may not return email in profile — need to fetch from `/user/emails` API

### Token Refresh

1. `POST /api/auth/refresh`
2. Read `kryton_refresh` cookie, parse as `tokenId:rawToken`
3. Look up RefreshToken by `tokenId` (single DB query). If not found or expired, return 401 and clear cookie
4. SHA-256 hash `rawToken` and compare to stored `tokenHash`. If mismatch, return 401 and clear cookie
5. If valid: generate new access token. Rotate refresh token (delete old row, create new one, set new cookie)
6. Return `{ accessToken, user: { id, email, name, role, avatarUrl } }`

### Logout

1. `POST /api/auth/logout`
2. Read `kryton_refresh` cookie, delete matching RefreshToken from DB
3. Clear the `kryton_refresh` cookie
4. Return 200

### Get Current User

1. `GET /api/auth/me`
2. Requires valid access token
3. Returns `{ id, email, name, role, avatarUrl }`

---

## Auth Middleware

New file: `packages/server/src/middleware/auth.ts`

```ts
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

Applied to all existing routes in `index.ts`:
```ts
// Before route registration
app.use('/api/notes', authMiddleware, createNotesRouter(NOTES_DIR));
app.use('/api/search', authMiddleware, createSearchRouter());
// ... etc for all /api/* routes except /api/auth/*, /api/health, /api/docs*
```

**Unauthenticated routes:** `/api/auth/*`, `/api/health`, `/api/docs`, `/api/docs.json`

Admin middleware (for `/api/admin/*`):
```ts
function adminMiddleware(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
  next();
}
```

---

## CORS & CSRF Protection

**CORS:** Replace `app.use(cors())` with explicit config:
```ts
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:5173',
  credentials: true,
}));
```
Client-side: all fetch calls must include `credentials: 'include'` to send cookies.

**CSRF:** Require `X-Requested-With: XMLHttpRequest` header on all state-changing endpoints (POST, PUT, DELETE). Browsers block custom headers in cross-origin simple requests, preventing CSRF attacks. The auth middleware checks this header. The client's `api.ts` fetch wrapper adds it to all requests.

---

## Token Revocation on User Disable/Role Change

When an admin disables a user or changes their role via `PUT /api/admin/users/:id`:
1. Delete all RefreshToken records for that user (immediate refresh token invalidation)
2. Accept that existing access tokens remain valid for up to 15 minutes (acceptable trade-off for simplicity)

This ensures disabled users are locked out within 15 minutes at most, and immediately cannot refresh.

---

## Settings Protection

The existing generic `/api/settings` endpoint allows any authenticated user to read/write arbitrary key-value pairs. The `registration_mode` key must be protected:

- Add a deny-list of admin-only keys in the generic settings PUT handler: `['registration_mode']`
- These keys can only be modified via `/api/admin/settings/registration`
- The generic GET endpoint can still read them (no sensitive data)

---

## Public Config Endpoint

`GET /api/auth/config` — unauthenticated, returns:
```json
{ "registrationMode": "open" | "invite-only" }
```

Used by the login page to know whether to show the invite code field and whether OAuth signup is available.

---

## Admin API

All endpoints require `authMiddleware` + `adminMiddleware`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/users` | List all users |
| PUT | `/api/admin/users/:id` | Update user (disabled, role) |
| DELETE | `/api/admin/users/:id` | Delete user and auth-related records (User, AuthProvider, RefreshToken). Note data cleanup deferred to sub-project 2 |
| POST | `/api/admin/invites` | Create invite code (optional expiresAt) |
| GET | `/api/admin/invites` | List all invite codes |
| DELETE | `/api/admin/invites/:id` | Revoke/delete invite |
| PUT | `/api/admin/settings/registration` | Set `{ mode: 'open' | 'invite-only' }` |
| GET | `/api/admin/settings/registration` | Get current registration mode |

---

## Frontend Changes

### New Components

**LoginPage.tsx** — shown when not authenticated:
- Email/password form (login + register tabs or toggle)
- "Sign in with Google" button
- "Sign in with GitHub" button
- Invite code field (shown when registration mode is invite-only — detected from a public endpoint `GET /api/auth/config` which returns `{ registrationMode }`)

**UserMenu.tsx** — replaces/extends the theme toggle area in the header:
- User avatar + name
- Dropdown: "Admin Panel" (if admin), "Logout"

**AdminPage.tsx** — accessible from user menu if admin:
- Users table (name, email, role, disabled, created) with toggle/delete actions
- Invite codes section (create, list, revoke)
- Registration mode toggle

### Auth Hook

**useAuth.ts** — React context + hook:
- Stores access token in memory (not localStorage — security)
- On app load: calls `POST /api/auth/refresh` to get access token from refresh cookie
- Exposes: `user`, `loading`, `login()`, `register()`, `loginWithGoogle()`, `loginWithGithub()`, `logout()`
- Auto-refreshes access token before expiry (set timer for 14 minutes)
- Wraps `fetch` to attach `Authorization: Bearer` header

### App.tsx Changes

- If `useAuth()` returns no user and not loading → show `LoginPage`
- If authenticated → show normal app
- Header: replace bare theme toggle area with `UserMenu` + theme toggle

---

## Server Dependencies

- `bcrypt` — password hashing only (refresh tokens use SHA-256 via built-in `crypto`)
- `jsonwebtoken` — JWT signing/verification
- `passport` — OAuth framework
- `passport-google-oauth20` — Google strategy
- `passport-github2` — GitHub strategy
- `cookie-parser` — parse httpOnly cookies
- `crypto` (built-in) — generate random refresh tokens

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| JWT_SECRET | Secret for signing JWTs | random 64-char string |
| GOOGLE_CLIENT_ID | Google OAuth client ID | from Google Cloud Console |
| GOOGLE_CLIENT_SECRET | Google OAuth client secret | from Google Cloud Console |
| GITHUB_CLIENT_ID | GitHub OAuth app client ID | from GitHub Developer Settings |
| GITHUB_CLIENT_SECRET | GitHub OAuth app secret | from GitHub Developer Settings |
| APP_URL | Base URL for OAuth callbacks | `http://localhost:5173` |

---

## Files Created

- `packages/server/src/entities/User.ts`
- `packages/server/src/entities/AuthProvider.ts`
- `packages/server/src/entities/RefreshToken.ts`
- `packages/server/src/entities/InviteCode.ts`
- `packages/server/src/middleware/auth.ts`
- `packages/server/src/routes/auth.ts`
- `packages/server/src/routes/admin.ts`
- `packages/client/src/pages/LoginPage.tsx`
- `packages/client/src/pages/AdminPage.tsx`
- `packages/client/src/components/Layout/UserMenu.tsx`
- `packages/client/src/hooks/useAuth.ts`

## Files Modified

- `packages/server/src/index.ts` — add auth middleware to all routes, mount auth/admin routes, add cookie-parser
- `packages/server/src/data-source.ts` — register new entities
- `packages/server/package.json` — add new dependencies
- `packages/client/src/App.tsx` — wrap with auth context, show login page when unauthenticated, add user menu to header
- `packages/client/src/lib/api.ts` — add auth header to all requests

## Files NOT Modified

- Note storage, graph, search, editor, preview — all unchanged
- Existing TypeORM entities (SearchIndex, GraphEdge, Settings) — unchanged
