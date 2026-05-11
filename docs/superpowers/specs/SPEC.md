# Kryton Technical Specification

**Status**: Living document. Snapshot of the stack as of 2026-05-12 (post-Postgres+Drizzle migration, post-sync removal, post-semantic-search Phase A).

## Overview

Kryton is a multi-user, self-hosted note-taking application with Markdown editing, real-time Yjs collaboration, fused lexical + semantic + graph knowledge search, note sharing, an extensible plugin system, and a built-in MCP server for AI agents.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 24+ |
| Language | TypeScript | 5.9+ |
| Backend | Fastify | 5.x |
| Database | PostgreSQL + pgvector | 16 |
| ORM | Drizzle ORM | 0.45+ |
| Migrations | drizzle-kit | — |
| Auth | better-auth (Drizzle adapter) | 1.5.x |
| Frontend | React | 19.x |
| Build | Vite | 8.x |
| CSS | Tailwind CSS | 4.x |
| State | Zustand + TanStack Query | latest |
| Editor | Custom EditorView (Yjs-bound contenteditable) | — |
| Realtime collab | Yjs over WebSocket | latest |
| Graph render | Cross-platform painter (canvas2d web, Skia native) | — |
| Search — lexical | Postgres `tsvector` + GIN | — |
| Search — semantic | Transformers.js (MiniLM-L6-v2, 384d) + pgvector HNSW | 2.17.x |
| Search — fusion | Weighted RRF over lexical + semantic + 1-hop graph | — |

## Architecture

### Backend
- Fastify REST API + WebSocket; OpenAPI 3.1 spec auto-generated and served at `/api/docs` (themed)
- better-auth (Drizzle adapter) for authentication (email/password, passkeys, 2FA, API keys)
- Drizzle ORM with PostgreSQL + pgvector extension
- Per-user filesystem note storage (`NOTES_DIR/<userId>/...`), with `SearchIndex`, `GraphEdge`, `NoteEmbeddingChunk` mirroring metadata in Postgres
- Durable `EmbedJob` queue + in-process async worker for semantic indexing (Transformers.js, CPU)
- Plugin system with server-side and client-side extension points
- WebSocket for Yjs collab + plugin communication
- MCP server endpoint for AI agents

### Frontend
- React 19 SPA with Vite
- Custom EditorView with Yjs binding for collaborative editing
- Cross-platform graph renderer (canvas2d on web/Tauri, Skia on React Native) in `@azrtydxb/ui`
- Zustand for UI state, TanStack Query for server state
- Tailwind CSS + design tokens for styling
- Auto-generated SDK types (`@azrtydxb/sdk` from `openapi.snapshot.json`)

### Data Model

See `packages/server/src/db/schema/` for the Drizzle schema files (auth, settings, notes, sharing, collab, agents, embeddings).

### API Reference

See Swagger UI at `/api/docs` when the server is running (Kryton-themed, no Fastify topbar), or `packages/server/openapi.snapshot.json` for the OpenAPI 3.1 spec.

## Features

- Markdown editing with live preview
- Wiki-style `[[links]]` between notes
- Knowledge graph visualization
- Full-text search with MiniSearch
- Note sharing with read/readwrite permissions
- Daily notes and templates
- Canvas/whiteboard feature
- Tag management
- Admin panel (user management, invites, registration settings)
- Plugin ecosystem (server + client extensions)
- Dark/light theme
- Keyboard shortcuts
- PDF export via print
