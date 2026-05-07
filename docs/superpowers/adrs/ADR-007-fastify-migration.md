# ADR-007: Migrate server from Express to Fastify with vertical-module architecture

- **Status:** Accepted
- **Date:** 2026-05-07
- **Branch:** `feat/fastify-migration`

## Context

The Kryton server was built on Express 5 with a flat `routes/` + `services/` layout, hand-written `swagger-jsdoc` annotations, ad-hoc validation, and a 535-line `index.ts` composition root. As the system grew (notes, sync, Yjs collaboration, MCP, plugins), the layout no longer made boundaries explicit and validation drifted between hand-rolled checks and Zod.

## Decision

Replace Express 5 with Fastify 5 and restructure the server into 7 vertical feature modules, each registered as a Fastify plugin:

1. **identity** — Better Auth catch-all, users, API keys
2. **notes** — notes/folders/daily/templates/tags/trash + attachments/canvas/history/backlinks
3. **knowledge** — search and graph
4. **collab** — shares, sync v2, Yjs WebSocket at `/ws/yjs/:docId` (sync v1 dropped)
5. **agents** — agents and MCP HTTP transport
6. **plugins** — Kryton plugin runtime
7. **platform** — admin, settings, version, health/ready

Cross-cutting concerns are framework plugins (`packages/server/src/plugins/`): zod type provider, pino logger, errors, prisma, cedar, better-auth, helmet+cors, rate-limit, multipart, websocket, OpenAPI, telemetry. Shared services (Prisma, Better Auth helpers, Cedar, config) reach modules via `app.decorate()` + module augmentation; cross-module needs are exposed as decorators (`fastify.notes.*`, `fastify.knowledge.*`, `fastify.collab.*`, `fastify.identity.*`).

OpenAPI 3.1 is generated at `/docs/json` directly from each route's Zod schema via `fastify-type-provider-zod` v6 + `@fastify/swagger`. `swagger-jsdoc` removed.

Validation is unified on Zod 4 with `fastify-type-provider-zod` v6 (v4.0.2 was incompatible with Zod 4 and was bumped at integration time).

## Consequences

**Positive**
- Single source of truth for request/response shape (Zod schemas), automatically reflected in generated OpenAPI.
- Strict module boundaries enforced by folder layout + decorator surface; sibling modules can't reach into each other's services.
- Pino logging out of the box with redaction; OpenTelemetry hooks preserved.
- 79 routes register cleanly through declarative schemas; in-tree plugins (calendar, checklist, git-backup, sample-wordcount, tag-wrangler, templater) auto-load on boot.
- Deletion of ~8 KLOC of legacy Express code, shrinking the surface area.

**Negative / accepted**
- Sync v1 was dropped (no client still uses it; pre-production status made this safe).
- Better Auth is mounted via a catch-all route that serializes the request body and forwards through the SDK's Web Request handler. This is slightly less efficient than a native plugin but avoids forking Better Auth's transport.
- Plugin route disable/enable can no longer fully unregister Fastify routes at runtime; current implementation flags routes as disabled via a per-route `preHandler` that returns 404. A clean reload story would require encapsulating each plugin in its own Fastify scope; deferred.
- Some Phase B agent-authored test scaffolds use stubbed `app` instances that don't reflect the integrated decorator wiring. Nine tests fail for that reason; they need to be migrated to the shared `buildTestApp()` helper.

## Alternatives considered

- **Pure framework swap, keep flat layout.** Faster, but does not address the lack of module boundaries that motivated the work.
- **Strangler pattern (route-by-route).** Safer for live traffic, but Kryton is pre-production, so big-bang on a feature branch was strictly better — no dual-stack period, single coherent diff.
- **Hexagonal / ports-and-adapters.** Highest ceiling, biggest mindset shift; not worth the investment for the current team size.

## References

- Spec: `docs/superpowers/specs/2026-05-07-fastify-migration-design.md`
- Plan: `docs/superpowers/plans/2026-05-07-fastify-migration.md`
