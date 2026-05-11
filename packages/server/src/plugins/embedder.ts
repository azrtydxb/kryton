/**
 * Embedder Fastify plugin (Phase 3 of Semantic Search Phase A).
 *
 * Decorates `app.embedderState`. Boot behavior is "pre-warm, not block":
 * the plugin returns immediately, model warm-up runs in `onReady` as a
 * fire-and-forget task, and the worker starts only once the model is ready.
 * Request serving begins immediately; `embedderState.ready` flips to `true`
 * later when the embedder + worker are wired up.
 *
 * When SEMANTIC_PROVIDER=off the plugin no-ops (no model load, no worker).
 * Tests rely on this — see `__tests__/helpers/build-test-app.ts`.
 */

import fp from "fastify-plugin";
import * as path from "node:path";

import { createEmbedder, type Embedder } from "../modules/knowledge/services/embedder.js";
import { EmbedWorker } from "../modules/knowledge/services/embed-worker.js";

export interface EmbedderState {
  ready: boolean;
  provider: "pgvector-local" | "novamem" | "off";
  model?: string;
  dimensions: number;
  embedder?: Embedder;
  worker?: EmbedWorker;
}

declare module "fastify" {
  interface FastifyInstance {
    embedderState: EmbedderState;
  }
}

function resolveNotesDir(raw: string): string {
  return raw.startsWith("/") ? raw : path.join(process.cwd(), raw);
}

export const embedderPlugin = fp(
  async (app) => {
    const provider = app.config.SEMANTIC_PROVIDER;
    const state: EmbedderState = {
      ready: false,
      provider,
      dimensions: app.config.SEMANTIC_DIMENSIONS,
    };
    app.decorate("embedderState", state);

    if (provider === "off") {
      app.log.info("semantic search disabled (SEMANTIC_PROVIDER=off)");
      return;
    }

    if (!app.db) {
      // dbPlugin warns + skips when POSTGRES_URL is unset (e.g. the OpenAPI
      // dump script). Mirror that behavior: no DB means no worker.
      app.log.warn(
        "embedder plugin skipped — app.db not initialised (POSTGRES_URL unset)",
      );
      return;
    }

    const notesDir = resolveNotesDir(app.config.NOTES_DIR);

    app.addHook("onReady", async () => {
      // Fire-and-forget — onReady itself must return promptly so request
      // serving begins. Model load can take seconds on a cold disk cache.
      void (async () => {
        try {
          const embedder = await createEmbedder(
            {
              model: app.config.SEMANTIC_MODEL,
              dimensions: app.config.SEMANTIC_DIMENSIONS,
            },
            app.log,
          );
          state.embedder = embedder;
          state.model = embedder.model;

          const worker = new EmbedWorker({
            db: app.db,
            log: app.log,
            embedder,
            notesDir,
          });
          state.worker = worker;
          worker.start();
          state.ready = true;
          app.log.info({ provider, model: embedder.model }, "semantic search ready");
        } catch (err) {
          app.log.error({ err }, "semantic search failed to initialise");
        }
      })();
    });

    app.addHook("onClose", async () => {
      await state.worker?.stop();
    });
  },
  { name: "embedder", dependencies: ["db"] },
);
