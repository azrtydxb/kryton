/**
 * TunnelStateService — persistence of tunnel config in the existing
 * `Settings` table under the `tunnel.*` key namespace.
 *
 * See docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md §1.5.
 *
 * The JWT itself is stored as-is alongside cached metadata (jti,
 * subdomain, exp) parsed at paste time. The `instance_id` is generated
 * once on first ever request and reused across restarts.
 */
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { GLOBAL_USER_ID } from "../../../lib/pathUtils.js";
import { settings } from "../../../db/schema/settings.js";
import type { TunnelClaims } from "../types.js";

type Db = {
  query: {
    settings: {
      findFirst: (args: { where: unknown }) => Promise<{
        key: string;
        userId: string;
        value: string;
      } | undefined>;
    };
  };
  insert: (table: typeof settings) => {
    values: (row: Record<string, unknown>) => {
      onConflictDoUpdate: (args: {
        target: unknown;
        set: Record<string, unknown>;
      }) => Promise<unknown>;
    };
  };
  delete: (table: typeof settings) => {
    where: (clause: unknown) => Promise<unknown>;
  };
};

const KEY = {
  JWT: "tunnel.jwt",
  JTI: "tunnel.jti",
  SUBDOMAIN: "tunnel.subdomain",
  EXP: "tunnel.exp",
  INSTANCE_ID: "tunnel.instance_id",
  LAST_CONNECTED_AT: "tunnel.last_connected_at",
  LAST_ERROR: "tunnel.last_error",
} as const;

export class TunnelStateService {
  constructor(private readonly db: Db) {}

  // ---- generic get/set (private helpers) -------------------------------

  private async get(key: string): Promise<string | null> {
    const row = await this.db.query.settings.findFirst({
      where: and(eq(settings.key, key), eq(settings.userId, GLOBAL_USER_ID)),
    });
    return row?.value ?? null;
  }

  private async set(key: string, value: string): Promise<void> {
    await this.db
      .insert(settings)
      .values({
        key,
        userId: GLOBAL_USER_ID,
        value,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [settings.key, settings.userId],
        set: { value, updatedAt: new Date() },
      });
  }

  private async clearKey(key: string): Promise<void> {
    await this.db
      .delete(settings)
      .where(and(eq(settings.key, key), eq(settings.userId, GLOBAL_USER_ID)));
  }

  // ---- public API ------------------------------------------------------

  async getJwt(): Promise<string | null> {
    return this.get(KEY.JWT);
  }

  async setJwt(jwt: string): Promise<void> {
    await this.set(KEY.JWT, jwt);
  }

  async clearJwt(): Promise<void> {
    await this.clearKey(KEY.JWT);
    await this.clearKey(KEY.JTI);
    await this.clearKey(KEY.SUBDOMAIN);
    await this.clearKey(KEY.EXP);
  }

  /**
   * Get the persistent per-server instance id. Generated lazily on
   * first call and stored in Settings; subsequent calls return the
   * same value.
   */
  async getInstanceId(): Promise<string> {
    const existing = await this.get(KEY.INSTANCE_ID);
    if (existing) return existing;
    const fresh = randomUUID();
    await this.set(KEY.INSTANCE_ID, fresh);
    return fresh;
  }

  async setCachedClaims(claims: TunnelClaims): Promise<void> {
    await this.set(KEY.JTI, claims.jti);
    await this.set(KEY.SUBDOMAIN, claims.subdomain);
    await this.set(KEY.EXP, String(claims.exp));
  }

  /**
   * Returns cached fields (jti, subdomain, exp) if present. Returns
   * null if any are missing — caller should treat as "no token
   * configured" and re-parse the JWT if needed.
   */
  async getCachedClaims(): Promise<{
    jti: string;
    subdomain: string;
    exp: number;
  } | null> {
    const [jti, subdomain, expRaw] = await Promise.all([
      this.get(KEY.JTI),
      this.get(KEY.SUBDOMAIN),
      this.get(KEY.EXP),
    ]);
    if (!jti || !subdomain || !expRaw) return null;
    const exp = Number(expRaw);
    if (!Number.isFinite(exp)) return null;
    return { jti, subdomain, exp };
  }

  async setLastConnectedAt(when: Date): Promise<void> {
    await this.set(KEY.LAST_CONNECTED_AT, when.toISOString());
  }

  async setLastError(message: string): Promise<void> {
    await this.set(KEY.LAST_ERROR, message);
  }

  async clearLastError(): Promise<void> {
    await this.clearKey(KEY.LAST_ERROR);
  }

  async getLastError(): Promise<string | null> {
    return this.get(KEY.LAST_ERROR);
  }
}
