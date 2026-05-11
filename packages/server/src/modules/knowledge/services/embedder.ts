/**
 * Embedder — thin wrapper around @xenova/transformers' feature-extraction
 * pipeline. Behind a small interface so Phase 5 can swap implementations
 * (e.g., a NovaMem-backed provider) without touching call sites.
 *
 * The transformers package is dynamic-imported so the heavy ONNX runtime
 * + model weights only load when an embedder is actually constructed.
 * When SEMANTIC_PROVIDER=off, this module is never imported at runtime.
 */

import type { FastifyBaseLogger } from "fastify";

export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
  readonly model: string;
  readonly dimensions: number;
}

export interface EmbedderConfig {
  /** Hugging Face model id, e.g. "Xenova/all-MiniLM-L6-v2". */
  model: string;
  /** Output vector length, e.g. 384 for MiniLM-L6. */
  dimensions: number;
}

interface PipelineOutput {
  data: Float32Array | number[];
}

type FeatureExtractor = (
  text: string,
  options: { pooling: "mean"; normalize: boolean },
) => Promise<PipelineOutput>;

export async function createEmbedder(
  config: EmbedderConfig,
  log: FastifyBaseLogger,
): Promise<Embedder> {
  const startedAt = Date.now();

  // Dynamic import keeps the ~MB-scale dep out of the cold-start path
  // when SEMANTIC_PROVIDER=off. The package's published types are
  // CommonJS-flavored and don't always line up cleanly under NodeNext;
  // we narrow what we need at the call boundary instead of trusting
  // the upstream declarations.
  const transformers = (await import("@xenova/transformers")) as unknown as {
    pipeline: (task: string, model: string) => Promise<FeatureExtractor>;
  };

  const extract = await transformers.pipeline("feature-extraction", config.model);

  // Warm-up call so the ONNX runtime caches initialise before the
  // first real request. Discard the result.
  await extract("warm-up", { pooling: "mean", normalize: true });

  const loadMs = Date.now() - startedAt;
  log.info({ model: config.model, dimensions: config.dimensions, loadMs }, "embedder ready");

  const toFloat32 = (out: PipelineOutput): Float32Array => {
    if (out.data instanceof Float32Array) {
      return out.data.length === config.dimensions
        ? out.data
        : new Float32Array(out.data.subarray(0, config.dimensions));
    }
    const arr = new Float32Array(config.dimensions);
    for (let i = 0; i < config.dimensions && i < out.data.length; i++) {
      arr[i] = out.data[i] ?? 0;
    }
    return arr;
  };

  const embedOne = async (text: string): Promise<Float32Array> => {
    const out = await extract(text, { pooling: "mean", normalize: true });
    return toFloat32(out);
  };

  return {
    model: config.model,
    dimensions: config.dimensions,
    async embed(texts: string[]): Promise<Float32Array[]> {
      // Transformers.js' JS pipeline API doesn't trivially batch;
      // sequential per-text is fine for Phase A's volume. A future
      // provider can override this for true batching.
      const out: Float32Array[] = [];
      for (const t of texts) {
        out.push(await embedOne(t));
      }
      return out;
    },
    async embedQuery(text: string): Promise<Float32Array> {
      return embedOne(text);
    },
  };
}
