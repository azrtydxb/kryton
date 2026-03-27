import { useState, useEffect, useCallback } from "react";
import { getDatabase, NoteRow } from "../db";

export interface NoteRecord {
  id: string;
  path: string;
  title: string;
  content: string;
  tags: string;
  modifiedAt: Date;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
}

function buildTree(notes: NoteRecord[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const note of notes) {
    const parts = note.path.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const existing = current.find((n) => n.name === part);

      if (isLast) {
        if (!existing) {
          current.push({
            name: part,
            path: note.path,
            type: "file",
          });
        }
      } else {
        if (existing && existing.type === "folder") {
          current = existing.children!;
        } else {
          const folderPath = parts.slice(0, i + 1).join("/");
          const folder: TreeNode = {
            name: part,
            path: folderPath,
            type: "folder",
            children: [],
          };
          current.push(folder);
          current = folder.children!;
        }
      }
    }
  }

  // Sort: folders first, then files, both alphabetically
  function sortNodes(nodes: TreeNode[]): TreeNode[] {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.type === "folder" && node.children) {
        sortNodes(node.children);
      }
    }
    return nodes;
  }

  return sortNodes(root);
}

function rowToRecord(row: NoteRow): NoteRecord {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    content: row.content,
    tags: row.tags,
    modifiedAt: new Date(row.modified_at),
  };
}

export interface UseNotesReturn {
  notes: NoteRecord[];
  tree: TreeNode[];
  isLoading: boolean;
  createNote: (path: string, content?: string) => Promise<void>;
  deleteNote: (path: string) => Promise<void>;
  updateNote: (path: string, content: string) => Promise<void>;
}

export function useNotes(): UseNotesReturn {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(() => {
    const db = getDatabase();
    const rows = db.getAllSync<NoteRow>(
      "SELECT * FROM notes WHERE _status != 'deleted' ORDER BY path"
    );
    setNotes(rows.map(rowToRecord));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createNote = useCallback(async (path: string, content = "") => {
    const db = getDatabase();
    const id = path; // Use path as ID
    const title =
      content.match(/^#\s+(.+)/m)?.[1] ||
      path.replace(/\.md$/, "").split("/").pop() ||
      "";
    db.runSync(
      "INSERT OR REPLACE INTO notes (id, path, title, content, tags, modified_at, _status, _changed) VALUES (?, ?, ?, ?, '[]', ?, 'created', 'path,title,content')",
      [id, path, title, content, Date.now()]
    );
    refresh();
  }, [refresh]);

  const updateNote = useCallback(async (path: string, content: string) => {
    const db = getDatabase();
    const title =
      content.match(/^#\s+(.+)/m)?.[1] ||
      path.replace(/\.md$/, "").split("/").pop() ||
      "";
    db.runSync(
      "UPDATE notes SET content = ?, title = ?, modified_at = ?, _status = CASE WHEN _status = 'created' THEN 'created' ELSE 'updated' END, _changed = 'content,title' WHERE id = ?",
      [content, title, Date.now(), path]
    );
    refresh();
  }, [refresh]);

  const deleteNote = useCallback(async (path: string) => {
    const db = getDatabase();
    db.runSync("UPDATE notes SET _status = 'deleted' WHERE id = ?", [path]);
    refresh();
  }, [refresh]);

  const tree = buildTree(notes);

  return { notes, tree, isLoading, createNote, deleteNote, updateNote };
}
