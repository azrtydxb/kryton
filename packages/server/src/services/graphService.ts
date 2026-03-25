import { prisma } from "../prisma.js";
import { getAccessibleSharedPaths } from "./shareService.js";

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

/**
 * Convert a link target (e.g. "Projects/Mnemo Roadmap") to a note path
 * relative to NOTES_DIR (e.g. "Projects/Mnemo Roadmap.md").
 */
function linkToPath(link: string): string {
  if (link.endsWith(".md")) {
    return link;
  }
  return `${link}.md`;
}

/**
 * Derive a stable noteId from a note path — just the path without .md extension.
 */
function noteIdFromPath(notePath: string): string {
  return notePath.replace(/\.md$/, "");
}

/**
 * Re-index the graph edges for a given note. Deletes old edges originating
 * from this note and inserts new ones based on the current content.
 */
export async function updateGraphCache(
  notePath: string,
  content: string,
  userId: string
): Promise<void> {
  // Remove existing edges from this note for this user
  await prisma.graphEdge.deleteMany({ where: { fromPath: notePath, userId } });

  const links = parseLinks(content);
  if (links.length === 0) return;

  const edges = links.map((link) => {
    const toPath = linkToPath(link);
    return {
      fromPath: notePath,
      toPath,
      fromNoteId: noteIdFromPath(notePath),
      toNoteId: noteIdFromPath(toPath),
      userId,
    };
  });

  await prisma.graphEdge.createMany({ data: edges });
}

/**
 * Remove all graph edges that reference the given note path (as source or target).
 */
export async function removeFromGraph(notePath: string, userId: string): Promise<void> {
  await prisma.graphEdge.deleteMany({ where: { fromPath: notePath, userId } });
  // We also remove edges pointing TO this note
  await prisma.graphEdge.deleteMany({ where: { toPath: notePath, userId } });
}

/**
 * Update graph edges when a note is renamed.
 */
export async function renameInGraph(
  oldPath: string,
  newPath: string,
  userId: string
): Promise<void> {
  const newNoteId = noteIdFromPath(newPath);
  const oldNoteId = noteIdFromPath(oldPath);

  // Update edges originating from the old path
  await prisma.graphEdge.updateMany({
    where: { fromPath: oldPath, userId },
    data: { fromPath: newPath, fromNoteId: newNoteId },
  });

  // Update edges pointing to the old path
  await prisma.graphEdge.updateMany({
    where: { toPath: oldPath, userId },
    data: { toPath: newPath, toNoteId: newNoteId },
  });

  // Also update edges that reference the old note id without .md
  await prisma.graphEdge.updateMany({
    where: { toNoteId: oldNoteId, userId },
    data: { toNoteId: newNoteId },
  });
}

export interface GraphNode {
  id: string;
  path: string;
  title: string;
  shared?: boolean;
  ownerUserId?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: { fromNoteId: string; toNoteId: string }[];
}

/**
 * Get all notes that link TO the given note (backlinks).
 */
export async function getBacklinks(
  notePath: string,
  userId: string
): Promise<{ path: string; title: string }[]> {
  const noteId = noteIdFromPath(notePath);

  // Find all edges pointing to this note across ALL users
  const edges = await prisma.graphEdge.findMany({ where: { toNoteId: noteId } });
  if (edges.length === 0) return [];

  // Pre-fetch all shares for this user to build an accessible set
  const sharesWithMe = await prisma.noteShare.findMany({
    where: { sharedWithUserId: userId },
  });

  // Build a fast access check: set of "ownerUserId:notePath" for file shares,
  // and a list of folder prefixes per owner
  const fileShareSet = new Set<string>();
  const folderShares: { ownerUserId: string; path: string }[] = [];
  for (const s of sharesWithMe) {
    if (s.isFolder) {
      folderShares.push({ ownerUserId: s.ownerUserId, path: s.path });
    } else {
      fileShareSet.add(`${s.ownerUserId}:${s.path}`);
    }
  }

  function canReadShared(ownerUserId: string, edgePath: string): boolean {
    if (fileShareSet.has(`${ownerUserId}:${edgePath}`)) return true;
    return folderShares.some(
      (fs) => fs.ownerUserId === ownerUserId && edgePath.startsWith(fs.path)
    );
  }

  // Determine which edges are accessible
  const accessibleEdges = edges.filter((edge) =>
    edge.userId === userId || canReadShared(edge.userId, edge.fromPath)
  );

  if (accessibleEdges.length === 0) return [];

  // Batch fetch all search index entries for accessible edges
  const lookupKeys = accessibleEdges.map((e) => ({
    notePath: e.fromPath,
    userId: e.userId,
  }));

  const notes = await prisma.searchIndex.findMany({
    where: {
      OR: lookupKeys,
    },
    select: { notePath: true, title: true },
  });

  // Deduplicate by path
  const seen = new Set<string>();
  return notes.filter((n) => {
    if (seen.has(n.notePath)) return false;
    seen.add(n.notePath);
    return true;
  }).map((n) => ({ path: n.notePath, title: n.title }));
}

