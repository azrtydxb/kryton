# ADR-005: `/// @sync` Prisma Annotations Drive Client SQLite Schema Generation

**Date:** 2026-04-30
**Status:** Accepted
**Sub-project:** Core (spec 1 of 5) + Server Sync v2 (spec 2 of 5)

## Context

`@azrtydxb/core` needs a local SQLite schema for the mobile and desktop clients. That schema must stay in sync with the server's Prisma schema as new entity types are added or columns change. Managing two separate schema definitions (one Prisma for the server, one raw SQL DDL for the client) is a maintenance hazard: the two drift apart silently, producing sync failures that are hard to diagnose.

Three approaches were evaluated:

1. **Separate hand-maintained client DDL** — error-prone; any server column addition that is not mirrored in the client DDL causes a silent data loss at sync time.
2. **Full Prisma on the client** — Prisma is designed for server-side Node.js; the WASM build is not mature for Expo/React Native and adds significant bundle weight.
3. **Annotations on the server schema driving a code-generation step** — the server schema is the single source of truth; a lightweight script reads the annotations and emits typed client DDL and TypeScript interfaces.

## Decision

Prisma model doc-comments carry `/// @sync tier1` or `/// @sync tier2 parent=<Model>` annotations:

- `tier1` — always synced; included in the `pull` response and stored in the client's local SQLite.
- `tier2` — lazy; fetched on demand via `/api/sync/v2/tier2/:entityType/:parentId` and cached locally.
- Unannotated models (User, Session, ApiKey, etc.) are server-only and never appear in the client schema.

A codegen script (`scripts/gen-client-schema.ts`) parses `prisma/schema.prisma`, finds annotated models, and emits:
- `packages/core/src/generated/schema.sql` — CREATE TABLE statements for expo-sqlite / better-sqlite3.
- `packages/core/src/generated/types.ts` — TypeScript interfaces matching the columns exactly.

The script runs as part of `build:core` so the generated files are never edited by hand and are always consistent with the server schema.

## Consequences

**Gains:**
- Single source of truth: adding a column to the server Prisma schema automatically updates the client DDL and types on the next build.
- New entity types added in future phases require only an annotation, not a parallel hand-edit.
- TypeScript types for client entities are guaranteed to match the wire format — no cast-by-convention.

**Costs:**
- The codegen script must be maintained alongside the Prisma schema; schema features it does not handle (custom scalars, complex relations) require explicit codegen support.
- Generated files must be committed (or re-generated in CI) so consumers do not need to run the script at install time.
- The annotation syntax is informal (doc-comment strings); future Prisma versions may change comment parsing behaviour.

## References

- `docs/superpowers/specs/2026-04-30-server-sync-v2-design.md` (Prisma annotations section)
- `docs/superpowers/specs/2026-04-30-kryton-core-design.md` (generated schema consumption)
- ADR-002: Cursor versioning (the `version` and `updatedCursor` columns are also generated)
