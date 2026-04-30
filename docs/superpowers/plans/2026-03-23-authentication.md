# Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-user authentication to Kryton — email/password + OAuth (Google, GitHub), JWT with refresh tokens, admin role with invite system, and protected API routes.

**Architecture:** Four new TypeORM entities (User, AuthProvider, RefreshToken, InviteCode), auth middleware protecting all existing routes, OAuth handled via direct strategy callbacks (not `passport.authenticate()` middleware — Express 5 compatibility), JWT access tokens + SHA-256 hashed refresh tokens in httpOnly cookies, React auth context wrapping the app with login/admin pages.

**Tech Stack:** bcrypt, jsonwebtoken, passport-google-oauth20, passport-github2, cookie-parser, React context

**Important notes:**
- The Vite dev server already proxies `/api` → `localhost:3001` (see `packages/client/vite.config.ts`), so OAuth callbacks via `/api/auth/google/callback` work through the proxy in development.
- Express 5 has breaking changes with `passport.initialize()` middleware. We use Passport strategy classes directly (calling `strategy._verify` / `strategy.userProfile`) instead of `passport.authenticate()` middleware. This avoids Express 5 incompatibility.
- CSRF check (`X-Requested-With` header) is applied to protected routes only, NOT to `/api/auth/*` routes (which handle their own security via cookies/tokens).
- `synchronize: true` in TypeORM auto-creates new tables in development. Production migration should be addressed separately.

**Spec:** `docs/superpowers/specs/2026-03-23-authentication-design.md`

**Working directory:** All paths relative to `/Users/pascal/Development/kryton`.

---

## Task 1: Install server dependencies and create entities

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/server/src/entities/User.ts`
- Create: `packages/server/src/entities/AuthProvider.ts`
- Create: `packages/server/src/entities/RefreshToken.ts`
- Create: `packages/server/src/entities/InviteCode.ts`
- Modify: `packages/server/src/data-source.ts`

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/pascal/Development/kryton/packages/server
npm install bcrypt jsonwebtoken cookie-parser
npm install -D @types/bcrypt @types/jsonwebtoken @types/cookie-parser
```

- [ ] **Step 2: Create User entity**

Create `packages/server/src/entities/User.ts`:
```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("text", { unique: true })
  email: string;

  @Column("text")
  name: string;

  @Column("text", { nullable: true })
  passwordHash: string | null;

  @Column("text", { default: "user" })
  role: string;

  @Column("text", { nullable: true })
  avatarUrl: string | null;

  @Column("boolean", { default: false })
  disabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 3: Create AuthProvider entity**

Create `packages/server/src/entities/AuthProvider.ts`:
```ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, Unique } from "typeorm";
import { User } from "./User";

@Entity()
@Unique(["provider", "providerAccountId"])
export class AuthProvider {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  user: User;

  @Column("text")
  userId: string;

  @Column("text")
  provider: string;

  @Column("text")
  providerAccountId: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 4: Create RefreshToken entity**

Create `packages/server/src/entities/RefreshToken.ts`:
```ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from "typeorm";
import { User } from "./User";

@Entity()
export class RefreshToken {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  user: User;

  @Column("text")
  userId: string;

  @Column("text")
  tokenHash: string;

  @Column("timestamp")
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 5: Create InviteCode entity**

Create `packages/server/src/entities/InviteCode.ts`:
```ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from "typeorm";
import { User } from "./User";

@Entity()
export class InviteCode {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("text", { unique: true })
  code: string;

  @ManyToOne(() => User)
  createdByUser: User;

  @Column("text")
  createdBy: string;

  @Column("text", { nullable: true })
  usedBy: string | null;

