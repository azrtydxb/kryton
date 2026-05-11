/**
 * Per-user fusion weights for the 3-layer RRF search.
 *
 * Backed by the existing `Settings` table (composite PK `(key, userId)`).
 * Key = "fusion_weights", value = JSON-encoded { lex, sem, graph }.
 *
 * Defaults if no row exists: { lex: 0.4, sem: 0.4, graph: 0.2 }.
 *
 * All write paths normalise so `lex + sem + graph === 1`. Read path
 * also normalises defensively in case the stored row was hand-edited.
 */
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";

import { settings } from "../../../db/schema/settings.js";

export interface FusionWeights {
  lex: number;
  sem: number;
  graph: number;
}

export const DEFAULT_FUSION_WEIGHTS: FusionWeights = {
  lex: 0.4,
  sem: 0.4,
  graph: 0.2,
};

const SETTINGS_KEY = "fusion_weights";

/** Normalise so sum = 1; if all zero/negative, fall back to defaults. */
export function normaliseWeights(w: FusionWeights): FusionWeights {
  const lex = Math.max(0, w.lex);
  const sem = Math.max(0, w.sem);
  const graph = Math.max(0, w.graph);
  const sum = lex + sem + graph;
  if (sum <= 0) return { ...DEFAULT_FUSION_WEIGHTS };
  return { lex: lex / sum, sem: sem / sum, graph: graph / sum };
}

export async function getFusionWeights(
  app: FastifyInstance,
  userId: string,
): Promise<FusionWeights> {
  const row = await app.db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, SETTINGS_KEY)))
    .limit(1);

  const raw = row[0]?.value;
  if (!raw) return { ...DEFAULT_FUSION_WEIGHTS };
  try {
    const parsed = JSON.parse(raw) as Partial<FusionWeights>;
    return normaliseWeights({
      lex:
        typeof parsed.lex === "number"
          ? parsed.lex
          : DEFAULT_FUSION_WEIGHTS.lex,
      sem:
        typeof parsed.sem === "number"
          ? parsed.sem
          : DEFAULT_FUSION_WEIGHTS.sem,
      graph:
        typeof parsed.graph === "number"
          ? parsed.graph
          : DEFAULT_FUSION_WEIGHTS.graph,
    });
  } catch {
    return { ...DEFAULT_FUSION_WEIGHTS };
  }
}

export async function setFusionWeights(
  app: FastifyInstance,
  userId: string,
  w: FusionWeights,
): Promise<FusionWeights> {
  const normalised = normaliseWeights(w);
  await app.db
    .insert(settings)
    .values({
      userId,
      key: SETTINGS_KEY,
      value: JSON.stringify(normalised),
    })
    .onConflictDoUpdate({
      target: [settings.key, settings.userId],
      set: { value: JSON.stringify(normalised) },
    });
  return normalised;
}
