# Passkeys + Auth & ORM Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Kryton from TypeORM to Prisma, replace hand-rolled JWT auth with better-auth (adding passkey support), and convert the server from CommonJS to ESM — all in one unified migration.

**Architecture:** Prisma replaces TypeORM as the ORM (13 entities → Prisma schema). better-auth replaces custom auth routes, JWT tokens, and OAuth flows with session-based auth, adding passkey/WebAuthn support. The server module system changes from CommonJS to ESM (required by better-auth). The client auth hook and API client are simplified from manual token management to cookie-based sessions.

**Tech Stack:** Prisma, better-auth, @simplewebauthn (via better-auth passkey plugin), PostgreSQL, Express 5, React 19, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-24-passkeys-auth-migration-design.md`

---

## File Structure

### Deleted Files

```
packages/server/src/
  data-source.ts                      # Replaced by prisma.ts
  entities/                           # All 12 entity files — replaced by prisma/schema.prisma
    AccessRequest.ts
    AuthProvider.ts
    GraphEdge.ts
    InstalledPlugin.ts
    InviteCode.ts
    NoteShare.ts
    PasswordResetToken.ts
    PluginStorage.ts
    RefreshToken.ts
    SearchIndex.ts
    Settings.ts
    User.ts
  services/
    tokenService.ts                   # Replaced by better-auth sessions
    oauthService.ts                   # Replaced by better-auth social providers
  routes/
    auth.ts                           # Replaced by better-auth handler
```

### New Files

```
prisma/
  schema.prisma                       # All models (better-auth + domain)

packages/server/src/
  prisma.ts                           # Prisma Client singleton
  auth.ts                             # better-auth configuration
  middleware/
    auth.ts                           # Rewritten: session-based (replaces JWT-based)

packages/client/src/
  lib/auth-client.ts                  # better-auth React client
  components/Security/
    PasskeyManager.tsx                # Passkey registration/management UI

scripts/
  migrate-auth-data.ts               # One-time data migration script
```

### Modified Files (every file touching DB or auth)

```
packages/server/
  package.json                        # Add prisma, better-auth; remove typeorm, jsonwebtoken, bcrypt
  tsconfig.json                       # CommonJS → ESM, remove decorators

packages/server/src/
  index.ts                            # ESM, Prisma init, better-auth handler, remove AppDataSource
  swagger.ts                          # __dirname → import.meta.dirname
  routes/
    admin.ts                          # TypeORM → Prisma queries
    daily.ts                          # TypeORM → Prisma queries
    notes.ts                          # TypeORM → Prisma queries
    plugins.ts                        # TypeORM → Prisma queries
    settings.ts                       # TypeORM → Prisma queries
    shares.ts                         # TypeORM → Prisma queries
    users.ts                          # TypeORM → Prisma queries
  services/
    graphService.ts                   # TypeORM → Prisma queries
    noteService.ts                    # TypeORM → Prisma queries (if applicable)
    searchService.ts                  # TypeORM → Prisma queries
    shareService.ts                   # TypeORM → Prisma queries
    pluginStorageService.ts           # TypeORM → Prisma queries
  plugins/
    PluginApiFactory.ts               # TypeORM → Prisma, remove database.registerEntity
    PluginManager.ts                  # require() → createRequire(), TypeORM → Prisma
    types.ts                          # Remove EntitySchema/Repository types

packages/client/src/
  hooks/useAuth.tsx                   # Rewrite: better-auth client
  lib/api.ts                          # Remove token management
  App.tsx                             # AuthProvider changes
  pages/LoginPage.tsx                 # better-auth sign-in + passkey button
  pages/AdminPage.tsx                 # Prisma-based admin queries
  components/Layout/UserMenu.tsx      # Passkey settings link
```

---

## Task 1: ESM Migration

**Files:**
- Modify: `packages/server/tsconfig.json`
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/index.ts` (`__dirname` → `import.meta.dirname`)
- Modify: `packages/server/src/swagger.ts` (`__dirname` → `import.meta.dirname`)
- Modify: `packages/server/src/plugins/PluginManager.ts` (`require()` → `createRequire()`)

- [ ] **Step 1: Update server tsconfig.json**

Change `"module": "commonjs"` to `"module": "ESNext"`, add `"moduleResolution": "bundler"`, remove `"experimentalDecorators"` and `"emitDecoratorMetadata"`.

