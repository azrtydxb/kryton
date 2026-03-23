import { AppDataSource } from "../data-source";
import { GraphEdge } from "../entities/GraphEdge";

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
  content: string
): Promise<void> {
  const repo = AppDataSource.getRepository(GraphEdge);

  // Remove existing edges from this note
  await repo.delete({ fromPath: notePath });

  const links = parseLinks(content);
  if (links.length === 0) return;

  const edges = links.map((link) => {
    const toPath = linkToPath(link);
    const edge = new GraphEdge();
    edge.fromPath = notePath;
    edge.toPath = toPath;
    edge.fromNoteId = noteIdFromPath(notePath);
    edge.toNoteId = noteIdFromPath(toPath);
    return edge;
  });

  await repo.save(edges);
}

/**
 * Remove all graph edges that reference the given note path (as source or target).
 */
export async function removeFromGraph(notePath: string): Promise<void> {
  const repo = AppDataSource.getRepository(GraphEdge);
  await repo.delete({ fromPath: notePath });
  // We also remove edges pointing TO this note
  await repo.delete({ toPath: notePath });
}

/**
 * Update graph edges when a note is renamed.
 */
export async function renameInGraph(
  oldPath: string,
  newPath: string
): Promise<void> {
  const repo = AppDataSource.getRepository(GraphEdge);
  const oldNoteId = noteIdFromPath(oldPath);
  const newNoteId = noteIdFromPath(newPath);

  // Update edges originating from the old path
  await repo
    .createQueryBuilder()
    .update(GraphEdge)
    .set({ fromPath: newPath, fromNoteId: newNoteId })
    .where("fromPath = :oldPath", { oldPath })
    .execute();

  // Update edges pointing to the old path
  await repo
    .createQueryBuilder()
    .update(GraphEdge)
    .set({ toPath: newPath, toNoteId: newNoteId })
    .where("toPath = :oldPath", { oldPath })
    .execute();

  // Also update edges that reference the old note id without .md
  await repo
    .createQueryBuilder()
    .update(GraphEdge)
    .set({ toNoteId: newNoteId })
    .where("toNoteId = :oldNoteId", { oldNoteId })
    .execute();
}

export interface GraphNode {
  id: string;
  path: string;
  title: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: { fromNoteId: string; toNoteId: string }[];
}

/**
 * Return the full graph: all nodes (from SearchIndex) and all edges.
 */
export async function getFullGraph(): Promise<GraphData> {
  const edgeRepo = AppDataSource.getRepository(GraphEdge);
  const { SearchIndex } = await import("../entities/SearchIndex");
  const searchRepo = AppDataSource.getRepository(SearchIndex);

  const [allNotes, allEdges] = await Promise.all([
    searchRepo.find(),
    edgeRepo.find(),
  ]);

  const nodes: GraphNode[] = allNotes.map((note) => ({
    id: noteIdFromPath(note.notePath),
    path: note.notePath,
    title: note.title,
  }));

  const edges = allEdges.map((e) => ({
    fromNoteId: e.fromNoteId,
    toNoteId: e.toNoteId,
  }));

  return { nodes, edges };
}
