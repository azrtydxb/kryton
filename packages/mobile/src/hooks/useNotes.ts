import { useState, useEffect, useCallback } from "react";
import { database } from "../db";
import Note from "../db/models/Note";

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

function noteToRecord(note: Note): NoteRecord {
  return {
    id: note.id,
    path: note.path,
    title: note.title,
    content: note.content,
    tags: note.tags,
    modifiedAt: note.modifiedAt,
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

  useEffect(() => {
    const collection = database.get<Note>("notes");
    const subscription = collection.query().observe().subscribe((records) => {
      setNotes(records.map(noteToRecord));
      setIsLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const createNote = useCallback(async (path: string, content = "") => {
    const collection = database.get<Note>("notes");
    const title = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
    await database.write(async () => {
      await collection.create((note) => {
        note.path = path;
        note.title = title;
        note.content = content;
        note.tags = "[]";
      });
    });
  }, []);

  const deleteNote = useCallback(async (path: string) => {
    const collection = database.get<Note>("notes");
    const results = await collection.query().fetch();
    const target = results.find((n) => n.path === path);
    if (target) {
      await database.write(async () => {
        await target.destroyPermanently();
      });
    }
  }, []);

  const updateNote = useCallback(async (path: string, content: string) => {
    const collection = database.get<Note>("notes");
    const results = await collection.query().fetch();
    const target = results.find((n) => n.path === path);
    if (target) {
      await database.write(async () => {
        await target.update((note) => {
          note.content = content;
        });
      });
    }
  }, []);

  const tree = buildTree(notes);

  return { notes, tree, isLoading, createNote, deleteNote, updateNote };
}
