# Mnemo - Technical Specification

A self-hosted, web-based note-taking application — an Obsidian replacement with a beautiful web interface.

## Core Principles

1. **Local-first** — All notes stored as plain Markdown files on disk
2. **Portable** — No vendor lock-in, works with any text editor as fallback
3. **Simple** — No auth, no cloud dependency, single-user focused
4. **Professional** — Clean, modern UI that feels premium

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 18 + Vite + TypeScript |
| Backend | Express + TypeScript |
| Database | PostgreSQL (caching/indexing only) |
| ORM | TypeORM |
| Editor | CodeMirror 6 |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| Deploy | Docker |

## Architecture

```
┌─────────────────────────────────────────────┐
│  React Frontend (Vite dev server)           │
│  - File tree sidebar                        │
│  - CodeMirror 6 markdown editor             │
│  - Live preview pane                        │
│  - Graph view (force-directed)              │
│  - Search interface                         │
└──────────────────┬──────────────────────────┘
                   │ REST API
┌──────────────────▼──────────────────────────┐
│  Express Backend                             │
│  - CRUD operations on .md files              │
│  - Parse [[links]], build graph cache        │
│  - Full-text search indexing                 │
│  - Serve API endpoints                       │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  PostgreSQL (minimal)                        │
│  - Graph cache (note relationships)          │
│  - Search index                              │
│  - App settings (theme preference)           │
└─────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  Local Filesystem (configurable volume)      │
│  notes/                                      │
│    ├── Daily/                                │
│    │   └── 2026-03-23.md                     │
│    ├── Projects/                             │
│    │   └── mnemo.md                          │
│    └── Ideas/                                │
│        └── startup-ideas.md                  │
└─────────────────────────────────────────────┘
```

## Features (MVP)

### P0 - Essential
- [ ] File tree sidebar with folder navigation
- [ ] Create/rename/delete notes and folders
- [ ] Markdown editor with CodeMirror 6
- [ ] Live preview pane
- [ ] `[[wiki-linking]]` syntax with autocomplete
- [ ] Dark/light mode (follow system)
- [ ] Responsive design (mobile-friendly)

