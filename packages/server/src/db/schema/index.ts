/**
 * Drizzle schema barrel — re-exports every table + relation set across the
 * domain modules. `userRelations` is declared here (not in `./auth.ts`) so
 * it can reference tables in every other domain module without pulling in
 * cross-module imports inside `auth.ts`.
 */
import { relations } from "drizzle-orm";

import {
  user,
  session,
  account,
  passkey,
  twoFactor,
  apiKey,
} from "./auth.js";
import { pluginStorage } from "./settings.js";
import {
  searchIndex,
  graphEdge,
  folder,
  tag,
  noteTag,
  noteVersion,
  noteRevision,
  attachment,
} from "./notes.js";
import {
  noteShare,
  accessRequest,
  inviteCode,
} from "./sharing.js";
import { syncCursor, yjsDocument } from "./sync.js";
import { agent } from "./agents.js";

export const userRelations = relations(user, ({ many, one }) => ({
  // Auth
  sessions: many(session),
  accounts: many(account),
  passkeys: many(passkey),
  twoFactors: many(twoFactor),
  apiKeys: many(apiKey),
  // Sharing
  noteShares: many(noteShare, { relationName: "owner" }),
  sharedWith: many(noteShare, { relationName: "sharedWith" }),
  accessRequestsOwner: many(accessRequest, { relationName: "arOwner" }),
  accessRequestsRequester: many(accessRequest, { relationName: "arRequester" }),
  inviteCodesCreated: many(inviteCode, { relationName: "createdBy" }),
  inviteCodesUsed: many(inviteCode, { relationName: "usedBy" }),
  // Notes / knowledge
  searchIndices: many(searchIndex),
  graphEdges: many(graphEdge),
  folders: many(folder),
  tags: many(tag),
  noteTags: many(noteTag),
  noteVersions: many(noteVersion),
  noteRevisions: many(noteRevision),
  attachments: many(attachment),
  // Settings / plugins
  pluginStorage: many(pluginStorage),
  // Sync / collab
  yjsDocuments: many(yjsDocument),
  syncCursor: one(syncCursor),
  // Agents
  agents: many(agent),
}));

export * from "./auth.js";
export * from "./settings.js";
export * from "./notes.js";
export * from "./sharing.js";
export * from "./sync.js";
export * from "./agents.js";
