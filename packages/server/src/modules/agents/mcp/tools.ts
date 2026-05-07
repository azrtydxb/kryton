import * as path from "path";
import type { FastifyInstance } from "fastify";
import { validatePathWithinBase } from "../../../lib/pathUtils.js";

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
      const dailyPath = `daily/${format(new Date(), "yyyy-MM-dd")}.md`;
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
        return svc.scanDirectory(path.join(userDir, "templates"));
      } catch {
        return [];
      }
    }
    case "create_note_from_template": {
      const templateName = args.templateName as string;
      if (templateName.includes("/") || templateName.includes("\\") || templateName.includes("..")) {
        throw new Error("Invalid template name");
      }
      const templateContent = (await app.notes.readNote(`templates/${templateName}.md`, userId)) as { content: string };
      await app.notes.writeNote(args.notePath as string, templateContent.content, userId);
      return { success: true, path: args.notePath };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
