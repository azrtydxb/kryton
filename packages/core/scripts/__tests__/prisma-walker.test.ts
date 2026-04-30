// packages/core/scripts/__tests__/prisma-walker.test.ts
import { describe, it, expect } from "vitest";
import { walkPrismaSchema } from "../lib/prisma-walker";

const SAMPLE = `
generator client { provider = "prisma-client-js" }

datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

/// @sync tier1
model Settings {
  id        String   @id @default(cuid())
  userId    String
  key       String
  value     String
  updatedAt DateTime @updatedAt
}

model User {
  id String @id
  email String @unique
}

/// @sync tier2 parent=Note
model NoteRevision {
  id String @id
  noteId String
  content String
}
`;

describe("walkPrismaSchema", () => {
  it("returns all models with their annotation blocks", () => {
    const models = walkPrismaSchema(SAMPLE);
    expect(models).toHaveLength(3);
    expect(models[0]).toMatchObject({
      name: "Settings",
      annotationBlock: "/// @sync tier1",
    });
    expect(models[1]).toMatchObject({
      name: "User",
      annotationBlock: "",
    });
    expect(models[2]).toMatchObject({
      name: "NoteRevision",
      annotationBlock: "/// @sync tier2 parent=Note",
    });
  });

  it("captures field lines per model", () => {
    const models = walkPrismaSchema(SAMPLE);
    expect(models[0].fields.map(f => f.trim())).toContain("id        String   @id @default(cuid())");
  });
});
