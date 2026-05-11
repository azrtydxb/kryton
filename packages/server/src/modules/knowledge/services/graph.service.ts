import type { FastifyInstance } from "fastify";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { getAccessibleSharedPaths } from "./share-paths.js";
import { graphEdge, searchIndex } from "../../../db/schema/notes.js";
import { noteShare } from "../../../db/schema/sharing.js";

const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;

/**
 * Extract [[wiki-links]] from markdown content.
 */
export function parseLinks(content: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = WIKI_LINK_REGEX.exec(content)) !== null) {
    links.push(match[1]);
  }
  return links;
}

function linkToPath(link: string): string {
  if (link.endsWith(".md")) return link;
  return `${link}.md`;
}

function noteIdFromPath(notePath: string): string {
  return notePath.replace(/\.md$/, "");
}

export interface GraphNode {
  id: string;
  path: string;
  title: string;
  shared?: boolean;
  ownerUserId?: string;
}

export interface GraphEdge {
  fromNoteId: string;
  toNoteId: string;
  fromPath: string | null;
  toPath: string | null;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Knowledge graph service — wiki-link extraction, edge cache management,
 * backlinks, and full-graph traversal. Receives the Fastify instance via
 * constructor and uses `app.db` (Drizzle).
 */
export class GraphService {
  constructor(private readonly app: FastifyInstance) {}

  /**
   * Re-index the graph edges for a given note. Deletes old edges originating
   * from this note and inserts new ones based on the current content.
   */
  async updateGraphCache(
    notePath: string,
    content: string,
    userId: string,
  ): Promise<void> {
    const db = this.app.db;
    await db
      .delete(graphEdge)
      .where(and(eq(graphEdge.fromPath, notePath), eq(graphEdge.userId, userId)));

    const links = parseLinks(content);
    if (links.length === 0) return;

    const shortLinks = links.filter((link) => !link.includes("/"));
    const shortFilenames = shortLinks.map((link) =>
      link.endsWith(".md") ? link : `${link}.md`,
    );

    const resolvedRows =
      shortFilenames.length > 0
        ? await db.query.searchIndex.findMany({
            where: and(
              eq(searchIndex.userId, userId),
              or(
                ...shortFilenames.flatMap((filename) => [
                  eq(searchIndex.notePath, filename),
                  like(searchIndex.notePath, `%/${filename}`),
                ]),
              ),
            ),
            columns: { notePath: true },
          })
        : [];

    const resolvedMap = new Map<string, string>();
    for (const filename of shortFilenames) {
      const match = resolvedRows.find(
        (r) => r.notePath === filename || r.notePath.endsWith(`/${filename}`),
      );
      if (match) {
        resolvedMap.set(filename, match.notePath);
      }
    }

    const edges = links.map((link) => {
      let toPath = linkToPath(link);

      if (!link.includes("/")) {
        const filename = link.endsWith(".md") ? link : `${link}.md`;
        const resolved = resolvedMap.get(filename);
        if (resolved) {
          toPath = resolved;
        }
      }

      return {
        fromPath: notePath,
        toPath,
        fromNoteId: noteIdFromPath(notePath),
        toNoteId: noteIdFromPath(toPath),
        userId,
      };
    });

    await db.insert(graphEdge).values(edges);
  }

  async removeFromGraph(notePath: string, userId: string): Promise<void> {
    await this.app.db
      .delete(graphEdge)
      .where(
        and(
          eq(graphEdge.userId, userId),
          or(eq(graphEdge.fromPath, notePath), eq(graphEdge.toPath, notePath)),
        ),
      );
  }

  async renameInGraph(
    oldPath: string,
    newPath: string,
    userId: string,
  ): Promise<void> {
    const db = this.app.db;
    const newNoteId = noteIdFromPath(newPath);
    const oldNoteId = noteIdFromPath(oldPath);

    await db
      .update(graphEdge)
      .set({ fromPath: newPath, fromNoteId: newNoteId })
      .where(and(eq(graphEdge.fromPath, oldPath), eq(graphEdge.userId, userId)));

    await db
      .update(graphEdge)
      .set({ toPath: newPath, toNoteId: newNoteId })
      .where(and(eq(graphEdge.toPath, oldPath), eq(graphEdge.userId, userId)));

    await db
      .update(graphEdge)
      .set({ toNoteId: newNoteId })
      .where(
        and(eq(graphEdge.toNoteId, oldNoteId), eq(graphEdge.userId, userId)),
      );
  }

