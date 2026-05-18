import * as path from "path";
import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { validatePathWithinBase } from "../../../lib/pathUtils.js";
import { settings } from "../../../db/schema/settings.js";

const STARRED_KEY = "starred";

async function readStarred(app: FastifyInstance, userId: string): Promise<string[]> {
  const row = await app.db.query.settings.findFirst({
    where: and(eq(settings.userId, userId), eq(settings.key, STARRED_KEY)),
  });
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

async function writeStarred(
  app: FastifyInstance,
  userId: string,
  paths: string[],
): Promise<void> {
  const value = JSON.stringify(paths);
  await app.db
    .insert(settings)
    .values({ key: STARRED_KEY, userId, value })
    .onConflictDoUpdate({
      target: [settings.key, settings.userId],
      set: { value, updatedAt: new Date() },
    });
}

// Rewrite favorites after a rename so stars follow the note/folder
// to its new location instead of being orphaned.
async function rewriteStarred(
  app: FastifyInstance,
  userId: string,
  rewrite: (p: string) => string | null,
): Promise<void> {
  const current = await readStarred(app, userId);
  let changed = false;
  const next: string[] = [];
  for (const p of current) {
    const mapped = rewrite(p);
    if (mapped === null) {
      changed = true;
      continue;
    }
    if (mapped !== p) changed = true;
    next.push(mapped);
  }
  if (changed) await writeStarred(app, userId, next);
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: "read-only" | "read-write";
}

export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_notes",
      description: "List all notes in the knowledge base. Returns paths and titles.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "read_note",
      description: "Read a note's markdown content by its path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note path relative to notes root (e.g. 'folder/my-note.md')" },
        },
        required: ["path"],
      },
      scope: "read-only",
    },
    {
      name: "create_note",
      description: "Create a new markdown note.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path for the new note (e.g. 'folder/new-note.md')" },
          content: { type: "string", description: "Markdown content for the note" },
        },
        required: ["path", "content"],
      },
      scope: "read-write",
    },
    {
      name: "update_note",
      description: "Update a note's content (full replacement). Read the note first to get current content.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the note to update" },
          content: { type: "string", description: "New markdown content (replaces entire note)" },
        },
        required: ["path", "content"],
      },
      scope: "read-write",
    },
    {
      name: "delete_note",
      description: "Delete a note by its path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the note to delete" },
        },
        required: ["path"],
      },
      scope: "read-write",
    },
    {
      name: "search",
      description: "Full-text search across all notes. Returns matching paths, titles, and snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query string" },
        },
        required: ["query"],
      },
      scope: "read-only",
    },
    {
      name: "list_tags",
      description: "List all tags used across notes with their counts.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "get_backlinks",
      description: "Get all notes that contain wiki-links pointing to the given path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the note to find backlinks for" },
        },
        required: ["path"],
      },
      scope: "read-only",
    },
    {
      name: "get_graph",
      description: "Get the full wiki-link graph with nodes (notes) and edges (links between them).",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "list_folders",
      description: "List the folder structure of the knowledge base.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "create_folder",
      description: "Create a new folder in the knowledge base.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path for the new folder (e.g. 'projects/new-folder')" },
        },
        required: ["path"],
      },
      scope: "read-write",
    },
    {
      name: "get_daily_note",
      description: "Get today's daily note. Returns the note content if it exists, or indicates it doesn't exist yet.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "list_templates",
      description: "List available note templates.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "create_note_from_template",
      description: "Create a new note from an existing template.",
      inputSchema: {
        type: "object",
        properties: {
          templateName: { type: "string", description: "Name of the template to use" },
          notePath: { type: "string", description: "Path for the new note" },
        },
        required: ["templateName", "notePath"],
      },
      scope: "read-write",
    },
    {
      name: "rename_note",
      description: "Rename or move a note. Updates wiki-links + tag/search indexes atomically.",
      inputSchema: {
        type: "object",
        properties: {
          oldPath: { type: "string", description: "Current note path (e.g. 'folder/old-name.md')" },
          newPath: { type: "string", description: "New note path (e.g. 'folder/new-name.md' or 'other/folder/old-name.md')" },
        },
        required: ["oldPath", "newPath"],
      },
      scope: "read-write",
    },
    {
      name: "append_to_note",
      description: "Append markdown content to the end of an existing note. Adds a leading blank line if the note doesn't end in one.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note path to append to" },
          content: { type: "string", description: "Markdown content to append" },
        },
        required: ["path", "content"],
      },
      scope: "read-write",
    },
    {
      name: "list_notes_by_tag",
      description: "List notes that contain a given tag. Returns paths + titles.",
      inputSchema: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Tag name without the leading '#' (e.g. 'project', 'idea')" },
        },
        required: ["tag"],
      },
      scope: "read-only",
    },
    {
      name: "write_daily_note",
      description: "Create or replace today's daily note (at Daily/YYYY-MM-DD.md). Use append_to_note instead if you want to add to existing content without overwriting.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "Full markdown content for today's daily note" },
        },
        required: ["content"],
      },
      scope: "read-write",
    },
    {
      name: "list_favorites",
      description: "List the paths of notes the user has starred / favorited.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "add_favorite",
      description: "Star a note (add it to favorites). No-op if already favorited.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note path to favorite (e.g. 'folder/my-note.md')" },
        },
        required: ["path"],
      },
      scope: "read-write",
    },
    {
      name: "remove_favorite",
      description: "Unstar a note. No-op if not currently favorited.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note path to unfavorite" },
        },
        required: ["path"],
      },
      scope: "read-write",
    },
    {
      name: "list_recent_notes",
      description: "List notes sorted by most-recently-modified first. Useful for 'what was I working on' queries.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max notes to return (default 20)" },
        },
        required: [],
      },
      scope: "read-only",
    },
    {
      name: "get_note_metadata",
      description: "Get a note's title + modifiedAt + size without pulling the full content. Cheap discovery.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note path" },
        },
        required: ["path"],
      },
      scope: "read-only",
    },
    {
      name: "list_daily_notes",
      description: "List all daily notes (Daily/YYYY-MM-DD.md), newest first.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max daily notes to return (default 30)" },
        },
        required: [],
      },
      scope: "read-only",
    },
    {
      name: "list_trash",
      description: "List notes currently in trash.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "restore_from_trash",
      description: "Restore a previously-deleted note from trash back to its original location.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note path as it appears in list_trash" },
        },
        required: ["path"],
      },
      scope: "read-write",
    },
    {
      name: "empty_trash",
      description: "Permanently delete every note currently in trash. NOT REVERSIBLE.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-write",
    },
    {
      name: "rename_folder",
      description: "Rename or move a folder. All notes inside move with it; wiki-links update.",
      inputSchema: {
        type: "object",
        properties: {
          oldPath: { type: "string", description: "Current folder path (e.g. 'projects/old-name')" },
          newPath: { type: "string", description: "New folder path" },
        },
        required: ["oldPath", "newPath"],
      },
      scope: "read-write",
    },
    {
      name: "delete_folder",
      description: "Delete an empty folder. Use trash for notes; deleting a non-empty folder fails.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Folder path to delete" },
        },
        required: ["path"],
      },
      scope: "read-write",
    },
    {
      name: "list_shares",
      description: "List shares the current user owns (notes they've shared with others).",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "list_shares_with_me",
      description: "List notes other users have shared with the current user.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "share_note",
      description: "Share a note (or folder) with another user by their user id. Permission is 'read' or 'readwrite'.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note or folder path to share" },
          sharedWithUserId: { type: "string", description: "Recipient's user id" },
          permission: { type: "string", description: "'read' or 'readwrite'" },
          isFolder: { type: "boolean", description: "True if sharing a folder (default false)" },
        },
        required: ["path", "sharedWithUserId", "permission"],
      },
      scope: "read-write",
    },
    {
      name: "unshare_note",
      description: "Revoke an existing share by its id (get the id from list_shares).",
      inputSchema: {
        type: "object",
        properties: {
          shareId: { type: "string", description: "Share id returned by list_shares" },
        },
        required: ["shareId"],
      },
      scope: "read-write",
    },
  ];
}

