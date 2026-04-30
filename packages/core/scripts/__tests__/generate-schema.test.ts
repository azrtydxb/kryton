import { describe, it, expect } from "vitest";
import { generateFromString } from "../generate-schema";

const PRISMA = `
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = "x" }

/// @sync tier1
model Settings {
  id        String   @id @default(cuid())
  key       String
  value     String
  updatedAt DateTime @updatedAt
}

model User {
  id String @id
  email String
}

/// @sync tier2 parent=Note
model NoteRevision {
  id String @id
  noteId String
  content String
}
`;

describe("generateFromString", () => {
  it("emits SQL for tier1+tier2 only", () => {
    const out = generateFromString(PRISMA);
    expect(out.sql).toContain("CREATE TABLE IF NOT EXISTS settings");
    expect(out.sql).toContain("CREATE TABLE IF NOT EXISTS note_revision");
    expect(out.sql).not.toContain("CREATE TABLE IF NOT EXISTS user");
  });

  it("emits TS types for tier1+tier2 only", () => {
    const out = generateFromString(PRISMA);
    expect(out.types).toContain("export interface Settings");
    expect(out.types).toContain("export interface NoteRevision");
    expect(out.types).not.toContain("export interface User");
  });

  it("emits ENTITIES metadata", () => {
    const out = generateFromString(PRISMA);
    expect(out.entities).toContain('"Settings"');
    expect(out.entities).toContain('"NoteRevision"');
  });

  it("includes core-internal tables in sql output", () => {
    const out = generateFromString(PRISMA);
    expect(out.sql).toContain("CREATE TABLE IF NOT EXISTS sync_state");
    expect(out.sql).toContain("CREATE TABLE IF NOT EXISTS yjs_documents");
    expect(out.sql).toContain("CREATE TABLE IF NOT EXISTS yjs_pending_updates");
    expect(out.sql).toContain("CREATE TABLE IF NOT EXISTS tier2_cache_meta");
  });
});
