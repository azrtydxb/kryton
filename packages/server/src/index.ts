import "reflect-metadata";
import express, { Request, Response } from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import * as path from "path";
import * as fs from "fs/promises";
import { AppDataSource } from "./data-source";
import { swaggerSpec } from "./swagger";
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
import { indexAllNotes } from "./services/noteService";

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

  // Index all existing notes on startup
  console.log("Indexing notes...");
  await indexAllNotes(NOTES_DIR);
  console.log("Indexing complete.");

  // Create Express app
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Swagger API docs
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Mnemo API Docs',
  }));
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

  // Routes
  app.use("/api/notes", createNotesRouter(NOTES_DIR));
  app.use("/api/notes-rename", createNotesRenameRouter(NOTES_DIR));
  app.use("/api/folders", createFoldersRouter(NOTES_DIR));
  app.use("/api/folders-rename", createFoldersRenameRouter(NOTES_DIR));
  app.use("/api/search", createSearchRouter());
  app.use("/api/graph", createGraphRouter());
  app.use("/api/settings", createSettingsRouter());
  app.use("/api/backlinks", createBacklinksRouter());
  app.use("/api/tags", createTagsRouter());
  app.use("/api/daily", createDailyRouter(NOTES_DIR));
  app.use("/api/templates", createTemplatesRouter(NOTES_DIR));
  app.use("/api/canvas", createCanvasRouter(NOTES_DIR));

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
  // Serve image files from notes directory
  app.get("/api/files/{*path}", async (req: Request, res: Response) => {
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
  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", notesDir: NOTES_DIR });
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