- [ ] **Step 2: Update server package.json**

Add `"type": "module"` to the top level.

- [ ] **Step 3: Fix __dirname usage in index.ts**

Replace `__dirname` with `import.meta.dirname` (Node 24+ supports this).

- [ ] **Step 4: Fix __dirname usage in swagger.ts**

Replace all `__dirname` references with `import.meta.dirname`.

- [ ] **Step 5: Fix require() in PluginManager.ts**

Add `import { createRequire } from "module";` at top. Replace `require(serverEntry)` with `createRequire(import.meta.url)(serverEntry)`. Keep `delete require.cache` pattern using the created `require` instance.

- [ ] **Step 6: Verify build**

Run: `cd packages/server && npx tsx src/index.ts`
Expected: Server starts without module errors. Kill it after verification.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: convert server from CommonJS to ESM"
```

---

## Task 2: Add Prisma Schema & Client

**Files:**
- Create: `prisma/schema.prisma`
- Create: `packages/server/src/prisma.ts`
- Modify: `packages/server/package.json` (add prisma deps)

- [ ] **Step 1: Install Prisma**

```bash
npm install @prisma/client --workspace=packages/server
npm install -D prisma --workspace=packages/server
```

- [ ] **Step 2: Create Prisma schema**

Create `prisma/schema.prisma` with all models from the spec — both better-auth tables (user, session, account, verification, passkey) and domain tables (settings, searchIndex, graphEdge, noteShare, accessRequest, inviteCode, pluginStorage, installedPlugin). Use the exact schema from the design spec Section 2.

- [ ] **Step 3: Create Prisma Client singleton**

Create `packages/server/src/prisma.ts`:
```typescript
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
```

- [ ] **Step 4: Generate Prisma Client and create migration**

```bash
cd packages/server && npx prisma generate
npx prisma migrate dev --name init
```

Note: This will create new tables alongside existing TypeORM tables. The TypeORM tables will be dropped after data migration.

- [ ] **Step 5: Verify Prisma connects**

Add a quick test in index.ts: `await prisma.$connect(); console.log("Prisma connected");`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add Prisma schema and client alongside TypeORM"
```

---

## Task 3: Replace TypeORM with Prisma in Domain Services

**Files:**
- Modify: `packages/server/src/services/searchService.ts`
- Modify: `packages/server/src/services/graphService.ts`
- Modify: `packages/server/src/services/shareService.ts`
- Modify: `packages/server/src/services/noteService.ts`
- Modify: `packages/server/src/services/pluginStorageService.ts`

For each service file:
- Replace `import { AppDataSource } from "../data-source"` with `import { prisma } from "../prisma"`
- Replace `AppDataSource.getRepository(Entity).findOneBy(...)` with `prisma.entity.findUnique({ where: ... })`
- Replace `AppDataSource.getRepository(Entity).find(...)` with `prisma.entity.findMany({ where: ... })`
- Replace `repo.save(obj)` with `prisma.entity.create({ data: ... })` or `prisma.entity.upsert(...)`
- Replace `repo.delete(criteria)` with `prisma.entity.delete({ where: ... })`
- Replace `repo.createQueryBuilder()` chains with Prisma fluent API
- Remove all entity class imports

- [ ] **Step 1: Convert searchService.ts**
- [ ] **Step 2: Convert graphService.ts**
- [ ] **Step 3: Convert shareService.ts**
- [ ] **Step 4: Convert noteService.ts** (if it uses TypeORM)
- [ ] **Step 5: Convert pluginStorageService.ts**
- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit --project packages/server/tsconfig.json`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: replace TypeORM with Prisma in all domain services"
```

---

## Task 4: Replace TypeORM with Prisma in Routes

**Files:**
- Modify: `packages/server/src/routes/admin.ts`
- Modify: `packages/server/src/routes/daily.ts`
- Modify: `packages/server/src/routes/notes.ts`
- Modify: `packages/server/src/routes/plugins.ts`
- Modify: `packages/server/src/routes/settings.ts`
- Modify: `packages/server/src/routes/shares.ts`
- Modify: `packages/server/src/routes/users.ts`

Same conversion pattern as Task 3 for each route file.

**Special attention:**
- `admin.ts` has heavy User entity usage — queries become `prisma.user.findMany()`, `prisma.user.delete()`, etc.
- `shares.ts` has complex joins — convert to Prisma `include` or nested selects
- `settings.ts` uses composite key (key + userId) — use Prisma's `@@id` compound key

