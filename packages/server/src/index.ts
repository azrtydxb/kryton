import "reflect-metadata";
import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import * as path from "path";
import * as fs from "fs/promises";
import { AppDataSource } from "./data-source";
import { swaggerSpec } from "./swagger";
import { authMiddleware, adminMiddleware, csrfCheck } from "./middleware/auth";
import { createAuthRouter } from "./routes/auth";
import { createAdminRouter } from "./routes/admin";
import { createNotesRouter, createNotesRenameRouter } from "./routes/notes";
import { createFoldersRouter, createFoldersRenameRouter } from "./routes/folders";
import { createSearchRouter } from "./routes/search";
import { createGraphRouter } from "./routes/graph";
import { createSettingsRouter } from "./routes/settings";
import { createBacklinksRouter } from "./routes/backlinks";
import { createTagsRouter } from "./routes/tags";
import { createDailyRouter } from "./routes/daily";
import { createTemplatesRouter } from "./routes/templates";
import { createCanvasRouter } from "./routes/canvas";
// indexUserNotes is called per-user during provisioning, not at startup
// import { indexUserNotes } from "./services/noteService";

const PORT = parseInt(process.env.PORT || "3001", 10);
const NOTES_DIR = path.resolve(
  process.env.NOTES_DIR || path.join(__dirname, "../../notes")
);

const SAMPLE_NOTES: Record<string, string> = {
  "Welcome.md": `# Welcome to Mnemo

Mnemo is your personal knowledge base. Write notes in **Markdown**, link them with [[wiki-links]], and explore your knowledge graph.

## Getting Started

- Create new notes using the sidebar
- Use \`[[double brackets]]\` to link between notes
- Toggle between editor and preview modes
- Try the [[Graph View]] to visualize connections
- Use the search bar to find anything

## Features

- **Markdown Editor** with syntax highlighting
- **Live Preview** rendering
- **Wiki-style Linking** with \`[[note name]]\`
- **Full-text Search** across all notes
- **Graph View** showing connections
- **Dark/Light Mode** following system preference

Check out the [[Projects/Mnemo Roadmap]] for what's coming next!

#welcome #getting-started
`,

  "Projects/Mnemo Roadmap.md": `# Mnemo Roadmap

## Current Version (MVP)

- [x] File tree sidebar
- [x] Markdown editor with CodeMirror 6
- [x] Live preview
- [x] Wiki-style linking
- [x] Full-text search
- [x] Graph view
- [x] Dark/light mode

## Future Plans

- [ ] Backlinks panel
- [ ] Daily notes
- [ ] Templates
- [ ] PDF export
- [ ] Collaboration features

See [[Welcome]] for an overview of the current features.

Related: [[Ideas/Knowledge Management]]

#project #roadmap
`,

  "Ideas/Knowledge Management.md": `# Knowledge Management

Notes on building a second brain and personal knowledge management systems.

## Key Principles

1. **Capture** — Write everything down
2. **Connect** — Link related ideas with [[wiki-links]]
3. **Create** — Use your notes to produce new work

## Tools Landscape

The space includes tools like:
- Obsidian (local-first, plugin ecosystem)
- Notion (cloud-based, collaborative)
- Roam Research (graph-first)
- **Mnemo** (self-hosted, open source) — see [[Welcome]]

## The Zettelkasten Method

The idea of atomic, interlinked notes goes back to Niklas Luhmann's Zettelkasten.
Each note should be:
- **Atomic** — One idea per note
- **Autonomous** — Understandable on its own
- **Connected** — Linked to related notes

See the [[Projects/Mnemo Roadmap]] for how we're building this into Mnemo.

#ideas #knowledge-management #zettelkasten
`,

  "Templates/Meeting Notes.md": `# {{title}}

## Date
{{date}}

## Attendees
-

## Agenda
1.

## Notes


## Action Items
- [ ]

#meeting
`,

  "Templates/Project.md": `# {{title}}

## Overview


## Goals
- [ ]

## Timeline


## Resources
-

## Notes


#project
`,

  "Daily/2026-03-23.md": `# Daily Note — 2026-03-23

## Tasks
- [x] Set up Mnemo development environment
- [x] Review the [[Projects/Mnemo Roadmap]]
- [ ] Explore [[Ideas/Knowledge Management]] concepts

## Notes
Started working with Mnemo today. The [[wiki-links]] make it easy to connect ideas across notes.

## Links
- [[Welcome]] — Getting started guide
- [[Projects/Mnemo Roadmap]] — What's planned

#daily
`,
};

/**
 * Create sample notes if the notes directory is empty.
 */
