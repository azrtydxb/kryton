/**
 * EmbedWorker — drains the EmbedJob queue.
 *
 * Phase 3 of Semantic Search Phase A. The worker polls the EmbedJob table
 * for the oldest pending row, reads the note off disk, chunks + embeds it,
 * and replace-inserts NoteEmbeddingChunk rows. On success the job row is
 * deleted; on failure the attempts counter is bumped and the error message
 * recorded. Jobs with attempts >= MAX_ATTEMPTS are skipped (left in place
 * for operator inspection / future requeue).
 *
 * Concurrency: Phase A runs ONE worker per server process. The popOldestJob
 * helper uses SELECT ... FOR UPDATE SKIP LOCKED so that, even if a future
 * phase scales to multiple workers, the simplest pop-and-process flow stays
 * race-safe.
 *
 * Boot behavior: the plugin (plugins/embedder.ts) starts the worker AFTER
 * model warm-up so we never embed before the embedder is ready. When
 * SEMANTIC_PROVIDER=off the worker is never constructed.
 */

import type { FastifyBaseLogger } from "fastify";
import { eq, and, sql } from "drizzle-orm";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Db } from "../../../db/client.js";
import { embedJob, noteEmbeddingChunk } from "../../../db/schema/embeddings.js";
import { searchIndex } from "../../../db/schema/notes.js";
import { chunkNote } from "./chunker.js";
import type { Embedder } from "./embedder.js";

const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 200;

export interface EmbedJobRow {
  userId: string;
  notePath: string;
  op: string;
  enqueuedAt: Date;
  attempts: number;
}

export interface EmbedWorkerDeps {
  db: Db;
  log: FastifyBaseLogger;
  embedder: Embedder;
  /**
   * Absolute path to the notes root. User files live at
   * `${notesDir}/${userId}/${notePath}`.
   */
  notesDir: string;
}

export class EmbedWorker {
  private stopFlag = false;
  private loopPromise: Promise<void> | null = null;

  constructor(private readonly deps: EmbedWorkerDeps) {}

  /**
   * Start the polling loop. Idempotent — calling start() twice is a no-op.
   * The returned promise resolves immediately; use stop() to await drain.
   */
  start(): void {
    if (this.loopPromise) return;
    this.stopFlag = false;
    this.loopPromise = this.loop();
  }

  /**
   * Signal the worker to stop after the current job finishes, then await
   * the loop's natural exit. Safe to call while a job is mid-process —
   * the current job will run to completion.
   */
  async stop(): Promise<void> {
    this.stopFlag = true;
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
  }

  async pendingCount(userId?: string): Promise<number> {
    const rows = userId
      ? await this.deps.db
          .select({ c: sql<number>`count(*)::int` })
          .from(embedJob)
          .where(eq(embedJob.userId, userId))
      : await this.deps.db
          .select({ c: sql<number>`count(*)::int` })
          .from(embedJob);
    return rows[0]?.c ?? 0;
  }

  private async loop(): Promise<void> {
    while (!this.stopFlag) {
      try {
        const job = await this.popOldestJob();
        if (!job) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        await this.processJob(job);
      } catch (err) {
        this.deps.log.error({ err }, "embed-worker: loop error");
        await sleep(POLL_INTERVAL_MS);
      }
    }
  }

  /**
   * Pop the oldest pending job using SELECT ... FOR UPDATE SKIP LOCKED.
   *
   * The lock is held for the lifetime of the transaction. We return the
   * row out of the transaction, which means the lock is released before
   * processJob() runs — that's fine for Phase A's single-worker model.
   * If a future phase needs multi-worker safety we can either keep the
   * tx open across processing or switch to an attempts-bump-on-claim
   * pattern.
   */
  private async popOldestJob(): Promise<EmbedJobRow | null> {
    return await this.deps.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT user_id, note_path, op, enqueued_at, attempts
        FROM "EmbedJob"
        WHERE attempts < ${MAX_ATTEMPTS}
        ORDER BY enqueued_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);
      const rows = result.rows as Array<{
        user_id: string;
        note_path: string;
        op: string;
        enqueued_at: Date | string;
        attempts: number;
      }>;
      if (rows.length === 0) return null;
      const row = rows[0]!;
      return {
        userId: row.user_id,
        notePath: row.note_path,
        op: row.op,
        enqueuedAt: row.enqueued_at instanceof Date ? row.enqueued_at : new Date(row.enqueued_at),
        attempts: row.attempts,
      };
    });
  }

  private async processJob(job: EmbedJobRow): Promise<void> {
    try {
      if (job.op === "delete") {
        await this.deleteChunks(job.userId, job.notePath);
      } else {
        await this.upsertChunks(job);
      }
      // Success — remove the job row.
      await this.deps.db
        .delete(embedJob)
        .where(
          and(
            eq(embedJob.userId, job.userId),
            eq(embedJob.notePath, job.notePath),
          ),
        );
    } catch (err) {
      await this.recordFailure(job, err);
    }
  }

  private async deleteChunks(userId: string, notePath: string): Promise<void> {
    await this.deps.db
      .delete(noteEmbeddingChunk)
      .where(
        and(
          eq(noteEmbeddingChunk.userId, userId),
          eq(noteEmbeddingChunk.notePath, notePath),
        ),
      );
  }

  private async upsertChunks(job: EmbedJobRow): Promise<void> {
    const fullPath = path.join(this.deps.notesDir, job.userId, job.notePath);
    let content: string | null;
    try {
      content = await fs.readFile(fullPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // File is gone — treat as a delete.
        await this.deleteChunks(job.userId, job.notePath);
        return;
      }
      throw err;
    }

    // Pull the title from SearchIndex so we don't re-parse frontmatter.
    const indexRow = await this.deps.db.query.searchIndex.findFirst({
      where: and(
        eq(searchIndex.userId, job.userId),
        eq(searchIndex.notePath, job.notePath),
      ),
      columns: { title: true },
    });
    const title = indexRow?.title ?? job.notePath;

    const chunks = chunkNote(title, content);
    const vectors = await this.deps.embedder.embed(chunks.map((c) => c.text));

    await this.deps.db.transaction(async (tx) => {
      await tx
        .delete(noteEmbeddingChunk)
        .where(
          and(
            eq(noteEmbeddingChunk.userId, job.userId),
            eq(noteEmbeddingChunk.notePath, job.notePath),
          ),
        );
      if (chunks.length > 0) {
        await tx.insert(noteEmbeddingChunk).values(
          chunks.map((c, i) => ({
            userId: job.userId,
            notePath: job.notePath,
            chunkIndex: c.index,
            chunkText: c.text,
            // Drizzle's vector column maps to number[] on the wire.
            embedding: Array.from(vectors[i] ?? new Float32Array(0)),
            modifiedAt: new Date(),
          })),
        );
      }
    });
  }

  private async recordFailure(job: EmbedJobRow, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.deps.log.warn(
      { userId: job.userId, notePath: job.notePath, attempts: job.attempts + 1, err: message },
      "embed-worker: job failed",
    );
    await this.deps.db
      .update(embedJob)
      .set({
        attempts: (job.attempts ?? 0) + 1,
        error: message,
      })
      .where(
        and(
          eq(embedJob.userId, job.userId),
          eq(embedJob.notePath, job.notePath),
        ),
      );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