- [ ] **Step 1: Convert settings.ts** (simplest, good warm-up)
- [ ] **Step 2: Convert daily.ts**
- [ ] **Step 3: Convert notes.ts**
- [ ] **Step 4: Convert users.ts**
- [ ] **Step 5: Convert shares.ts** (complex joins)
- [ ] **Step 6: Convert admin.ts** (heavy User usage)
- [ ] **Step 7: Convert plugins.ts**
- [ ] **Step 8: Verify types compile**

Run: `npx tsc --noEmit --project packages/server/tsconfig.json`

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "refactor: replace TypeORM with Prisma in all route handlers"
```

---

## Task 5: Replace TypeORM in Plugin System

**Files:**
- Modify: `packages/server/src/plugins/PluginApiFactory.ts`
- Modify: `packages/server/src/plugins/PluginManager.ts`
- Modify: `packages/server/src/plugins/types.ts`

- [ ] **Step 1: Update types.ts**

Remove `EntitySchema` and `Repository` imports from TypeORM. Remove `database.registerEntity()` and `database.getRepository()` from the `PluginAPI` interface. These methods are no longer supported — plugins use `api.storage` instead.

- [ ] **Step 2: Update PluginApiFactory.ts**

Replace all TypeORM repository usage with Prisma:
- `api.settings.get()` → use `prisma.settings.findUnique()`
- `api.search.index()` → use `prisma.searchIndex.upsert()`
- `api.search.query()` → use `prisma.searchIndex.findMany()`
- `api.storage` → use `prisma.pluginStorage` methods
- Remove `api.database` implementation entirely

- [ ] **Step 3: Update PluginManager.ts**

Replace `AppDataSource.getRepository(InstalledPlugin)` with `prisma.installedPlugin` for state persistence.

- [ ] **Step 4: Verify types compile and tests pass**

```bash
npx tsc --noEmit --project packages/server/tsconfig.json
npm run test:server
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: replace TypeORM with Prisma in plugin system"
```

---

## Task 6: Remove TypeORM & Delete Old Entities

**Files:**
- Delete: `packages/server/src/data-source.ts`
- Delete: all files in `packages/server/src/entities/`
- Modify: `packages/server/src/index.ts` (remove AppDataSource.initialize, use Prisma)
- Modify: `packages/server/package.json` (remove typeorm, reflect-metadata)

- [ ] **Step 1: Update index.ts**

Remove `import { AppDataSource } from "./data-source"` and `AppDataSource.initialize()`. Replace with `import { prisma } from "./prisma"` and `await prisma.$connect()`.

- [ ] **Step 2: Delete data-source.ts**
- [ ] **Step 3: Delete all entity files**
- [ ] **Step 4: Remove TypeORM dependencies**

```bash
npm uninstall typeorm reflect-metadata --workspace=packages/server
```

- [ ] **Step 5: Verify build, lint, tests**

```bash
npm run build && npm run lint && npm run typecheck && npm run test:server
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: remove TypeORM, all entities now in Prisma schema"
```

---

## Task 7: Integrate better-auth (Server)

**Files:**
- Create: `packages/server/src/auth.ts` (better-auth config)
- Rewrite: `packages/server/src/middleware/auth.ts`
- Delete: `packages/server/src/routes/auth.ts`
- Delete: `packages/server/src/services/tokenService.ts`
- Delete: `packages/server/src/services/oauthService.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/package.json`

- [ ] **Step 1: Install better-auth**

```bash
npm install better-auth --workspace=packages/server
npm uninstall jsonwebtoken bcrypt --workspace=packages/server
npm uninstall -D @types/jsonwebtoken @types/bcrypt --workspace=packages/server
```

- [ ] **Step 2: Create better-auth configuration**

Create `packages/server/src/auth.ts`:
```typescript
import { betterAuth } from "better-auth";
import { passkey } from "better-auth/plugins/passkey";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  basePath: "/api/auth",
  emailAndPassword: { enabled: true },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    },
  },
  emailAndPassword: {
    enabled: true,
    async onBeforeCreateUser({ email, name }, request) {
      // First user becomes admin
      const userCount = await prisma.user.count();
      // Invite code validation
      const registrationMode = await prisma.settings.findUnique({
        where: { key_userId: { key: "registration_mode", userId: "" } },
      });
      if (registrationMode?.value === "invite") {
        // Extract invite code from request body and validate
        // Validate code exists, not expired, not used
      }
    },
  },
  plugins: [
    passkey({
      rpName: "Kryton",
      rpID: process.env.WEBAUTHN_RP_ID || "localhost",
      origin: process.env.APP_URL || "http://localhost:5173",
    }),
  ],
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user", input: false },
      disabled: { type: "boolean", defaultValue: false, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 300 },
  },
});
```

- [ ] **Step 3: Rewrite auth middleware**

Rewrite `packages/server/src/middleware/auth.ts`:
```typescript
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";

