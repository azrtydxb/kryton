import * as path from "path";
import * as fs from "fs/promises";
import { indexNote } from "./searchService";
import { updateGraphCache } from "./graphService";
import { createLogger } from "../lib/logger.js";

const log = createLogger("user-notes");

// Accepts both UUIDs and better-auth's alphanumeric IDs
const SAFE_USER_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * SAMPLE_NOTES — default notes provisioned for every new user.
 * Moved here from index.ts so that provisionUserNotes can reuse them.
 */
export const SAMPLE_NOTES: Record<string, string> = {
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
 * Return the per-user notes directory, creating it if it does not exist.
 * Validates that userId looks like a UUID (defense in depth).
 */
export async function getUserNotesDir(
  baseDir: string,
  userId: string,
): Promise<string> {
  if (!SAFE_USER_ID_REGEX.test(userId)) throw new Error("Invalid userId format");
  const dir = path.join(baseDir, userId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Provision a brand-new user directory with the default sample notes.
 * Writes all SAMPLE_NOTES into notes/{userId}/ and indexes them for
 * search and graph so they are immediately available.
 */
export async function provisionUserNotes(
  baseDir: string,
  userId: string,
): Promise<void> {
  const userDir = await getUserNotesDir(baseDir, userId);

  // If the directory already has files, skip provisioning.
  const entries = await fs.readdir(userDir);
  if (entries.length > 0) {
    log.info(`User directory already populated for ${userId}, skipping provisioning.`);
    return;
  }

  log.info(`Provisioning sample notes for user ${userId}...`);
  for (const [relativePath, content] of Object.entries(SAMPLE_NOTES)) {
    const fullPath = path.join(userDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    // Index each note for search and graph
    await indexNote(relativePath, content, userId);
    await updateGraphCache(relativePath, content, userId);
  }
}

/**
 * Move any non-UUID entries in the notes base directory to a backup folder.
 * This cleans up legacy single-user note files that existed before
 * per-user isolation was introduced.
 */
export async function cleanupOldNotes(baseDir: string): Promise<void> {
  const entries = await fs.readdir(baseDir).catch(() => []);
  const nonUuid = entries.filter(
    (e) => !SAFE_USER_ID_REGEX.test(e) && e !== ".backup-pre-multiuser",
  );
  if (nonUuid.length === 0) return;

  const backupDir = path.join(baseDir, ".backup-pre-multiuser");
  await fs.mkdir(backupDir, { recursive: true });
  log.warn(`Moving ${nonUuid.length} old files to ${backupDir}`);
  for (const entry of nonUuid) {
    await fs.rename(
      path.join(baseDir, entry),
      path.join(backupDir, entry),
    ).catch((err) => {
      log.error(`Failed to move ${entry}:`, err);
    });
  }
}
