import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const user = pgTable(
  "User",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("emailVerified").notNull().default(false),
    image: text("image"),
    role: text("role").notNull().default("user"),
    disabled: boolean("disabled").notNull().default(false),
    twoFactorEnabled: boolean("twoFactorEnabled").notNull().default(false),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("User_email_key").on(t.email)],
);

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const session = pgTable(
  "Session",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("Session_token_key").on(t.token)],
);

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export const account = pgTable(
  "Account",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    idToken: text("idToken"),
    password: text("password"),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("Account_providerId_accountId_key").on(t.providerId, t.accountId),
  ],
);

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export const verification = pgTable("Verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Passkey
// ---------------------------------------------------------------------------

export const passkey = pgTable(
  "Passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("publicKey").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credentialID").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("deviceType").notNull(),
    backedUp: boolean("backedUp").notNull(),
    transports: text("transports"),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("Passkey_credentialID_key").on(t.credentialID)],
);

// ---------------------------------------------------------------------------
// TwoFactor
// ---------------------------------------------------------------------------

export const twoFactor = pgTable(
  "TwoFactor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backupCodes").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("TwoFactor_userId_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// ApiKey
// ---------------------------------------------------------------------------

export const apiKey = pgTable(
  "ApiKey",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("keyHash").notNull(),
    keyPrefix: text("keyPrefix").notNull(),
    scope: text("scope").notNull().default("read-only"),
    // Optional binding to an agent — populated when the key is minted for a
    // specific AI/MCP integration. Vault-events use this to attribute writes
    // ("Claude added <note>"). The FK to Agent has no ON DELETE clause via
    // text references; clearing is handled at the application layer when the
    // bound agent is removed (see ApiKeyService.revoke).
    agentId: text("agentId"),
    expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }),
    lastUsedAt: timestamp("lastUsedAt", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ApiKey_keyHash_key").on(t.keyHash),
    index("ApiKey_userId_idx").on(t.userId),
    index("ApiKey_keyHash_idx").on(t.keyHash),
    index("ApiKey_agentId_idx").on(t.agentId),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
//
// `userRelations` is composed in `./index.ts` so it can reference tables
// from other schema files (notes, sharing, sync, agents) without producing
// a cyclic-module import here.

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const passkeyRelations = relations(passkey, ({ one }) => ({
  user: one(user, { fields: [passkey.userId], references: [user.id] }),
}));

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(user, { fields: [twoFactor.userId], references: [user.id] }),
}));

export const apiKeyRelations = relations(apiKey, ({ one }) => ({
  user: one(user, { fields: [apiKey.userId], references: [user.id] }),
}));
