# Passkeys + Auth & ORM Migration Design

Unified migration: TypeORM → Prisma, hand-rolled auth → better-auth, and add passkey support.

## Overview

Kryton's authentication system is currently hand-rolled (custom JWT tokens, manual OAuth flows, bcrypt password hashing) on TypeORM with PostgreSQL. This migration replaces the entire data access layer and auth system in one pass:

1. **TypeORM → Prisma** — all 12 entities migrate to Prisma models
2. **Custom auth → better-auth** — OAuth, email/password, sessions managed by better-auth
3. **Add passkeys** — WebAuthn/passkey support via better-auth's passkey plugin
4. **CommonJS → ESM** — required by better-auth, modernizes the server

### Why One Migration

These changes are deeply intertwined — better-auth requires Prisma (or its own DB adapter), which requires replacing TypeORM, which touches every server file. Doing them separately would mean migrating TypeORM queries twice. One pass is cleaner.

---

## 1. ESM Migration

The server converts from CommonJS to ESM. Required because better-auth is ESM-only.

### Changes

**`packages/server/tsconfig.json`:**
- `"module": "commonjs"` → `"module": "ESNext"`
- `"moduleResolution": "bundler"`
- Remove `"experimentalDecorators"` and `"emitDecoratorMetadata"` (no more TypeORM decorators)

**`packages/server/package.json`:**
- Add `"type": "module"`

**All server source files:**
- `require()` → `import` (static or dynamic `await import()`)
- `__dirname` → `import.meta.dirname` (Node 24 supports this natively)

**Plugin loading:**
- `PluginManager.ts` changes `require()` to `createRequire(import.meta.url)` for loading CJS plugin bundles, maintaining compatibility with existing plugins.

---

## 2. Database — TypeORM → Prisma

### Schema

A single `prisma/schema.prisma` replaces all TypeORM entity files.

**Better-auth managed tables** (defined in schema but managed by better-auth):

```prisma
model User {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  role          String    @default("user")
  disabled      Boolean   @default(false)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  sessions      Session[]
  accounts      Account[]
  passkeys      Passkey[]
  // Domain relations
  settings      Settings[]
  noteShares    NoteShare[]    @relation("owner")
  sharedWith    NoteShare[]    @relation("sharedWith")
  accessRequestsOwner    AccessRequest[] @relation("arOwner")
  accessRequestsRequester AccessRequest[] @relation("arRequester")
  inviteCodesCreated InviteCode[] @relation("createdBy")
  inviteCodesUsed    InviteCode[] @relation("usedBy")
}

model Session {
  id        String   @id
  userId    String
  token     String   @unique
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id                String  @id
  userId            String
  accountId         String
  providerId        String
  accessToken       String?
  refreshToken      String?
  accessTokenExpiresAt DateTime?
  refreshTokenExpiresAt DateTime?
  scope             String?
  idToken           String?
  password          String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([providerId, accountId])
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model Passkey {
  id               String   @id
  name             String?
  publicKey        String
  userId           String
  credentialID     String   @unique
  counter          Int
  deviceType       String
  backedUp         Boolean
  transports       String?
  createdAt        DateTime @default(now())
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

**Domain models** (migrated from TypeORM):

```prisma
model Settings {
  key       String
  userId    String
  value     String
  user      User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([key, userId])
}

model SearchIndex {
  notePath   String
  userId     String
  title      String
  content    String
  tags       String[]
  modifiedAt DateTime

  @@id([notePath, userId])
  @@index([userId])
}

model GraphEdge {
  id         String @id @default(uuid())
  fromPath   String
  toPath     String
  fromNoteId String
  toNoteId   String
  userId     String

  @@index([userId])
  @@index([fromNoteId])
  @@index([toNoteId])
}

model NoteShare {
  id              String   @id @default(uuid())
  ownerUserId     String
  path            String
  isFolder        Boolean
  sharedWithUserId String
  permission      String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  owner           User     @relation("owner", fields: [ownerUserId], references: [id], onDelete: Cascade)
  sharedWith      User     @relation("sharedWith", fields: [sharedWithUserId], references: [id], onDelete: Cascade)

  @@unique([ownerUserId, path, sharedWithUserId])
}

