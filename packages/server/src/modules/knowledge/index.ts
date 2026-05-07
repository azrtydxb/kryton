import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { SearchService, type SearchResult } from "./services/search.service.js";
import { GraphService, type GraphData } from "./services/graph.service.js";
import { CursorService } from "./services/cursor.service.js";
import { extractTitle } from "./services/search-helpers.js";
import { searchRoutes } from "./routes/search.routes.js";
import { graphRoutes } from "./routes/graph.routes.js";

/**
 * The decorator surface exposed by the knowledge module. Method names match
 * the optional `fastify.knowledge?` declaration in the notes module (parallel
 * migration contract): `updateGraph`, `extractTitle`, and `getNotesByTag`
 * returning `{ path; title }`.
 */
export interface KnowledgeApi {
  /** Index a note's content for full-text search. */
  indexNote(notePath: string, content: string, userId: string): Promise<void>;
  /** Remove a note from the search index. */
  removeFromIndex(notePath: string, userId: string): Promise<void>;
  /** Rename a note in the search index. */
  renameInIndex(oldPath: string, newPath: string, userId: string): Promise<void>;
  /** Re-index graph edges from this note's content. */
  updateGraph(notePath: string, content: string, userId: string): Promise<void>;
  /** Remove all edges referencing this note. */
  removeFromGraph(notePath: string, userId: string): Promise<void>;
  /** Update edges when a note is renamed. */
  renameInGraph(oldPath: string, newPath: string, userId: string): Promise<void>;
  /** Extract a display title from markdown content (frontmatter, heading, or filename). */
  extractTitle?(content: string, filePath: string): string;
  /** All tags across a user's notes with counts. */
  getAllTags(userId: string): Promise<{ tag: string; count: number }[]>;
  /** All notes for a given tag. */
  getNotesByTag(
    tag: string,
    userId: string,
  ): Promise<{ path: string; title: string }[]>;

  /** Search notes (own + shared). */
  search(query: string, userId: string): Promise<SearchResult[]>;
  /** Get backlinks for a note (other notes that link to it). */
  getBacklinks(
    notePath: string,
    userId: string,
  ): Promise<{ path: string; title: string }[]>;
  /** Get the full visible graph (own + accessible shared) for a user. */
  getFullGraph(userId: string): Promise<GraphData>;

  /** Increment the per-user sync cursor and return the new value. */
  incrementCursor(userId: string): Promise<bigint>;
  /** Read the per-user sync cursor (0 if none). */
  getCursor(userId: string): Promise<bigint>;
}

// The `knowledge` decorator is declared `?:` in `modules/notes/services/note.service.ts`
// during the parallel migration. Match that modifier so the module augmentations
// merge cleanly; routes inside this module assert non-null at the call site.
// Use an inline structural type that matches the parallel `knowledge?`
// declaration in `modules/notes/services/note.service.ts`. Subsequent
// property declarations across module augmentations must be structurally
// identical, so the literal shape is duplicated here on purpose.
declare module "fastify" {
  interface FastifyInstance {
    knowledge: {
      indexNote(notePath: string, content: string, userId: string): Promise<void>;
      removeFromIndex(notePath: string, userId: string): Promise<void>;
      renameInIndex(oldPath: string, newPath: string, userId: string): Promise<void>;
      updateGraph(notePath: string, content: string, userId: string): Promise<void>;
      removeFromGraph(notePath: string, userId: string): Promise<void>;
      renameInGraph(oldPath: string, newPath: string, userId: string): Promise<void>;
      extractTitle?(content: string, filePath: string): string;
      getAllTags(userId: string): Promise<{ tag: string; count: number }[]>;
      getNotesByTag(tag: string, userId: string): Promise<{ path: string; title: string }[]>;
      search(query: string, userId: string): Promise<unknown[]>;
      getBacklinks(notePath: string, userId: string): Promise<{ path: string; title: string }[]>;
      getFullGraph(userId: string): Promise<unknown>;
      incrementCursor(userId: string): Promise<bigint>;
      getCursor(userId: string): Promise<bigint>;
    };
  }
}

/**
 * Knowledge module — search + graph.
 *
 * Decorates `fastify.knowledge` with the public service surface used by
 * other modules (notes calls indexNote / removeFromIndex / updateGraphCache
 * on save, etc.) and registers the HTTP routes:
 *   - GET /api/search
 *   - GET /api/graph
 */
export const knowledgeModule: FastifyPluginAsync = fp(
  async (app) => {
    const search = new SearchService(app);
    const graph = new GraphService(app);
    const cursor = new CursorService(app);

    const api: KnowledgeApi = {
      indexNote: (p, c, u) => search.indexNote(p, c, u),
      removeFromIndex: (p, u) => search.removeFromIndex(p, u),
      renameInIndex: (o, n, u) => search.renameInIndex(o, n, u),
      search: (q, u) => search.search(q, u),
      getAllTags: (u) => search.getAllTags(u),
      getNotesByTag: async (t, u) => {
        const rows = await search.getNotesByTag(t, u);
        return rows.map((r) => ({ path: r.notePath, title: r.title }));
      },
      extractTitle: (content, filePath) => extractTitle(content, filePath),

      updateGraph: (p, c, u) => graph.updateGraphCache(p, c, u),
      removeFromGraph: (p, u) => graph.removeFromGraph(p, u),
      renameInGraph: (o, n, u) => graph.renameInGraph(o, n, u),
      getBacklinks: (p, u) => graph.getBacklinks(p, u),
      getFullGraph: (u) => graph.getFullGraph(u),

      incrementCursor: (u) => cursor.increment(u),
      getCursor: (u) => cursor.get(u),
    };

    app.decorate("knowledge", api);

    await app.register(searchRoutes, {
      prefix: "/api/search",
      searchService: search,
    });
    await app.register(graphRoutes, {
      prefix: "/api/graph",
      graphService: graph,
    });
  },
  { name: "knowledge-module" },
);
