# Kryton + NovaMem Postgres Co-Tenancy and Shared Identity Design

**Date**: 2026-05-12
**Status**: Draft
**Prerequisite**: ✅ Postgres + Drizzle migration shipped (PR #109). ✅ Semantic search Phase A shipped (PR #114).

## Problem

Phase B of the semantic-search work introduces a `SEMANTIC_PROVIDER=novamem` option: instead of Kryton running its own Transformers.js + pgvector pipeline, it delegates to NovaMem's hybrid keyword+vector+graph engine. For this to be useful (not a Rube-Goldberg detour), the two services need to share **two things**:

1. **A Postgres cluster.** Two database files on the same disk doesn't buy us anything; one Postgres with logically separated schemas does. NovaMem already runs Postgres + Drizzle + pgvector — same dialect as Kryton. The question is how to share it without either system stomping on the other.
2. **An identity.** Kryton's `userId` should equal NovaMem's `userId`. Today they each have their own `User` table; a Kryton user that signs up doesn't exist in NovaMem until someone provisions them.

This design covers both, plus the wiring inside Kryton's `SemanticProvider` interface so swapping providers is a config flip.

## Decisions to lock in

| # | Question | Recommended | Rationale |
|---|---|---|---|
| C1 | Schema layout in shared Postgres | Two schemas: `kryton` (default) + `novamem`. Each owns its tables. No cross-schema FKs. | Cleanest isolation. Each service runs its own `drizzle-kit migrate` against its schema. Either can be wiped without touching the other. |
| C2 | Identity authority | **better-auth in Kryton** is authoritative. NovaMem reads sessions / validates JWTs against Kryton's tables; its own `User` table becomes a shadow keyed by Kryton's `userId`. | Kryton already has full auth (passkeys, 2FA, sessions, API keys). NovaMem is a memory engine, not an identity provider. |
| C3 | Cross-service auth mechanism | Kryton mints short-lived JWTs (signed with `BETTER_AUTH_SECRET`); NovaMem validates them. No session-cookie sharing. | Stateless. Works regardless of NovaMem deployment (sidecar, separate host, even cross-machine). |
| C4 | Single Postgres user or two roles | Two Postgres roles: `kryton` + `novamem`, each owning their schema. Grant `kryton` SELECT on `novamem.user_shadow` for joins. | Principle of least privilege. Either service can be DB-compromised without giving the attacker the other's data. |
| C5 | Provider selection model | `SEMANTIC_PROVIDER=novamem` in Kryton's env. Same plugin (`plugins/embedder.ts`) loads a different `SemanticProvider` implementation. UI is unchanged. | Mirrors what the original semantic spec already designed (Q6). |
| C6 | Migration path for existing self-hosters | New deployment only. Anyone running `pgvector-local` who wants to switch to NovaMem performs a one-time reindex: drop `NoteEmbeddingChunk`, set `SEMANTIC_PROVIDER=novamem`, run `POST /api/search/semantic/reindex?scope=all`. NovaMem re-ingests every note via `memory_remember`. | Idempotent. No data migration tool needed — NovaMem rebuilds from the filesystem (the source of truth). |
| C7 | What `pgvector-local` users keep using | `pgvector-local` stays the default. NovaMem is opt-in. Most self-hosters running a single binary do NOT need NovaMem. | Already locked by Q6 of the original semantic spec. |

## Design

### Shared Postgres layout

```
postgres://localhost:5432/shared/
├── schemas
│   ├── kryton                    -- owned by `kryton` role
│   │   ├── User                  -- better-auth tables
│   │   ├── Session
│   │   ├── ... (24 more Kryton tables)
│   │   ├── NoteEmbeddingChunk    -- only populated when SEMANTIC_PROVIDER=pgvector-local
│   │   └── EmbedJob              -- only populated when SEMANTIC_PROVIDER=pgvector-local
│   └── novamem                   -- owned by `novamem` role
│       ├── user_shadow           -- mirrors Kryton's User; updated by trigger or polling
│       ├── memory                -- NovaMem's primary table (embeddings + keyword tsv)
│       ├── memory_graph_edges    -- NovaMem's graph layer
│       └── project_                -- NovaMem's "project" namespace concept; one per Kryton tenant
```

Grants:
- `kryton` role: `ALL` on schema `kryton`, `SELECT, USAGE` on `novamem.user_shadow` (for joins if needed; usually not).
- `novamem` role: `ALL` on schema `novamem`, `SELECT, USAGE` on `kryton."User"` (read-only shadow sync source).

`search_path` for each service: `SET search_path TO kryton, public;` (Kryton) and `SET search_path TO novamem, public;` (NovaMem).

### Identity sync: `user_shadow` table

NovaMem operates on a thin shadow of Kryton's `User` table — it needs the `id` (foreign-key target) and `email` (display), nothing more.

```sql
CREATE TABLE novamem.user_shadow (
  id text PRIMARY KEY,         -- mirrors kryton."User"."id"
  email text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
```

Two ways to keep it in sync, ranked:

1. **Postgres trigger on `kryton."User"` writes:** `AFTER INSERT OR UPDATE OF email` → `INSERT INTO novamem.user_shadow ... ON CONFLICT (id) DO UPDATE`. Real-time, ~zero latency. The trigger uses `SECURITY DEFINER` so the `kryton` role can write into `novamem` without owning it.
2. **Hourly polling job in NovaMem:** `INSERT INTO novamem.user_shadow SELECT id, email, NOW() FROM kryton."User" ON CONFLICT (id) DO UPDATE WHERE excluded.email != user_shadow.email`. Simpler; eventual consistency. Acceptable if NovaMem can tolerate a stale email for an hour.

Recommendation: **(1) trigger.** Implementation is small; sync is exact.

### Cross-service auth: short-lived JWTs

When a Kryton-authenticated request needs to call NovaMem (e.g., `provider.search(query, userId)` in Kryton's embedder plugin), Kryton mints a JWT:

```jsonc
{
  "iss": "kryton",
  "aud": "novamem",
  "sub": "<userId>",
  "iat": 1700000000,
  "exp": 1700000300,           // 5 min TTL
  "scope": "memory.read memory.write"
}
```

Signed with the same `BETTER_AUTH_SECRET` Kryton already uses. NovaMem's HTTP layer (or MCP server, depending on transport) validates the signature, checks `aud === "novamem"` and `exp > now()`, and treats `sub` as the authenticated user.

The JWT is sent as `Authorization: Bearer <jwt>` on every Kryton → NovaMem call. NovaMem caches valid JWTs in-memory for 30 s to avoid re-verifying every request.

No session cookies cross the boundary. No shared session store.

### `SemanticProvider` interface

The semantic spec already defined the interface. Phase B implementation:

```ts
// packages/server/src/modules/knowledge/services/providers/novamem.ts
export class NovamemSemanticProvider implements SemanticProvider {
  constructor(private deps: { endpoint: string; jwtMinter: JwtMinter }) {}

  async upsert(input: { userId, notePath, title, content }): Promise<void> {
    const jwt = await this.deps.jwtMinter.mint(input.userId);
    await fetch(`${this.deps.endpoint}/memories/remember`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        project: `kryton-${input.userId}`,
        sourceType: "note",
        sourceId: input.notePath,
        title: input.title,
        content: input.content,
      }),
    });
  }

  async delete(input): Promise<void> { /* memories/forget */ }

  async search(input): Promise<SemanticHit[]> {
    const jwt = await this.deps.jwtMinter.mint(input.userId);
    const res = await fetch(`${this.deps.endpoint}/memories/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ project: `kryton-${input.userId}`, query: input.query, limit: input.limit }),
    });
    const data = await res.json();
    return data.hits.map(toSemanticHit);
  }

  async ready(): Promise<{ provider: "novamem", dimensions: number, model?: string }> {
    // GET /healthz on NovaMem
  }
}
```

Kryton's embedder plugin chooses the implementation at boot:

```ts
const provider = app.config.SEMANTIC_PROVIDER === "novamem"
  ? new NovamemSemanticProvider({ endpoint: app.config.NOVAMEM_ENDPOINT, jwtMinter })
  : new PgvectorLocalProvider({ embedder, db: app.db });