  @Column("timestamp", { nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 6: Register entities in data-source.ts**

In `packages/server/src/data-source.ts`, add imports and register:
```ts
import { User } from "./entities/User";
import { AuthProvider } from "./entities/AuthProvider";
import { RefreshToken } from "./entities/RefreshToken";
import { InviteCode } from "./entities/InviteCode";
```
Add them to the `entities` array: `entities: [GraphEdge, SearchIndex, Settings, User, AuthProvider, RefreshToken, InviteCode]`

- [ ] **Step 7: Verify build**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add auth entities (User, AuthProvider, RefreshToken, InviteCode)"
```

---

## Task 2: Auth middleware and token utilities

**Files:**
- Create: `packages/server/src/middleware/auth.ts`
- Create: `packages/server/src/services/tokenService.ts`

- [ ] **Step 1: Create token service**

Create `packages/server/src/services/tokenService.ts` — handles JWT and refresh token operations:

```ts
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { AppDataSource } from "../data-source";
import { RefreshToken } from "../entities/RefreshToken";
import { User } from "../entities/User";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_DAYS = 30;

export function generateAccessToken(user: User): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

export function verifyAccessToken(token: string): { sub: string; email: string; role: string } {
  return jwt.verify(token, JWT_SECRET) as { sub: string; email: string; role: string };
}

export async function createRefreshToken(userId: string): Promise<{ cookieValue: string }> {
  const raw = crypto.randomBytes(64).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  const repo = AppDataSource.getRepository(RefreshToken);
  const token = repo.create({ userId, tokenHash: hash, expiresAt });
  const saved = await repo.save(token);

  return { cookieValue: `${saved.id}:${raw}` };
}

export async function validateRefreshToken(cookieValue: string): Promise<User | null> {
  const parts = cookieValue.split(":");
  if (parts.length !== 2) return null;
  const [tokenId, rawToken] = parts;

  const repo = AppDataSource.getRepository(RefreshToken);
  const record = await repo.findOne({ where: { id: tokenId } });
  if (!record || record.expiresAt < new Date()) {
    if (record) await repo.delete(record.id);
    return null;
  }

  const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
  if (hash !== record.tokenHash) return null;

  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOneBy({ id: record.userId });
  if (!user || user.disabled) return null;

  // Rotate: delete old token (caller creates new one)
  await repo.delete(record.id);

  return user;
}

export async function deleteRefreshToken(cookieValue: string): Promise<void> {
  const parts = cookieValue.split(":");
  if (parts.length !== 2) return;
  const [tokenId] = parts;
  const repo = AppDataSource.getRepository(RefreshToken);
  await repo.delete(tokenId).catch(() => {});
}

export async function deleteAllUserRefreshTokens(userId: string): Promise<void> {
  const repo = AppDataSource.getRepository(RefreshToken);
  await repo.delete({ userId });
}

export const REFRESH_COOKIE_NAME = "kryton_refresh";
export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
  path: "/",
};
```

- [ ] **Step 2: Create auth middleware**

Create `packages/server/src/middleware/auth.ts`:

```ts
import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../services/tokenService";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const token = header.slice(7);
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export function csrfCheck(req: Request, res: Response, next: NextFunction): void {
  if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
    if (req.headers["x-requested-with"] !== "XMLHttpRequest") {
      res.status(403).json({ error: "Missing CSRF header" });
      return;
    }
  }
  next();
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add auth middleware and token service"
```

---

## Task 3: Auth routes (register, login, refresh, logout, config, me)

**Files:**
- Create: `packages/server/src/routes/auth.ts`

- [ ] **Step 1: Create auth routes**

Create `packages/server/src/routes/auth.ts` with all email/password auth endpoints:

The file should export `createAuthRouter()` returning an Express Router with:

- `GET /config` — public, returns `{ registrationMode }` from Settings table
- `POST /register` — validates email/password/inviteCode, creates User (first user = admin), returns tokens
- `POST /login` — validates email/password, returns tokens
- `POST /refresh` — reads cookie, validates refresh token, rotates, returns new access token
- `POST /logout` — deletes refresh token, clears cookie
- `GET /me` — requires auth, returns current user profile

Key implementation details:
- Use bcrypt (12 rounds) for password hashing
- Use `tokenService` for JWT and refresh token operations
- Check `registration_mode` from Settings for invite-only enforcement
- CSRF check on POST endpoints (except `/refresh` which uses httpOnly cookie, not body)
- Set `REFRESH_COOKIE_NAME` cookie with `REFRESH_COOKIE_OPTIONS` on login/register/refresh

- [ ] **Step 2: Verify build**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add auth routes (register, login, refresh, logout, config, me)"
```

---

## Task 4: OAuth routes (Google + GitHub — direct implementation, no Passport middleware)

**Files:**
- Create: `packages/server/src/services/oauthService.ts`
- Modify: `packages/server/src/routes/auth.ts`

**Important:** We do NOT use `passport.authenticate()` middleware or `passport.initialize()` — these have Express 5 compatibility issues. Instead, we implement OAuth flows directly using `fetch` to exchange authorization codes for tokens and fetch profiles from Google/GitHub APIs.

- [ ] **Step 1: Create OAuth service**

Create `packages/server/src/services/oauthService.ts` — handles OAuth token exchange and user resolution:

```ts
import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import { AuthProvider } from "../entities/AuthProvider";
import { Settings } from "../entities/Settings";
import { InviteCode } from "../entities/InviteCode";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const APP_URL = process.env.APP_URL || "http://localhost:5173";

// Google: build authorization URL
export function getGoogleAuthUrl(state?: string): string { /* ... */ }

// Google: exchange code for profile { email, name, avatarUrl, providerAccountId }
export async function exchangeGoogleCode(code: string): Promise<OAuthProfile> { /* ... */ }

// GitHub: build authorization URL
export function getGitHubAuthUrl(state?: string): string { /* ... */ }

// GitHub: exchange code for profile (fetch /user + /user/emails if needed)
export async function exchangeGitHubCode(code: string): Promise<OAuthProfile> { /* ... */ }

// Shared: resolve OAuth profile to a User (find existing, link, or create new)
export async function resolveOAuthUser(
  provider: string,
  profile: OAuthProfile,
  inviteCode: string | null,
): Promise<User> {
  // 1. Look up AuthProvider by (provider, providerAccountId)
  // 2. Found → return user (check not disabled)
  // 3. Not found, email matches existing user → link, return
  // 4. New user → check registration_mode, validate invite code, create User+AuthProvider
  // 5. First user → role: admin
}
```

This avoids all Passport middleware. Uses standard `fetch()` for Google/GitHub API calls.

- [ ] **Step 2: Add OAuth routes to auth.ts**

Add to the existing auth router:
- `GET /google` — redirects to Google OAuth consent URL (passes `inviteCode` from query in `state` param)
- `GET /google/callback` — exchanges `code` query param via `exchangeGoogleCode()`, resolves user via `resolveOAuthUser()`, generates tokens, sets cookie, redirects to `{APP_URL}/?auth=success`
- `GET /github` — redirects to GitHub OAuth
- `GET /github/callback` — same flow as Google but using GitHub functions

Error handling: if OAuth fails or invite required, redirect to `{APP_URL}/login?error=...`

- [ ] **Step 3: Verify build**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add OAuth routes for Google and GitHub (direct, no Passport)"
```

---

## Task 5: Admin routes

**Files:**
- Create: `packages/server/src/routes/admin.ts`

- [ ] **Step 1: Create admin routes**

Create `packages/server/src/routes/admin.ts` — export `createAdminRouter()` returning Router with:

- `GET /users` — list all users (id, email, name, role, disabled, createdAt)
- `PUT /users/:id` — update user (disabled, role). When disabling or changing role, delete all RefreshTokens for that user
- `DELETE /users/:id` — delete user (cascades to AuthProvider, RefreshToken). Cannot delete self
- `POST /invites` — create invite code with optional expiresAt
- `GET /invites` — list all invite codes with status
- `DELETE /invites/:id` — delete/revoke invite code
- `GET /settings/registration` — get registration mode
- `PUT /settings/registration` — set registration mode (`open` or `invite-only`)

All routes require auth + admin middleware (applied when mounting in index.ts).

- [ ] **Step 2: Verify build**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add admin routes (users, invites, registration settings)"
```

---

## Task 6: Wire up auth in index.ts and protect existing routes

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/routes/settings.ts`

- [ ] **Step 1: Update index.ts**

In `packages/server/src/index.ts`:

1. Add imports:
```ts
import cookieParser from "cookie-parser";
import { authMiddleware, adminMiddleware, csrfCheck } from "./middleware/auth";
import { createAuthRouter } from "./routes/auth";
import { createAdminRouter } from "./routes/admin";
```

2. Replace `app.use(cors())` with:
```ts
app.use(cors({
  origin: process.env.APP_URL || "http://localhost:5173",
  credentials: true,
}));
```

3. After `app.use(express.json())`, add:
```ts
app.use(cookieParser());
```

4. Mount auth routes FIRST (unauthenticated, NO csrfCheck — auth routes handle their own security):
```ts
app.use("/api/auth", createAuthRouter());
```

5. Apply CSRF check to all REMAINING routes (not auth):
```ts
app.use(csrfCheck);
```

6. Mount admin routes (auth + admin required):
```ts
app.use("/api/admin", authMiddleware, adminMiddleware, createAdminRouter());
```

7. Add `authMiddleware` to all existing routes INCLUDING `/api/files`:
```ts
app.use("/api/notes", authMiddleware, createNotesRouter(NOTES_DIR));
app.use("/api/notes-rename", authMiddleware, createNotesRenameRouter(NOTES_DIR));
app.use("/api/folders", authMiddleware, createFoldersRouter(NOTES_DIR));
app.use("/api/folders-rename", authMiddleware, createFoldersRenameRouter(NOTES_DIR));
app.use("/api/search", authMiddleware, createSearchRouter());
app.use("/api/graph", authMiddleware, createGraphRouter());
app.use("/api/settings", authMiddleware, createSettingsRouter());
app.use("/api/backlinks", authMiddleware, createBacklinksRouter());
app.use("/api/tags", authMiddleware, createTagsRouter());
app.use("/api/daily", authMiddleware, createDailyRouter(NOTES_DIR));
app.use("/api/templates", authMiddleware, createTemplatesRouter(NOTES_DIR));
app.use("/api/canvas", authMiddleware, createCanvasRouter(NOTES_DIR));
// Also protect the inline files route with authMiddleware
```

8. Keep `/api/health` and `/api/docs` unauthenticated (mounted BEFORE csrfCheck, or no authMiddleware).

**Middleware order:** `cors → json → cookieParser → auth routes (no csrf) → csrfCheck → all protected routes`

- [ ] **Step 2: Protect registration_mode in settings route**

In `packages/server/src/routes/settings.ts`, add a deny-list in the PUT handler:
```ts
const ADMIN_ONLY_KEYS = ["registration_mode"];
if (ADMIN_ONLY_KEYS.includes(key)) {
  res.status(403).json({ error: "This setting can only be changed by admin" });
  return;
}
```

- [ ] **Step 3: Add swagger annotations to new routes**

Add `@swagger` JSDoc comments to `auth.ts` and `admin.ts` for all endpoints.

- [ ] **Step 4: Verify build**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run lint
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire auth middleware into all routes, protect settings, add CORS"
```

---

## Task 7: Client auth hook and API updates

**Files:**
- Create: `packages/client/src/hooks/useAuth.ts`
- Modify: `packages/client/src/lib/api.ts`

- [ ] **Step 1: Create auth hook**

Create `packages/client/src/hooks/useAuth.ts` — React context + provider + hook:

```tsx
// AuthProvider wraps the app
// useAuth() returns { user, loading, login, register, loginWithGoogle, loginWithGithub, logout, accessToken }

// On mount: POST /api/auth/refresh (with credentials: include) to get access token from refresh cookie
// If success: set user + accessToken in state
// If 401: user is not logged in

// login(email, password): POST /api/auth/login
// register(email, password, name, inviteCode?): POST /api/auth/register
// loginWithGoogle(inviteCode?): redirect to /api/auth/google?inviteCode=...
// loginWithGithub(inviteCode?): redirect to /api/auth/github?inviteCode=...
// logout(): POST /api/auth/logout, clear state

// Auto-refresh timer: 14 minutes after last refresh, call refresh again
// accessToken stored in memory only (not localStorage)
```

- [ ] **Step 2: Update api.ts**

In `packages/client/src/lib/api.ts`:
- The `request` function needs to accept an access token and attach `Authorization: Bearer` + `X-Requested-With: XMLHttpRequest` headers
- Add `credentials: 'include'` to all fetch calls
- Export auth-specific API methods: `authLogin`, `authRegister`, `authRefresh`, `authLogout`, `authMe`, `authConfig`

**Concrete approach:** Add a module-level token variable and setter in `api.ts`:
```ts
let _accessToken: string | null = null;
export function setAccessToken(token: string | null) { _accessToken = token; }
```
Then modify the existing `request()` function to:
- Add `credentials: 'include'` to all fetch calls (for cookies)
- Add `'X-Requested-With': 'XMLHttpRequest'` header to all requests (CSRF)
- Add `'Authorization': 'Bearer ' + _accessToken` header when `_accessToken` is set

Also add auth-specific API methods:
```ts
export const authApi = {
  config: () => fetch('/api/auth/config').then(r => r.json()),
  login: (email: string, password: string) => request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (data: RegisterData) => request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  refresh: () => fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then(r => r.ok ? r.json() : null),
  logout: () => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }),
  me: () => request<UserData>('/auth/me'),
};
```

The `useAuth` hook calls `setAccessToken()` when tokens are obtained/refreshed, and `setAccessToken(null)` on logout.

- [ ] **Step 3: Verify build**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add useAuth hook and update API client with auth headers"
```

---

## Task 8: Login page

**Files:**
- Create: `packages/client/src/pages/LoginPage.tsx`

- [ ] **Step 1: Create LoginPage**

Create `packages/client/src/pages/LoginPage.tsx`:

- Two tabs: "Sign In" and "Register"
- **Sign In tab:** email + password fields, submit button, "Sign in with Google" button, "Sign in with GitHub" button
- **Register tab:** name + email + password fields, invite code field (shown if registration mode is invite-only — fetched from `GET /api/auth/config`), submit button, OAuth buttons
- Uses `useAuth()` hook for login/register actions
- Shows error messages on failure
- Uses the Kryton logo at top
- Dark themed, consistent with app styling
- On `?auth=success` URL param (after OAuth redirect): trigger refresh to get tokens

- [ ] **Step 2: Verify build**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add login/register page with OAuth buttons"
```

---

## Task 9: User menu and App.tsx integration

**Files:**
- Create: `packages/client/src/components/Layout/UserMenu.tsx`
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Create UserMenu**

Create `packages/client/src/components/Layout/UserMenu.tsx`:

- Shows user avatar (or first letter fallback) + name
- Dropdown (portaled to body like ThemeToggle) with:
  - "Admin Panel" link (if `user.role === 'admin'`)
  - "Logout" button
- Uses `useAuth()` hook for user info and logout

- [ ] **Step 2: Update App.tsx**

In `packages/client/src/App.tsx`:
- Wrap the entire app return in `<AuthProvider>` from useAuth
- Before the main layout, check auth state:
  - If `loading`: show a spinner/loading screen
  - If `!user`: show `<LoginPage />`
  - If `user`: show normal app
- In the header, add `<UserMenu />` next to the API link and ThemeToggle
- Handle `?auth=success` query param for OAuth redirect (trigger refresh)

- [ ] **Step 3: Verify build**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run lint
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add UserMenu and integrate auth into App.tsx"
```

---

## Task 10: Admin page

**Files:**
- Create: `packages/client/src/pages/AdminPage.tsx`
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Create AdminPage**

Create `packages/client/src/pages/AdminPage.tsx`:

- Accessible when admin clicks "Admin Panel" from UserMenu
- **Users section:** table showing all users (name, email, role, disabled, joined date). Actions: toggle disabled, change role, delete user. Cannot modify self.
- **Invites section:** list of invite codes with status (unused/used/expired). Create new invite button. Delete/revoke button.
- **Settings section:** registration mode toggle (open / invite-only)
- Uses auth-aware fetch to call `/api/admin/*` endpoints

- [ ] **Step 2: Add admin route to App.tsx**

Add a state `showAdmin` and conditionally render `<AdminPage />` as a modal/overlay when true. The UserMenu's "Admin Panel" button sets this state.

- [ ] **Step 3: Verify full pipeline**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run lint
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add admin page with user management, invites, and settings"
```

---

## Task 11: Final verification and push

- [ ] **Step 1: Ensure .env is gitignored and create .env.example**

Verify `.env` is already in `.gitignore` (it is — line 3). Then create the example file:

Create `/Users/pascal/Development/kryton/.env.example`:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kryton
JWT_SECRET=change-me-to-a-random-64-char-string
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
APP_URL=http://localhost:5173
```

- [ ] **Step 2: Full build and lint**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run lint
npm run build
```

Fix any errors.

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "feat: authentication complete - email/password + OAuth + admin"
git push
```

- [ ] **Step 4: Verify CI**

```bash
gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```
