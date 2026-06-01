import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../../db/client.js";
import { pushDevices, type PushDevice } from "../../../db/schema/push.js";

export type Platform = "ios" | "android";

export async function registerDevice(
  db: Db,
  input: { userId: string; platform: Platform; token: string },
): Promise<{ device: PushDevice; created: boolean }> {
  const existing = await db
    .select()
    .from(pushDevices)
    .where(and(eq(pushDevices.platform, input.platform), eq(pushDevices.token, input.token)))
    .limit(1);

  if (existing[0]) {
    // Same (platform, token) already registered — update lastSeenAt and re-assign
    // owner if the device was handed off to a different user.
    const updates: Partial<{ userId: string; lastSeenAt: ReturnType<typeof sql> }> = {
      lastSeenAt: sql`now()`,
    };
    if (existing[0].userId !== input.userId) {
      updates.userId = input.userId;
    }
    const [updated] = await db
      .update(pushDevices)
      .set(updates)
      .where(eq(pushDevices.id, existing[0].id))
      .returning();
    return { device: updated, created: false };
  }

  const [created] = await db
    .insert(pushDevices)
    .values({ userId: input.userId, platform: input.platform, token: input.token })
    .returning();
  return { device: created, created: true };
}

export async function deregisterDevice(
  db: Db,
  input: { userId: string; id: string },
): Promise<boolean> {
  const deleted = await db
    .delete(pushDevices)
    .where(and(eq(pushDevices.userId, input.userId), eq(pushDevices.id, input.id)))
    .returning();
  return deleted.length > 0;
}
