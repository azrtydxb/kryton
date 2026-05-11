import { customType } from "drizzle-orm/pg-core";

/**
 * Postgres `tsvector` column type. Stored as a string client-side and round-
 * trips through `pg` as text. Always used with `.generatedAlwaysAs(...)` so
 * the column is populated server-side; we never write to it directly.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * Postgres `bytea` column type returning a Node `Buffer`. The `pg` driver
 * already encodes/decodes Buffer ↔ bytea natively, so the customType is a
 * pure type assertion — no runtime conversion needed.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