export async function authMiddleware(req, res, next) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }
  if (session.user.disabled) {
    return res.status(403).json({ error: "Account is disabled" });
  }
  req.user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role || "user",
  };
  next();
}

export function adminMiddleware(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
```

- [ ] **Step 4: Wire better-auth into Express**

In `index.ts`:
```typescript
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";

// Mount better-auth handler (replaces routes/auth.ts)
app.all("/api/auth/*splat", toNodeHandler(auth));
```

Remove the old auth route mounting and CSRF middleware (better-auth handles CSRF).

- [ ] **Step 5: Delete old auth files**

Delete `routes/auth.ts`, `services/tokenService.ts`, `services/oauthService.ts`.

**Note on migrated features:**
- **Forgot password**: better-auth handles password reset via its built-in `forgetPassword` config. Enable it in the auth config with SMTP settings from env vars.
- **Invite codes**: Handled by the `onBeforeCreateUser` hook (see Step 2).
- **Admin role**: The `user.additionalFields.role` field in better-auth config handles this. First-user-is-admin logic goes in the registration hook.

- [ ] **Step 6: Update admin.ts for user management**

Admin routes that manage users (list, disable, delete, reset password) now query `prisma.user` directly. Password reset goes through better-auth's API if available, or directly updates the account table.

- [ ] **Step 7: Verify server starts and auth endpoints respond**

```bash
npx tsx src/index.ts
# In another terminal:
curl http://localhost:3001/api/auth/ok
# Expected: {"ok": true} or similar health check
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: replace hand-rolled auth with better-auth + passkeys"
```

---

## Task 8: Client Auth Migration

**Files:**
- Create: `packages/client/src/lib/auth-client.ts`
- Rewrite: `packages/client/src/hooks/useAuth.tsx`
- Modify: `packages/client/src/lib/api.ts`
- Rewrite: `packages/client/src/pages/LoginPage.tsx`
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/components/Layout/UserMenu.tsx`
- Modify: `packages/client/src/plugins/PluginManager.ts`
- Modify: `packages/client/src/main.tsx`
- Modify: `packages/client/vite.config.ts`

- [ ] **Step 1: Install better-auth client**

```bash
npm install better-auth --workspace=packages/client
```

- [ ] **Step 2: Create auth client**

Create `packages/client/src/lib/auth-client.ts`:
```typescript
import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: "/api",
  plugins: [passkeyClient()],
});
```

- [ ] **Step 3: Rewrite useAuth.tsx**

Replace manual JWT token management with better-auth's `useSession()`. The hook should:
- Use `authClient.useSession()` for reactive session state
- Expose `login`, `register`, `loginWithGoogle`, `loginWithGithub`, `logout` functions
- Map better-auth's session user to the existing `AuthUser` type
- Remove 14-minute refresh timer, `setAccessToken`, OAuth URL parsing

- [ ] **Step 4: Update api.ts**

Remove `_accessToken`, `setAccessToken()`, `getAccessToken()`. Remove `Authorization: Bearer` header from `request()`. Remove `X-Requested-With` header (better-auth handles CSRF). Keep `credentials: 'include'`.

- [ ] **Step 5: Rewrite LoginPage.tsx**

Replace manual form submission with `authClient.signIn.email()` / `authClient.signUp.email()`. OAuth buttons use `authClient.signIn.social()`. Add "Sign in with passkey" button calling `authClient.passkey.authenticate()`. Keep the same visual design.

- [ ] **Step 6: Update App.tsx**

Update `AuthProvider` usage — may need to adjust how better-auth's session provider wraps the app.

- [ ] **Step 7: Update UserMenu.tsx**

Add a "Security" or "Passkeys" menu item that opens passkey management.

- [ ] **Step 8: Update PluginManager.ts**

Remove `getAccessToken` import. The `api.fetch` in `createClientApi` no longer needs to set `Authorization` header — cookies handle auth automatically.

- [ ] **Step 9: Update vite.config.ts proxy**

Ensure `/api/auth` is proxied to the backend (it should already be covered by the `/api` proxy).

- [ ] **Step 10: Verify client builds**

```bash
npm run build --workspace=packages/client
```

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: migrate client auth to better-auth with passkey support"
```

---

## Task 9: Passkey Management UI

**Files:**
- Create: `packages/client/src/components/Security/PasskeyManager.tsx`
- Modify: `packages/client/src/pages/LoginPage.tsx` (if not already done)
- Modify: `packages/client/src/components/Layout/UserMenu.tsx`

- [ ] **Step 1: Create PasskeyManager component**

A component that:
- Fetches registered passkeys from better-auth API
- Lists them with name, creation date
- "Add passkey" button → prompts `authClient.passkey.register({ name })`
- Name input dialog before registration
- "Remove" button per passkey with confirmation
- Error and loading states
- Styled with Tailwind, consistent with Kryton's dark theme

- [ ] **Step 2: Wire PasskeyManager into the app**

Add it as a modal or panel accessible from UserMenu → "Manage Passkeys". Or add it to the AdminPage as a "Security" tab for the current user.

- [ ] **Step 3: Verify passkey registration flow**

Open the app, login, go to passkey settings, click "Add passkey". Browser should prompt for biometric/PIN. After registration, the passkey should appear in the list.

- [ ] **Step 4: Verify passkey login flow**

Logout, go to login page, click "Sign in with passkey". Browser should prompt for passkey selection. After authentication, should redirect to the app.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add passkey management UI and login flow"
```

---

## Task 10: Data Migration Script

**Files:**
- Create: `scripts/migrate-auth-data.ts`

- [ ] **Step 1: Write migration script**

The script should:
1. Connect to PostgreSQL directly
2. Read existing `user` table rows
3. Insert into better-auth's `user` table (map `avatarUrl` → `image`, keep `role`, `disabled`)
4. For each user with `passwordHash`: create an `account` record with `providerId: "credential"`, `password: passwordHash`
5. For each `auth_provider` row: create an `account` record with `providerId` and `accountId`
6. Map `invite_code` rows to the new Prisma `InviteCode` table
7. Drop old TypeORM tables that are no longer needed

- [ ] **Step 2: Test migration on dev database**

```bash
npx tsx scripts/migrate-auth-data.ts
```

Verify: login with existing credentials still works.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-auth-data.ts && git commit -m "feat: add auth data migration script for TypeORM → better-auth"
```

---

## Task 11: Update Plugin API Types in Registry

**Files:**
- Modify: `types/server.d.ts` in `piwi3910/kryton-plugins` repo

- [ ] **Step 1: Remove database methods from PluginAPI type**

Remove `database.registerEntity()` and `database.getRepository()` from the `PluginAPI` interface. Add a comment that plugins should use `api.storage` for persistence.

- [ ] **Step 2: Update PLUGIN_API.md documentation**

Update the plugin API docs to reflect the removal of database methods and the new storage-only approach.

- [ ] **Step 3: Push to registry repo**

---

## Task 12: Final Verification & Cleanup

- [ ] **Step 1: Run full test suite**

```bash
npm run build && npm run lint && npm run typecheck && npm test
```

- [ ] **Step 2: Start dev server and test all flows**

- Email/password login
- Email/password registration
- OAuth login (Google, GitHub)
- Passkey registration
- Passkey login
- Admin panel (user management)
- Plugin system (install, enable, disable)
- Note creation, editing, saving
- Search, graph, sharing
- All sidebar plugins (calendar, checklist, tag wrangler, etc.)

- [ ] **Step 3: Verify no TypeORM references remain**

```bash
grep -r "typeorm\|TypeORM\|AppDataSource\|getRepository" packages/server/src/ --include="*.ts"
# Expected: no matches
```

- [ ] **Step 4: Verify no JWT/bcrypt references remain**

```bash
grep -r "jsonwebtoken\|bcrypt\|verifyAccessToken\|generateAccessToken" packages/server/src/ --include="*.ts"
# Expected: no matches
```

- [ ] **Step 5: Commit final cleanup**

```bash
git add -A && git commit -m "chore: final cleanup after auth/ORM migration"
```