export async function getFullGraph(userId: string): Promise<GraphData> {
  const [allNotes, allEdges, sharedPaths] = await Promise.all([
    prisma.searchIndex.findMany({ where: { userId } }),
    prisma.graphEdge.findMany({ where: { userId } }),
    getAccessibleSharedPaths(userId),
  ]);

  // --- Own nodes ---
  const nodes: GraphNode[] = allNotes.map((note) => ({
    id: noteIdFromPath(note.notePath),
    path: note.notePath,
    title: note.title,
  }));

  const ownNodeIds = new Set(nodes.map((n) => n.id));

  // --- Shared nodes ---
  // Batch fetch SearchIndex entries for all shared notes (instead of N findUnique calls)
  const sharedNoteLookups = sharedPaths.map((sp) => ({
    notePath: sp.notePath,
    userId: sp.ownerUserId,
  }));

  const sharedNoteRows = sharedNoteLookups.length > 0
    ? await prisma.searchIndex.findMany({
        where: { OR: sharedNoteLookups },
        select: { notePath: true, title: true, userId: true },
      })
    : [];

  // Map rows back to entries with ownerUserId
  const sharedRowMap = new Map(
    sharedNoteRows.map((r) => [`${r.userId}:${r.notePath}`, r])
  );

  const sharedNoteEntries = sharedPaths
    .map((sp) => {
      const note = sharedRowMap.get(`${sp.ownerUserId}:${sp.notePath}`);
      return note ? { note, ownerUserId: sp.ownerUserId } : null;
    });

  // Build a lookup from owner's noteId to namespaced id
  const ownerNoteIdToNamespaced = new Map<string, string>();

  for (const entry of sharedNoteEntries) {
    if (!entry) continue;
    const rawId = noteIdFromPath(entry.note.notePath);
    const namespacedId = `${entry.ownerUserId}:${entry.note.notePath}`;

    // Skip if this note already exists as the user's own note
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

  // --- Accessible set (all node IDs the viewer can see) ---
  const accessibleIds = new Set(nodes.map((n) => n.id));

  // --- Shared edges (from owners' data) ---
  const ownerIds = [...new Set(sharedPaths.map((sp) => sp.ownerUserId))];
  const sharedEdges: typeof allEdges = [];
  for (const ownerId of ownerIds) {
    const ownerEdges = await prisma.graphEdge.findMany({ where: { userId: ownerId } });
    sharedEdges.push(...ownerEdges);
  }

  // --- Map and filter all edges ---
  const resolveId = (rawNoteId: string, ownerId: string): string | null => {
    if (ownNodeIds.has(rawNoteId)) return rawNoteId;
    const namespaced = ownerNoteIdToNamespaced.get(`${ownerId}:${rawNoteId}`);
    if (namespaced) return namespaced;
    return null;
  };

  const edges: { fromNoteId: string; toNoteId: string }[] = [];
  const edgeSeen = new Set<string>();

  // Own edges: keep only those where both ends are accessible
  for (const e of allEdges) {
    if (accessibleIds.has(e.fromNoteId) && accessibleIds.has(e.toNoteId)) {
      const key = `${e.fromNoteId}->${e.toNoteId}`;
      if (!edgeSeen.has(key)) {
        edgeSeen.add(key);
        edges.push({ fromNoteId: e.fromNoteId, toNoteId: e.toNoteId });
      }
    }
  }

  // Shared edges: resolve IDs and keep only those where both ends are accessible
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

  return { nodes, edges };
}