```

The `SearchService.enqueueEmbedJob` writer doesn't change — it still writes to `EmbedJob`. The worker, when `provider=novamem`, calls `provider.upsert` instead of reading from disk + chunking + writing to `NoteEmbeddingChunk`. NovaMem owns chunking + embedding internally.

When `provider=novamem`, the fused-search SQL in `fused-search.service.ts` short-circuits: NovaMem already runs the 3-layer fusion natively, so Kryton just proxies `provider.search(query, userId)` and returns NovaMem's pre-ranked results.

### Env vars

```
SEMANTIC_PROVIDER=novamem
NOVAMEM_ENDPOINT=http://localhost:8080
NOVAMEM_PROJECT_PREFIX=kryton-           # tenant projects become "kryton-<userId>"
SEMANTIC_DIMENSIONS=384                   # must match NovaMem's collection
```

`BETTER_AUTH_SECRET` is already required for Kryton; the JWT minter reuses it. No separate secret to manage.

### Docker Compose for the dual-service deployment

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: shared
    volumes:
      - ./packages/server/docker/postgres-init:/docker-entrypoint-initdb.d:ro
      - shared-pgdata:/var/lib/postgresql/data

  kryton:
    image: ghcr.io/azrtydxb/kryton:latest
    environment:
      POSTGRES_URL: postgres://kryton:kryton@postgres:5432/shared
      SEMANTIC_PROVIDER: novamem
      NOVAMEM_ENDPOINT: http://novamem:8080
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}

  novamem:
    image: novamem/novamem:latest
    environment:
      POSTGRES_URL: postgres://novamem:novamem@postgres:5432/shared
      KRYTON_USER_TABLE: kryton."User"     # for shadow sync
      JWT_AUDIENCE: novamem
      JWT_ISSUER_SECRET: ${BETTER_AUTH_SECRET}
```

