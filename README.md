# Mnemo

A self-hosted, web-based note-taking application — an Obsidian replacement.

See [SPEC.md](./SPEC.md) for full technical specification.

## Quick Start

```bash
# Install dependencies
npm install

# Start development servers
npm run dev

# Build for production
npm run build

# Run with Docker
docker-compose up
```

## Tech Stack

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS
- **Backend**: Express + TypeScript + TypeORM
- **Database**: PostgreSQL (caching/indexing only)
- **Editor**: CodeMirror 6
- **Deploy**: Docker

## Features

- Local Markdown files (no vendor lock-in)
- Wiki-style `[[linking]]`
- Graph view of connections
- Full-text search
- Dark/light mode
- Responsive design

## License

MIT