  /**
   * Get all notes that link TO the given note (backlinks).
   */
  async getBacklinks(
    notePath: string,
    userId: string,
  ): Promise<{ path: string; title: string }[]> {
    const db = this.app.db;
    const noteId = noteIdFromPath(notePath);

    const edges = await db.query.graphEdge.findMany({
      where: eq(graphEdge.toNoteId, noteId),
    });
    if (edges.length === 0) return [];

    const sharesWithMe = await db.query.noteShare.findMany({
      where: eq(noteShare.sharedWithUserId, userId),
    });

    const fileShareSet = new Set<string>();
    const folderShares: { ownerUserId: string; path: string }[] = [];
    for (const s of sharesWithMe) {
      if (s.isFolder) {
        folderShares.push({ ownerUserId: s.ownerUserId, path: s.path });
      } else {
        fileShareSet.add(`${s.ownerUserId}:${s.path}`);
      }
    }

    const canReadShared = (ownerUserId: string, edgePath: string): boolean => {
      if (fileShareSet.has(`${ownerUserId}:${edgePath}`)) return true;
      return folderShares.some(
        (fs) =>
          fs.ownerUserId === ownerUserId &&
          (edgePath === fs.path || edgePath.startsWith(fs.path + "/")),
      );
    };

    const accessibleEdges = edges.filter(
      (edge) =>
        edge.userId === userId || canReadShared(edge.userId, edge.fromPath),
    );

    if (accessibleEdges.length === 0) return [];

    const lookupConditions = accessibleEdges.map((e) =>
      and(eq(searchIndex.notePath, e.fromPath), eq(searchIndex.userId, e.userId)),
    );

    const notes = await db.query.searchIndex.findMany({
      where: or(...lookupConditions),
      columns: { notePath: true, title: true },
    });

    const seen = new Set<string>();
    return notes
      .filter((n) => {
        if (seen.has(n.notePath)) return false;
        seen.add(n.notePath);
        return true;
      })
      .map((n) => ({ path: n.notePath, title: n.title }));
  }

  async getFullGraph(userId: string): Promise<GraphData> {
    const db = this.app.db;
    const [allNotes, allEdges, sharedPaths] = await Promise.all([
      db.query.searchIndex.findMany({ where: eq(searchIndex.userId, userId) }),
      db.query.graphEdge.findMany({ where: eq(graphEdge.userId, userId) }),
      getAccessibleSharedPaths(this.app, userId),
    ]);

    const nodes: GraphNode[] = allNotes.map((note) => ({
      id: noteIdFromPath(note.notePath),
      path: note.notePath,
      title: note.title,
    }));

    const ownNodeIds = new Set(nodes.map((n) => n.id));

    const sharedNoteRows =
      sharedPaths.length > 0
        ? await db.query.searchIndex.findMany({
            where: or(
              ...sharedPaths.map((sp) =>
                and(
                  eq(searchIndex.notePath, sp.notePath),
                  eq(searchIndex.userId, sp.ownerUserId),
                ),
              ),
            ),
            columns: { notePath: true, title: true, userId: true },
          })
        : [];

    const sharedRowMap = new Map(
      sharedNoteRows.map((r) => [`${r.userId}:${r.notePath}`, r]),
    );

    const sharedNoteEntries = sharedPaths.map((sp) => {
      const note = sharedRowMap.get(`${sp.ownerUserId}:${sp.notePath}`);
      return note ? { note, ownerUserId: sp.ownerUserId } : null;
    });

    const ownerNoteIdToNamespaced = new Map<string, string>();

    for (const entry of sharedNoteEntries) {
      if (!entry) continue;
      const rawId = noteIdFromPath(entry.note.notePath);
      const namespacedId = `${entry.ownerUserId}:${entry.note.notePath}`;

      if (ownNodeIds.has(rawId)) continue;

      ownerNoteIdToNamespaced.set(`${entry.ownerUserId}:${rawId}`, namespacedId);

      nodes.push({
        id: namespacedId,
        path: entry.note.notePath,
        title: entry.note.title,
        shared: true,
        ownerUserId: entry.ownerUserId,
      });
    }

    const accessibleIds = new Set(nodes.map((n) => n.id));

    const ownerIds = [...new Set(sharedPaths.map((sp) => sp.ownerUserId))];
    const sharedEdges =
      ownerIds.length > 0
        ? await db.query.graphEdge.findMany({
            where: inArray(graphEdge.userId, ownerIds),
          })
        : [];

    const resolveId = (rawNoteId: string, ownerId: string): string | null => {
      if (ownNodeIds.has(rawNoteId)) return rawNoteId;
      const namespaced = ownerNoteIdToNamespaced.get(`${ownerId}:${rawNoteId}`);
      if (namespaced) return namespaced;
      return null;
    };

    const edges: { fromNoteId: string; toNoteId: string }[] = [];
    const edgeSeen = new Set<string>();

    for (const e of allEdges) {
      if (accessibleIds.has(e.fromNoteId) && accessibleIds.has(e.toNoteId)) {
        const key = `${e.fromNoteId}->${e.toNoteId}`;
        if (!edgeSeen.has(key)) {
          edgeSeen.add(key);
          edges.push({ fromNoteId: e.fromNoteId, toNoteId: e.toNoteId });
        }
      }
    }

    for (const e of sharedEdges) {
      const from = resolveId(e.fromNoteId, e.userId);
      const to = resolveId(e.toNoteId, e.userId);
      if (from && to && accessibleIds.has(from) && accessibleIds.has(to)) {
        const key = `${from}->${to}`;
        if (!edgeSeen.has(key)) {
          edgeSeen.add(key);
          edges.push({ fromNoteId: from, toNoteId: to });
        }
      }
    }

    const nodeIdToPath = new Map<string, string>(
      nodes.map((n) => [n.id, n.path]),
    );

    const enrichedEdges: GraphEdge[] = edges.map((e) => ({
      ...e,
      fromPath: nodeIdToPath.get(e.fromNoteId) ?? null,
      toPath: nodeIdToPath.get(e.toNoteId) ?? null,
    }));

    return { nodes, edges: enrichedEdges };
  }
}