Postgres init script creates the two roles + schemas + grants + the trigger. A single command brings the whole stack up:

```bash
BETTER_AUTH_SECRET=...your-32+-char-secret... docker compose up
```

## Implementation phases

This spec is design-only. When Phase B is on the table, implementation breaks into:

1. **Postgres init script** with the two-schema, two-role setup + the user-shadow trigger (~80 lines of SQL)
2. **JWT minter** in Kryton (`packages/server/src/lib/jwt-minter.ts`) — uses `jose` (already a transitive dep via better-auth) or `jsonwebtoken`
3. **`NovamemSemanticProvider`** implementation — HTTP client + JWT injection + response mapping
4. **Embedder plugin dispatch** — select provider based on `SEMANTIC_PROVIDER`
5. **Fused-search proxy path** — when `provider=novamem`, route `/api/search/?q=...` to NovaMem's search and skip local fusion
6. **Docker Compose example** in `docs/install/`
7. **Integration tests** — testcontainers spawns BOTH `postgres` AND a NovaMem mock (or a real NovaMem build if available)

Each phase is its own commit; the whole thing fits in one PR if NovaMem's HTTP API is stable.

## Open questions

1. **What's NovaMem's actual auth contract?** This spec assumes JWT with `Authorization: Bearer`. If NovaMem uses API keys, session cookies, or its own auth flow today, this spec needs updating before implementation. Concretely: check `/Users/pascal/Development/novamem-1/packages/server/src/http.ts` for the auth middleware.
2. **What's NovaMem's HTTP API shape?** This spec sketches `/memories/remember`, `/memories/search`, `/memories/forget`, `/healthz`. The real routes may differ. Implementation will need to consult NovaMem's OpenAPI spec.
3. **Does NovaMem's "project" concept map to Kryton tenants 1:1?** This spec assumes yes (one NovaMem project per Kryton user, named `kryton-<userId>`). If NovaMem projects are heavier-weight (per-org rather than per-user), the model may need a single shared project + a `userId` filter on every call.
4. **Graph layer reconciliation.** Kryton's `GraphEdge` table (wikilink edges) drives Kryton's local graph layer. NovaMem has its own graph (`memory_graph_edges`). If `provider=novamem`, do we mirror Kryton's `GraphEdge` → NovaMem's graph on every wikilink change, or accept that NovaMem's graph layer is independent and may differ?
   - Recommendation: mirror, via the same `EmbedJob` queue. A wikilink change on a note enqueues an upsert; the worker also sends the updated outgoing-link list to NovaMem.

## Out of scope

- **Replacing better-auth with a shared auth service.** Kryton keeps full ownership of identity.
- **Multi-instance Kryton** (multiple Kryton servers talking to the same Postgres + NovaMem). Single-Kryton, single-NovaMem deployment for this design.
- **Cross-user memory sharing.** NovaMem's `memory_neighbors` for shared notes is interesting but adds complexity; not in this design.
- **Selecting between two NovaMem deployments at runtime.** One NovaMem instance per Kryton deployment.

## Acceptance criteria for Phase B implementation (later)

- `SEMANTIC_PROVIDER=novamem docker compose up` brings up the whole stack and a fresh signup → note creation → semantic search round-trip works
- `SEMANTIC_PROVIDER=pgvector-local` still works unchanged (no regression)
- `POST /api/search/semantic/reindex?scope=all` works for both providers
- The JWT minter rotates JWTs cleanly when `BETTER_AUTH_SECRET` is rotated (no need to restart NovaMem)
- Postgres trigger keeps `novamem.user_shadow` in sync with `kryton."User"` on every email change