interface FolderNode {
  type: string;
  name: string;
  children?: FolderNode[];
}

export async function executeTool(
  app: FastifyInstance,
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<unknown> {
  switch (toolName) {
    case "list_notes":
      return app.notes.scanDirectory(userId);
    case "read_note":
      return app.notes.readNote(args.path as string, userId);
    case "create_note":
      await app.notes.writeNote(args.path as string, args.content as string, userId);
      return { success: true, path: args.path };
    case "update_note":
      await app.notes.writeNote(args.path as string, args.content as string, userId);
      return { success: true, path: args.path };
    case "delete_note":
      await app.notes.deleteNote(args.path as string, userId);
      return { success: true, path: args.path };
    case "search":
      return app.knowledge.search(args.query as string, userId);
    case "list_tags":
      return app.knowledge.getAllTags(userId);
    case "get_backlinks":
      return app.knowledge.getBacklinks(args.path as string, userId);
    case "get_graph":
      return app.knowledge.getFullGraph(userId);
    case "list_folders": {
      const tree = (await app.notes.scanDirectory(userId)) as FolderNode[];
      const filterFolders = (nodes: FolderNode[]): FolderNode[] =>
        nodes
          .filter((n) => n.type === "folder")
          .map((n) => ({ ...n, children: n.children ? filterFolders(n.children) : undefined }));
      return filterFolders(tree);
    }
    case "create_folder": {
      const userDir = await app.notes.getUserNotesDir(userId);
      const folderPath = path.join(userDir, args.path as string);
      validatePathWithinBase(folderPath, userDir);
      const { mkdir } = await import("fs/promises");
      await mkdir(folderPath, { recursive: true });
      return { success: true, path: args.path };
    }
    case "get_daily_note": {
      const { format } = await import("date-fns");
      const dailyPath = `Daily/${format(new Date(), "yyyy-MM-dd")}.md`;
      try {
        return await app.notes.readNote(dailyPath, userId);
      } catch {
        return { exists: false, expectedPath: dailyPath };
      }
    }
    case "list_templates": {
      const userDir = await app.notes.getUserNotesDir(userId);
      try {
        const noteSvc = await import("../../notes/services/note.service.js");
        const svc = new noteSvc.NoteService(app);
        // Must `await` so the ENOENT rejection from a missing
        // Templates/ folder lands in this catch — `return svc.…`
        // hands an unresolved promise back to the caller and the
        // rejection escapes the try/catch.
        return await svc.scanDirectory(path.join(userDir, "Templates"));
      } catch {
        return [];
      }
    }
    case "create_note_from_template": {
      const templateName = args.templateName as string;
      if (templateName.includes("/") || templateName.includes("\\") || templateName.includes("..")) {
        throw new Error("Invalid template name");
      }
      const templateContent = (await app.notes.readNote(`Templates/${templateName}.md`, userId)) as { content: string };
      await app.notes.writeNote(args.notePath as string, templateContent.content, userId);
      return { success: true, path: args.notePath };
    }
    case "rename_note": {
      const oldPath = args.oldPath as string;
      const newPath = args.newPath as string;
      if (!oldPath || !newPath) throw new Error("oldPath and newPath are required");
      const userDir = await app.notes.getUserNotesDir(userId);
      // Use the rename service from the notes module if exposed; fall
      // back to a copy+delete pair if not. NoteService.renameNote is
      // the canonical entry point.
      const noteSvc = await import("../../notes/services/note.service.js");
      const svc = new noteSvc.NoteService(app);
      const oldFull = oldPath.endsWith(".md") ? oldPath : oldPath + ".md";
      const newFull = newPath.endsWith(".md") ? newPath : newPath + ".md";
      await svc.renameNote(userDir, oldFull, newFull, userId);
      await rewriteStarred(app, userId, (p) => (p === oldFull ? newFull : p));
      return { success: true, oldPath: oldFull, newPath: newFull };
    }
    case "append_to_note": {
      const p = args.path as string;
      const appended = args.content as string;
      if (!p || appended === undefined) throw new Error("path and content are required");
      const existing = (await app.notes.readNote(p, userId)) as { content: string };
      const sep = existing.content.endsWith("\n\n")
        ? ""
        : existing.content.endsWith("\n")
          ? "\n"
          : "\n\n";
      await app.notes.writeNote(p, existing.content + sep + appended, userId);
      return { success: true, path: p };
    }
    case "list_notes_by_tag": {
      const tag = args.tag as string;
      if (!tag) throw new Error("tag is required");
      const rows = await app.knowledge.getNotesByTag(tag, userId);
      return rows;
    }
    case "write_daily_note": {
      const content = args.content as string;
      if (content === undefined) throw new Error("content is required");
      const today = new Date();
      const yyyy = today.getUTCFullYear();
      const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(today.getUTCDate()).padStart(2, "0");
      const dailyPath = `Daily/${yyyy}-${mm}-${dd}.md`;
      await app.notes.writeNote(dailyPath, content, userId);
      return { success: true, path: dailyPath };
    }
    case "list_favorites": {
      const paths = await readStarred(app, userId);
      return { paths };
    }
    case "add_favorite": {
      const p = args.path as string;
      if (!p) throw new Error("path is required");
      const current = await readStarred(app, userId);
      if (current.includes(p)) {
        return { success: true, path: p, alreadyFavorited: true };
      }
      await writeStarred(app, userId, [...current, p]);
      return { success: true, path: p };
    }
    case "remove_favorite": {
      const p = args.path as string;
      if (!p) throw new Error("path is required");
      const current = await readStarred(app, userId);
      const next = current.filter((x) => x !== p);
      if (next.length === current.length) {
        return { success: true, path: p, wasFavorited: false };
      }
      await writeStarred(app, userId, next);
      return { success: true, path: p };
    }
    case "list_recent_notes": {
      const limit = typeof args.limit === "number" ? args.limit : 20;
      const userDir = await app.notes.getUserNotesDir(userId);
      const noteSvc = await import("../../notes/services/note.service.js");
      const svc = new noteSvc.NoteService(app);
      const tree = await svc.scanDirectory(userDir);
      // Flatten the tree, collect files with modifiedAt, sort desc, slice.
      const files: { path: string; title: string; modifiedAt: string }[] = [];
      const walk = (nodes: unknown[]): void => {
        for (const raw of nodes) {
          const node = raw as { type?: string; name?: string; path?: string; title?: string; modifiedAt?: string; children?: unknown[] };
          if (node.type === "file" && node.path) {
            files.push({
              path: node.path,
              title: node.title ?? node.name ?? node.path,
              modifiedAt: node.modifiedAt ?? "",
            });
          }
          if (node.children) walk(node.children);
        }
      };
      walk(tree as unknown[]);
      files.sort((a, b) => (b.modifiedAt > a.modifiedAt ? 1 : -1));
      return files.slice(0, limit);
    }
    case "get_note_metadata": {
      const p = args.path as string;
      if (!p) throw new Error("path is required");
      const note = (await app.notes.readNote(p, userId)) as { content: string; modifiedAt: Date | string | null };
      // extractTitle may not be decorated on every deploy; fall back to
      // the first markdown H1 or the filename.
      const title =
        app.knowledge?.extractTitle?.(note.content, p) ??
        (note.content.match(/^#\s+(.+)$/m)?.[1] ?? p.replace(/\.md$/, ""));
      return {
        path: p,
        title,
        modifiedAt: note.modifiedAt,
        size: note.content.length,
        firstChars: note.content.slice(0, 200),
      };
    }
    case "list_daily_notes": {
      const limit = typeof args.limit === "number" ? args.limit : 30;
      const userDir = await app.notes.getUserNotesDir(userId);
      const noteSvc = await import("../../notes/services/note.service.js");
      const svc = new noteSvc.NoteService(app);
      let tree: unknown[];
      try {
        tree = (await svc.scanDirectory(path.join(userDir, "Daily"))) as unknown[];
      } catch {
        return [];
      }
      const files: { path: string; modifiedAt: string }[] = [];
      const walk = (nodes: unknown[]): void => {
        for (const raw of nodes) {
          const node = raw as { type?: string; path?: string; modifiedAt?: string; children?: unknown[] };
          if (node.type === "file" && node.path) {
            files.push({ path: node.path, modifiedAt: node.modifiedAt ?? "" });
          }
          if (node.children) walk(node.children);
        }
      };
      walk(tree);
      // Daily filenames sort naturally (YYYY-MM-DD), but also break ties by mtime.
      files.sort((a, b) => (b.path > a.path ? 1 : -1));
      return files.slice(0, limit);
    }
    case "list_trash":
      return app.trash.list(userId);
    case "restore_from_trash":
      return app.trash.restore(userId, args.path as string);
    case "empty_trash":
      await app.trash.emptyAll(userId);
      return { success: true };
    case "rename_folder": {
      const oldFolder = args.oldPath as string;
      const newFolder = args.newPath as string;
      const result = await app.folders.rename(userId, oldFolder, newFolder);
      const oldPrefix = oldFolder.endsWith("/") ? oldFolder : oldFolder + "/";
      const newPrefix = newFolder.endsWith("/") ? newFolder : newFolder + "/";
      await rewriteStarred(app, userId, (p) =>
        p.startsWith(oldPrefix) ? newPrefix + p.slice(oldPrefix.length) : p,
      );
      return result;
    }
    case "delete_folder":
      await app.folders.delete(userId, args.path as string);
      return { success: true };
    case "list_shares":
      return app.shares.listOwned(userId);
    case "list_shares_with_me":
      return app.shares.getSharedNotesForUser(userId);
    case "share_note": {
      const permission = args.permission as string;
      if (permission !== "read" && permission !== "readwrite") {
        throw new Error("permission must be 'read' or 'readwrite'");
      }
      return app.shares.create(userId, {
        path: args.path as string,
        sharedWithUserId: args.sharedWithUserId as string,
        permission,
        isFolder: args.isFolder === true,
      });
    }
    case "unshare_note":
      await app.shares.revoke(userId, args.shareId as string);
      return { success: true };
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
