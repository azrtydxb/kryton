# Mnemo Technical Specification

## Overview

Mnemo is a multi-user, web-based note-taking application with Markdown editing, knowledge graph visualization, note sharing, and an extensible plugin system.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 24+ |
| Language | TypeScript | 5.9+ |
| Backend | Express.js | 5.x |
| Database | PostgreSQL | 16 |
| ORM | Prisma | 7.x |
| Auth | better-auth | 1.5.x |
| Frontend | React | 19.x |
| Build | Vite | 8.x |
| CSS | Tailwind CSS | 4.x |
| State | Zustand + TanStack Query | latest |
| Editor | CodeMirror | 6.x |
| Graph | D3.js | 7.x |
| Search | MiniSearch | 7.x |

## Architecture

### Backend
- Express.js REST API with 14 route modules
- better-auth for authentication (email/password, OAuth, passkeys)
- Prisma ORM with PostgreSQL
- Per-user file-based note storage with UUID directory isolation
- Plugin system with server-side and client-side extension points
- WebSocket for real-time plugin communication
- Swagger/OpenAPI documentation at /api/docs

### Frontend
- React 19 SPA with Vite
- CodeMirror 6 Markdown editor with vim mode support
- D3.js knowledge graph visualization
- Zustand for UI state, TanStack Query for server state
- Tailwind CSS for styling

### Data Model

See `packages/server/prisma/schema.prisma` for the complete database schema.

### API Reference

See Swagger documentation at `/api/docs` when running the server, or `packages/server/src/swagger.ts` for the OpenAPI configuration.

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
