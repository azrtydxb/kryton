# Contributing to Kryton

## Prerequisites

- Node.js 24+
- PostgreSQL 16+ (or Docker)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/azrtydxb/kryton.git && cd kryton

# 2. Copy environment template
cp .env.example .env

# 3. Edit .env — set POSTGRES_URL and BETTER_AUTH_SECRET at minimum

# 4. Install dependencies
npm install

# 5. Start Postgres + apply Drizzle migrations
docker compose up -d postgres
npm run db:migrate --workspace=packages/server

# 6. Start development servers
npm run dev
```

Frontend runs at http://localhost:5173, backend at http://localhost:3001.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend + backend dev servers |
| `npm run build` | Production build |
| `npm run test` | Run all tests |
| `npm run lint` | Lint all packages |
| `npm run typecheck` | TypeScript type checking |

## Code Style

- **TypeScript strict mode** everywhere
- **Zod** for request validation on all API routes
- Errors thrown as `AppError` subclasses (`NotFoundError`, `ValidationError`, etc.) — the global error handler maps them; never catch-and-respond manually
- **Drizzle ORM** for all database access against Postgres. Use the relational query API (`db.query.X.findFirst/findMany`) for reads, the query builder (`db.select/.insert/.update/.delete`) for writes; raw SQL only when the builder can't express the query, with a comment explaining why
- **Zustand** for UI state, **TanStack Query** for server state on the client

## Pull Request Process

1. Branch from `master`
2. Make your changes
3. Ensure all checks pass: `npm run lint && npm run typecheck && npm run test && npm run build`
4. Open a PR against `master`
5. Describe what changed and why

## Project Structure

See [README.md](README.md) for architecture overview and project layout.

## Plugin Development

See [docs/PLUGINS.md](docs/PLUGINS.md) for the plugin development guide.