async function createSampleNotes(): Promise<void> {
  await fs.mkdir(NOTES_DIR, { recursive: true });

  const entries = await fs.readdir(NOTES_DIR);
  if (entries.length > 0) {
    console.log("Notes directory is not empty, skipping sample notes creation.");
    return;
  }

  console.log("Creating sample notes...");
  for (const [relativePath, content] of Object.entries(SAMPLE_NOTES)) {
    const fullPath = path.join(NOTES_DIR, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    console.log(`  Created: ${relativePath}`);
  }
  console.log("Sample notes created.");
}

async function main(): Promise<void> {
  // Initialize the database
  try {
    await AppDataSource.initialize();
    console.log("Database connection established.");
  } catch (err) {
    console.error("Failed to connect to database:", err);
    process.exit(1);
  }

  // Create notes directory and sample notes if needed
  await createSampleNotes();

  // Note: per-user indexing is now handled during provisioning and login.
  // The old global indexAllNotes() call has been removed.
  console.log("Startup complete — per-user notes are indexed on demand.");

  // Create Express app
  const app = express();

  // Middleware
  app.use(cors({
    origin: process.env.APP_URL || "http://localhost:5173",
    credentials: true,
  }));
  app.use(express.json());
  app.use(cookieParser());

  // Auth routes (unauthenticated, no CSRF)
  app.use("/api/auth", createAuthRouter());

  // Swagger API docs (unauthenticated, GET-only)
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Mnemo API Docs',
  }));
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

  /**
   * @swagger
   * /health:
   *   get:
   *     summary: Health check
   *     tags: [Health]
   *     responses:
   *       200:
   *         description: Server is healthy
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: ok
   *                 notesDir:
   *                   type: string
   *                   example: /path/to/notes
   */
  // Health check (unauthenticated, GET-only)
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", notesDir: NOTES_DIR });
  });

  // CSRF protection for all remaining routes
  app.use(csrfCheck);

  // Admin routes (auth + admin middleware)
  app.use("/api/admin", authMiddleware, adminMiddleware, createAdminRouter());

  // Protected routes (auth middleware)
  app.use("/api/notes", authMiddleware, createNotesRouter(NOTES_DIR));
  app.use("/api/notes-rename", authMiddleware, createNotesRenameRouter(NOTES_DIR));
  app.use("/api/folders", authMiddleware, createFoldersRouter(NOTES_DIR));
  app.use("/api/folders-rename", authMiddleware, createFoldersRenameRouter(NOTES_DIR));
  app.use("/api/search", authMiddleware, createSearchRouter());
  app.use("/api/graph", authMiddleware, createGraphRouter());
  app.use("/api/settings", authMiddleware, createSettingsRouter());
  app.use("/api/backlinks", authMiddleware, createBacklinksRouter());
  app.use("/api/tags", authMiddleware, createTagsRouter());
  app.use("/api/daily", authMiddleware, createDailyRouter(NOTES_DIR));
  app.use("/api/templates", authMiddleware, createTemplatesRouter(NOTES_DIR));
  app.use("/api/canvas", authMiddleware, createCanvasRouter(NOTES_DIR));

  /**
   * @swagger
   * /files/{path}:
   *   get:
   *     summary: Serve an image file from the notes directory
   *     tags: [Files]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Relative path to the image file within the notes directory
   *     responses:
   *       200:
   *         description: The image file
   *         content:
   *           image/*:
   *             schema:
   *               type: string
   *               format: binary
   *       403:
   *         description: File type not allowed
   *       404:
   *         description: File not found
   */
  // Serve image files from notes directory (protected)
  app.get("/api/files/{*path}", authMiddleware, async (req: Request, res: Response) => {
    const filePath = decodeURIComponent(Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path as string);
    const allowedExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"];
    const ext = path.extname(filePath).toLowerCase();

    if (!allowedExts.includes(ext)) {
      res.status(403).json({ error: "File type not allowed" });
      return;
    }

    const fullPath = path.resolve(path.join(NOTES_DIR, filePath));
    const resolvedBase = path.resolve(NOTES_DIR);
    if (!fullPath.startsWith(resolvedBase + path.sep) && fullPath !== resolvedBase) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }

    try {
      await fs.stat(fullPath);
      res.sendFile(fullPath);
    } catch {
      res.status(404).json({ error: "File not found" });
    }
  });

  // Serve static frontend in production
  const publicDir = path.join(__dirname, "../public");
  try {
    const stat = await fs.stat(publicDir);
    if (stat.isDirectory()) {
      app.use(express.static(publicDir));
      // SPA fallback: serve index.html for all non-API routes
      app.get("*", (_req, res) => {
        res.sendFile(path.join(publicDir, "index.html"));
      });
      console.log(`Serving static files from ${publicDir}`);
    }
  } catch {
    // No public directory — running in dev mode
  }

  // Start server
  app.listen(PORT, () => {
    console.log(`Mnemo server listening on port ${PORT}`);
    console.log(`Notes directory: ${NOTES_DIR}`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