model AccessRequest {
  id              String   @id @default(uuid())
  requesterUserId String
  ownerUserId     String
  notePath        String
  status          String   @default("pending")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  requester       User     @relation("arRequester", fields: [requesterUserId], references: [id], onDelete: Cascade)
  owner           User     @relation("arOwner", fields: [ownerUserId], references: [id], onDelete: Cascade)
}

model InviteCode {
  id          String    @id @default(uuid())
  code        String    @unique
  createdById String
  usedById    String?
  expiresAt   DateTime?
  createdAt   DateTime  @default(now())
  createdBy   User      @relation("createdBy", fields: [createdById], references: [id])
  usedBy      User?     @relation("usedBy", fields: [usedById], references: [id])
}

model PluginStorage {
  pluginId  String
  key       String
  userId    String   @default("")
  value     Json
  updatedAt DateTime @updatedAt

  @@id([pluginId, key, userId])
}

model InstalledPlugin {
  id          String   @id
  name        String
  version     String
  description String
  author      String
  state       String   @default("installed")
  error       String?
  manifest    Json?
  enabled     Boolean  @default(true)
  installedAt DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### Code Changes

**Removed:**
- `packages/server/src/entities/` — all 12 entity files
- `packages/server/src/data-source.ts`
- TypeORM dependencies (`typeorm`, `reflect-metadata`)

**Added:**
- `prisma/schema.prisma`
- `packages/server/src/prisma.ts` — Prisma Client singleton

**Modified — every service and route file:**
- `AppDataSource.getRepository(Entity).find()` → `prisma.entity.findMany()`
- `repo.save(obj)` → `prisma.entity.create({ data: obj })` or `upsert`
- `repo.delete(criteria)` → `prisma.entity.delete({ where: criteria })`
- `repo.createQueryBuilder()` → Prisma's fluent API or raw SQL

**Plugin API (`PluginApiFactory.ts`):**
- `api.database.registerEntity()` and `api.database.getRepository()` change to use Prisma
- Since Prisma doesn't have dynamic entity registration like TypeORM, `api.database.registerEntity()` becomes a no-op for now — plugins use `api.storage` for data or manage their own SQLite in `dataDir`
- `api.settings.get()` uses Prisma instead of TypeORM repository
- `api.search` uses Prisma queries

---

## 3. Authentication — better-auth

### Server Configuration

```typescript
import { betterAuth } from "better-auth";
import { passkey } from "better-auth/plugins/passkey";
import { admin } from "better-auth/plugins/admin";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
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
      role: { type: "string", defaultValue: "user" },
      disabled: { type: "boolean", defaultValue: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 300 },
  },
});
```

### Express Integration

```typescript
import { toNodeHandler } from "better-auth/node";
app.all("/api/auth/*splat", toNodeHandler(auth));
```

Replaces the entire `routes/auth.ts` (400+ lines).

### Auth Middleware

```typescript
import { fromNodeHeaders } from "better-auth/node";

export async function authMiddleware(req, res, next) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
  next();
}
```

`req.user` keeps the same shape — all downstream code (routes, plugins) is unaffected.

### Deleted Files

- `routes/auth.ts` — all custom auth routes
- `services/tokenService.ts` — JWT sign/verify, refresh token logic
- `services/oauthService.ts` — manual OAuth resolution
- `entities/User.ts`, `AuthProvider.ts`, `RefreshToken.ts`, `PasswordResetToken.ts`

### Invite Codes

Better-auth doesn't have built-in invite codes. We keep our `InviteCode` Prisma model and hook into better-auth's registration flow:

```typescript
emailAndPassword: {
  enabled: true,
  async onBeforeCreateUser({ email, metadata }) {
    const mode = await getRegistrationMode();
    if (mode === "invite") {
      const code = metadata?.inviteCode;
      // Validate invite code via Prisma
    }
  },
},
```

### Admin — First User

Better-auth's `beforeCreateUser` hook checks if any users exist. If not, the first user gets `role: "admin"`.

---

## 4. Client-Side Changes

### Auth Client (`lib/auth-client.ts`)

```typescript
import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: "/api",
  plugins: [passkeyClient()],
});
```

### useAuth Hook

Rewritten to use better-auth's React hooks:

- `authClient.useSession()` replaces manual token/session state
- `authClient.signIn.email()` replaces manual login
- `authClient.signUp.email()` replaces manual register
- `authClient.signIn.social({ provider: "google" })` replaces redirect
- `authClient.signOut()` replaces manual logout
- Remove 14-minute refresh timer (sessions are auto-managed)
- Remove in-memory token storage

### API Client (`lib/api.ts`)

- Remove `_accessToken`, `setAccessToken()`, `getAccessToken()`
- Remove `Authorization: Bearer` header from `request()`
- Remove `X-Requested-With` header (better-auth handles CSRF)
- Keep `credentials: 'include'` for cookie-based sessions

### Login Page

- Email/password forms use `authClient.signIn.email()` / `authClient.signUp.email()`
- OAuth buttons use `authClient.signIn.social()`
- Add "Sign in with passkey" button using `authClient.passkey.authenticate()`
- Forgot password via better-auth's built-in flow

### Passkey Management UI

New section in user settings (accessible from UserMenu):

- List registered passkeys (name, created date)
- "Add passkey" button → `authClient.passkey.register({ name: "..." })`
- "Remove" button per passkey
- Passkey naming dialog on registration

---

## 5. Plugin System Impact

### PluginAPI Changes

- `api.database.registerEntity()` — becomes no-op (Prisma doesn't support dynamic entities). Plugins use `api.storage` or their own SQLite in `dataDir`.
- `api.database.getRepository()` — removed. Plugins that need structured data use `api.storage` (key-value) or manage their own persistence.
- `api.settings.get()` — implementation changes from TypeORM to Prisma, same interface
- `api.search.index/query()` — implementation changes to Prisma, same interface
- `api.notes` — unchanged (filesystem-based)
- `api.events`, `api.routes`, `api.log`, `api.plugin` — unchanged

### Plugin Types Update

Update `types/server.d.ts` in the registry repo to remove `database.registerEntity()` and `database.getRepository()`. Add documentation that plugins should use `api.storage` for persistence.

---

## 6. Data Migration

### User Data

A migration script maps existing data to better-auth's schema:

1. **Users** → better-auth `user` table: `id`, `name`, `email`, `role`, `disabled`, `createdAt`, `updatedAt`. The `image` field maps from `avatarUrl`.

2. **Passwords** → better-auth `account` table: each user with a `passwordHash` gets an `account` record with `providerId: "credential"`, `password: passwordHash`. Better-auth uses bcrypt too, so existing hashes are compatible.

3. **OAuth providers** → better-auth `account` table: each `AuthProvider` becomes an `account` with `providerId: provider` (google/github), `accountId: providerAccountId`.

4. **Active sessions** — invalidated. All users must re-login after migration. This is expected and acceptable for a major auth migration.

5. **Domain data** (Settings, SearchIndex, GraphEdge, NoteShare, AccessRequest, InviteCode, PluginStorage, InstalledPlugin) — table structure is identical, no data migration needed beyond the schema migration handled by `prisma migrate`.

### Migration Script

```typescript
// scripts/migrate-auth-data.ts
// Run after prisma migrate, before starting the server
// 1. Copy user rows to new schema
// 2. Create account records for passwords and OAuth
// 3. Drop old auth tables
```

---

## 7. Implementation Sequence

All done in one branch, in this order:

1. **ESM migration** — convert server to ESM, verify build
2. **Add Prisma** — create schema, install dependencies
3. **Replace TypeORM** — swap all queries to Prisma, remove TypeORM
4. **Integrate better-auth** — add config, rewrite middleware, delete old auth
5. **Add passkeys** — enable plugin, add UI
6. **Client migration** — rewrite useAuth, LoginPage, api.ts
7. **Data migration script** — map existing users/accounts
8. **Testing and cleanup** — verify all flows, remove dead code
