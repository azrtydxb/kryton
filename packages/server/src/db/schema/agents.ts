import { relations, sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth.js";

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export const agent = pgTable(
  "Agent",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerUserId: text("ownerUserId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    label: text("label").notNull(),
    policyText: text("policyText"),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("lastSeenAt", { withTimezone: true, mode: "date" }),
  },
  (t) => [uniqueIndex("Agent_ownerUserId_name_key").on(t.ownerUserId, t.name)],
);

// ---------------------------------------------------------------------------
// AgentToken
// ---------------------------------------------------------------------------

export const agentToken = pgTable(
  "AgentToken",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    agentId: text("agentId")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    tokenHash: text("tokenHash").notNull(),
    scope: text("scope"),
    expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revokedAt", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("AgentToken_tokenHash_idx").on(t.tokenHash)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const agentRelations = relations(agent, ({ one, many }) => ({
  owner: one(user, { fields: [agent.ownerUserId], references: [user.id] }),
  tokens: many(agentToken),
}));

export const agentTokenRelations = relations(agentToken, ({ one }) => ({
  agent: one(agent, { fields: [agentToken.agentId], references: [agent.id] }),
}));

// ---------------------------------------------------------------------------
// McpSession — persists MCP streamable-HTTP sessions across server
// restarts. The in-memory map in agents/mcp/streamable.ts is the hot
// path; this table is consulted on cold misses to rehydrate the
// transport + per-session McpServer so clients don't have to
// re-initialize after a deploy or pod restart.
// ---------------------------------------------------------------------------

export const mcpSession = pgTable(
  "McpSession",
  {
    id: text("id").primaryKey(), // session id (uuid)
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // SHA-256(rawKey) — used to verify the same API key on rehydrate
    // without storing the key in plaintext.
    keyHash: text("keyHash").notNull(),
    // 'read-only' | 'read-write'
    keyScope: text("keyScope").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp("lastActivityAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("McpSession_userId_idx").on(t.userId),
    index("McpSession_lastActivityAt_idx").on(t.lastActivityAt),
  ],
);
