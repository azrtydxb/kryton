# Contributing to Mnemo

## Prerequisites

- Node.js 24+
- PostgreSQL 16+ (or Docker)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/azrtydxb/mnemo.git && cd mnemo

# 2. Copy environment template
cp .env.example .env

# 3. Edit .env — set DATABASE_URL and JWT_SECRET at minimum

# 4. Install dependencies
npm install

# 5. Generate Prisma client and push schema
npx prisma generate --schema=packages/server/prisma/schema.prisma
npx prisma db push --schema=packages/server/prisma/schema.prisma

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
- Errors handled via Express error middleware (throw, don't catch-and-respond)
- **Prisma** for all database access (no raw SQL)
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
