/* global React */
/* Sample knowledge base data for the Kryton prototype */

const NOTES = [
  {
    id: 'welcome',
    title: 'Welcome to Kryton',
    path: '/Welcome.md',
    folder: null,
    starred: true,
    tags: ['welcome', 'getting-started'],
    updated: '2026-05-07T09:14:00Z',
    words: 142,
    body: `# Welcome to Kryton

Your **shared brain** for people and AI. Notes live in plain Markdown, link with [[wiki-links]], and anything an MCP-aware agent can read, you can read too.

## Getting started

- Hit \`Ctrl K\` to search anything
- Hit \`Ctrl N\` to create a note
- Hit \`Ctrl P\` to jump between notes
- Use \`[[double brackets]]\` to link
- Toggle the [[Graph View]] to see how it all connects

## What makes Kryton different

- **Self-hosted.** Your notes, your server.
- **MCP server built in.** Claude, Cursor, and any MCP agent can read and write \`/api/mcp\`.
- **Real graph.** Not decorative — backlinks and traversal are first-class.
- **Markdown all the way down.** Plain files, no lock-in.
`,
    outline: ['Welcome to Kryton', 'Getting started', 'What makes Kryton different'],
    backlinks: ['daily-2026-05-07', 'kryton-roadmap'],
    outgoing: ['graph-view', 'wiki-links', 'mcp-server'],
  },
  {
    id: 'kryton-roadmap',
    title: 'Kryton Roadmap',
    path: '/Projects/Kryton Roadmap.md',
    folder: 'Projects',
    starred: true,
    tags: ['project', 'roadmap'],
    updated: '2026-05-06T17:02:00Z',
    words: 318,
    outline: ['Q2 2026', 'Q3 2026', 'Open questions'],
    backlinks: ['welcome'],
    outgoing: ['knowledge-management', 'mcp-server'],
  },
  {
    id: 'knowledge-management',
    title: 'Knowledge Management',
    path: '/Ideas/Knowledge Management.md',
    folder: 'Ideas',
    starred: false,
    tags: ['ideas', 'knowledge-management', 'zettelkasten'],
    updated: '2026-05-04T11:40:00Z',
    words: 612,
    outline: ['Atomic notes', 'Linking patterns', 'AI as collaborator'],
    backlinks: ['welcome', 'kryton-roadmap'],
    outgoing: ['zettelkasten-method', 'graph-view'],
  },
  {
    id: 'zettelkasten-method',
    title: 'Zettelkasten Method',
    path: '/Ideas/Zettelkasten Method.md',
    folder: 'Ideas',
    starred: false,
    tags: ['ideas', 'zettelkasten'],
    updated: '2026-04-28T08:11:00Z',
    words: 421,
  },
  {
    id: 'graph-view',
    title: 'Graph View',
    path: '/Graph View.md',
    folder: null,
    starred: false,
    tags: ['feature'],
    updated: '2026-05-02T10:00:00Z',
    words: 88,
  },
  {
    id: 'wiki-links',
    title: 'Wiki-links',
    path: '/Wiki-links.md',
    folder: null,
    starred: false,
    tags: ['feature'],
    updated: '2026-05-01T14:23:00Z',
    words: 72,
  },
  {
    id: 'mcp-server',
    title: 'MCP Server',
    path: '/MCP Server.md',
    folder: null,
    starred: false,
    tags: ['feature', 'ai'],
    updated: '2026-05-05T09:00:00Z',
    words: 256,
  },
  {
    id: 'daily-2026-05-07',
    title: '2026-05-07',
    path: '/Daily/2026-05-07.md',
    folder: 'Daily',
    starred: false,
    tags: ['daily'],
    updated: '2026-05-07T08:30:00Z',
    words: 64,
  },
  {
    id: 'daily-2026-05-06',
    title: '2026-05-06',
    path: '/Daily/2026-05-06.md',
    folder: 'Daily',
    starred: false,
    tags: ['daily'],
    updated: '2026-05-06T22:10:00Z',
    words: 121,
  },
  {
    id: 'meeting-design-review',
    title: 'Design Review · 2026-05-06',
    path: '/Projects/Meetings/Design Review.md',
    folder: 'Projects',
    starred: false,
    tags: ['meeting', 'project'],
    updated: '2026-05-06T16:00:00Z',
    words: 184,
  },
  {
    id: 'tpl-meeting',
    title: 'Meeting',
    path: '/Templates/Meeting.md',
    folder: 'Templates',
    starred: false,
    tags: [],
    updated: '2026-04-15T12:00:00Z',
    words: 36,
  },
  {
    id: 'tpl-daily',
    title: 'Daily',
    path: '/Templates/Daily.md',
    folder: 'Templates',
    starred: false,
    tags: [],
    updated: '2026-04-15T12:00:00Z',
    words: 28,
  },
];

const FOLDERS = [
  { name: 'Daily', count: 14, expanded: false, children: ['daily-2026-05-07', 'daily-2026-05-06'] },
  { name: 'Ideas', count: 8, expanded: true, children: ['knowledge-management', 'zettelkasten-method'] },
  { name: 'Projects', count: 5, expanded: true, children: ['kryton-roadmap', 'meeting-design-review'] },
  { name: 'Templates', count: 2, expanded: false, children: ['tpl-meeting', 'tpl-daily'] },
];

const TAGS = [
  { name: 'project', count: 2 },
  { name: 'welcome', count: 1 },
  { name: 'getting-started', count: 1 },
  { name: 'roadmap', count: 1 },
  { name: 'ideas', count: 2 },
  { name: 'knowledge-management', count: 1 },
  { name: 'zettelkasten', count: 2 },
  { name: 'meeting', count: 1 },
  { name: 'daily', count: 14 },
  { name: 'feature', count: 3 },
  { name: 'ai', count: 1 },
];

/* Pre-laid-out graph (positions are 0..1 normalized) */
const GRAPH = {
  nodes: [
    { id: 'welcome', x: 0.45, y: 0.50, r: 14, label: 'Welcome to Kryton' },
    { id: 'kryton-roadmap', x: 0.22, y: 0.30, r: 9, label: 'Kryton Roadmap' },
    { id: 'knowledge-management', x: 0.72, y: 0.32, r: 11, label: 'Knowledge Management' },
    { id: 'zettelkasten-method', x: 0.86, y: 0.55, r: 7, label: 'Zettelkasten Method' },
    { id: 'graph-view', x: 0.55, y: 0.78, r: 7, label: 'Graph View' },
    { id: 'wiki-links', x: 0.30, y: 0.72, r: 7, label: 'Wiki-links' },
    { id: 'mcp-server', x: 0.18, y: 0.58, r: 9, label: 'MCP Server' },
    { id: 'daily-2026-05-07', x: 0.62, y: 0.20, r: 6, label: 'Daily 05-07' },
    { id: 'meeting-design-review', x: 0.10, y: 0.18, r: 6, label: 'Design Review' },
  ],
  edges: [
    ['welcome', 'graph-view'],
    ['welcome', 'wiki-links'],
    ['welcome', 'mcp-server'],
    ['welcome', 'kryton-roadmap'],
    ['welcome', 'daily-2026-05-07'],
    ['kryton-roadmap', 'knowledge-management'],
    ['kryton-roadmap', 'mcp-server'],
    ['knowledge-management', 'zettelkasten-method'],
    ['knowledge-management', 'graph-view'],
    ['kryton-roadmap', 'meeting-design-review'],
  ],
};

window.K_DATA = { NOTES, FOLDERS, TAGS, GRAPH };
