import type { FastifyInstance } from "fastify";
import { SearchIndexManager } from "./search-index.js";
import {
  search as searchImpl,
  getAllTags as getAllTagsImpl,
  getNotesByTag as getNotesByTagImpl,
  type SearchResult,
} from "./search-query.js";

export type { SearchResult } from "./search-query.js";

/**
 * Knowledge search service. Owns the per-user MiniSearch index manager and
 * exposes a stable API matching the legacy `services/searchService.ts` exports.
 *
 * Receives the Fastify instance via constructor and uses `app.prisma`.
 */
export class SearchService {
  private readonly index: SearchIndexManager;

  constructor(private readonly app: FastifyInstance) {
    this.index = new SearchIndexManager(app);
  }

  indexNote(notePath: string, content: string, userId: string): Promise<void> {
    return this.index.indexNote(notePath, content, userId);
  }

  removeFromIndex(notePath: string, userId: string): Promise<void> {
    return this.index.removeFromIndex(notePath, userId);
  }

  renameInIndex(oldPath: string, newPath: string, userId: string): Promise<void> {
    return this.index.renameInIndex(oldPath, newPath, userId);
  }

  search(query: string, userId: string): Promise<SearchResult[]> {
    return searchImpl(this.app, this.index, query, userId);
  }

  getAllTags(userId: string): Promise<{ tag: string; count: number }[]> {
    return getAllTagsImpl(this.app, userId);
  }

  getNotesByTag(
    tag: string,
    userId: string,
  ): Promise<{ notePath: string; title: string }[]> {
    return getNotesByTagImpl(this.app, tag, userId);
  }
}