### P1 - Important
- [ ] Full-text search across all notes
- [ ] Graph view showing note connections
- [ ] Keyboard shortcuts
- [ ] Note tags (#tag syntax)
- [ ] Recent notes list

### P2 - Nice to have
- [ ] Export notes as ZIP
- [ ] Markdown export with frontmatter
- [ ] Custom themes
- [ ] Vim keybindings

## Database Schema (TypeORM Entities)

### Settings
```typescript
@Entity()
class Settings {
  @PrimaryColumn()
  key: string;
  
  @Column()
  value: string;
}
```

### GraphEdge (cached relationships)
```typescript
@Entity()
class GraphEdge {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column()
  fromPath: string;  // e.g., "Projects/mnemo"
  
  @Column()
  toPath: string;    // e.g., "Ideas/startup-ideas"
  
  @Index()
  @Column()
  fromNoteId: string;
  
  @Index()
  @Column()
  toNoteId: string;
}
```

### SearchIndex
```typescript
@Entity()
class SearchIndex {
  @PrimaryColumn()
  notePath: string;
  
  @Column('text')
  title: string;
  
  @Column('text')
  content: string;  // Plain text for full-text search
  
  @Column('simple-array')
  tags: string[];
  
  @Column()
  modifiedAt: Date;
}
```

## API Endpoints

### Notes
- `GET /api/notes` — List all notes (tree structure)
- `GET /api/notes/:path` — Get note content (`path` is URL-encoded, e.g., `Projects%2Fmnemo`)
- `POST /api/notes` — Create note `{ path, content }`
- `PUT /api/notes/:path` — Update note `{ content }`
- `DELETE /api/notes/:path` — Delete note
- `POST /api/notes/:path/rename` — Rename note `{ newPath }`

### Folders
- `POST /api/folders` — Create folder `{ path }`
- `DELETE /api/folders/:path` — Delete empty folder
- `POST /api/folders/:path/rename` — Rename folder `{ newPath }`

### Search
- `GET /api/search?q=query` — Full-text search

### Graph
- `GET /api/graph` — Get all note connections for graph view

### Settings
- `GET /api/settings` — Get all settings
- `PUT /api/settings/:key` — Update setting `{ value }`

## Frontend Components

### Layout
```
┌─────────────────────────────────────────────────────────┐
│ Header (search bar, theme toggle, actions)              │
├────────────┬───────────────────────────┬────────────────┤
│            │                           │                │
│  Sidebar   │      Editor Pane          │  Preview Pane  │
│  (file     │      (CodeMirror 6)       │  (rendered     │
│   tree)    │                           │   markdown)    │
│            │                           │                │
│  250px     │      flexible             │   flexible     │
├────────────┴───────────────────────────┴────────────────┤
│ Optional: Graph View (full-screen modal)                │
└─────────────────────────────────────────────────────────┘
```

### Key Components
- `App.tsx` — Main layout, routing
- `Sidebar.tsx` — File tree, folder actions
- `Editor.tsx` — CodeMirror 6 wrapper
- `Preview.tsx` — Markdown renderer
- `SearchBar.tsx` — Global search with results dropdown
- `GraphView.tsx` — Force-directed graph (D3.js or react-force-graph)
- `ThemeToggle.tsx` — Dark/light mode switcher

## Styling Guidelines

- **Font**: Inter or system font stack
- **Spacing**: Consistent 4px/8px/16px grid
- **Colors**: 
  - Light: white backgrounds, gray-900 text, blue-500 accents
  - Dark: gray-900 backgrounds, gray-100 text, blue-400 accents
- **Borders**: Subtle, 1px, rounded corners (6px)
- **Shadows**: Soft, minimal (focus on clean look)
- **Transitions**: 150ms ease for hover states

## Docker Configuration

```yaml
# docker-compose.yml
version: '3.8'
services:
  mnemo:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./notes:/app/notes  # Configurable notes directory
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/mnemo
    depends_on:
      - db
  
  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=mnemo
      - POSTGRES_PASSWORD=postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

## File Structure

```
mnemo/
├── packages/
│   ├── client/                 # React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── Layout/
│   │   │   │   ├── Editor/
│   │   │   │   ├── Sidebar/
│   │   │   │   ├── Preview/
│   │   │   │   ├── Search/
│   │   │   │   └── Graph/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   ├── styles/
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   └── package.json
│   │
│   └── server/                 # Express backend
│       ├── src/
│       │   ├── entities/       # TypeORM entities
│       │   ├── routes/         # API routes
│       │   ├── services/       # Business logic
│       │   ├── middleware/
│       │   └── index.ts
│       ├── tsconfig.json
│       └── package.json
│
├── docker-compose.yml
├── Dockerfile
├── package.json                # Workspace root
└── SPEC.md                     # This file
```

## Quality Requirements

1. **No stubs** — Every component must be fully implemented
2. **No lint errors** — ESLint strict mode, fix all issues
3. **TypeScript strict** — `strict: true` in tsconfig
4. **Responsive** — Mobile-first CSS, test at 375px and up
5. **Accessible** — Proper ARIA labels, keyboard navigation
6. **Fast** — Initial load < 2s, editor input lag < 16ms
7. **Professional UI** — Clean, minimal, no placeholder styles

## Development Commands

```bash
# Install dependencies
npm install

# Start dev servers (frontend + backend)
npm run dev

# Build for production
npm run build

# Run linter
npm run lint

# Fix lint issues
npm run lint:fix

# Type check
npm run typecheck
```

## Success Criteria

MVP is complete when:
1. ✅ Can create, edit, delete notes via web UI
2. ✅ Notes persist as .md files on disk
3. ✅ Can navigate folder structure in sidebar
4. ✅ Editor has syntax highlighting and feels smooth
5. ✅ Preview renders markdown correctly
6. ✅ `[[links]]` work with autocomplete
7. ✅ Search returns relevant results
8. ✅ Graph view shows note connections
9. ✅ Dark/light mode works and follows system
10. ✅ Works on mobile (responsive)
11. ✅ Docker deployment works
12. ✅ Zero lint errors, zero type errors
