import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { createTestDb, type TestDbHandle } from "../db-fixture.js";
import { user } from "../../db/schema/auth.js";

describe("db-fixture smoke test (Postgres + Drizzle + testcontainers)", () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  // Use a per-run id/email so the assertions are independent of any rows
  // other test files may have written to the shared testcontainers Postgres
  // (this fixture intentionally does NOT TRUNCATE — withTransaction's whole
  // point is to isolate via rollback, not table truncation).
  const id = `smoke-user-${Date.now()}`;
  const email = `${id}@example.com`;

  it("round-trips a User row inside withTransaction", async () => {
    const fetched = await handle.withTransaction(async (tx) => {
      await tx.insert(user).values({
        id,
        name: "Smoke User",
        email,
      });
      return tx.select().from(user).where(eq(user.id, id));
    });

    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.email).toBe(email);
  });

  it("rolls back: the previous test's User row is not visible", async () => {
    // Run a separate transaction; it should see no row with our smoke id
    // (the previous test's insert was rolled back).
    const rows = await handle.withTransaction(async (tx) => {
      return tx
        .select({ count: sql<number>`count(*)::int` })
        .from(user)
        .where(eq(user.id, id));
    });
    expect(rows[0]?.count).toBe(0);
  });
});
