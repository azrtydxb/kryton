import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../prisma.js";
import { incrementCursor, getCursor } from "../cursor.js";

describe("cursor service", () => {
  beforeEach(async () => {
    await prisma.syncCursor.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-cur" } });
    await prisma.user.create({ data: { id: "u-cur", email: "cur@example.com", name: "Cursor User" } });
  });

  it("starts at 1 and increments", async () => {
    const a = await incrementCursor("u-cur");
    const b = await incrementCursor("u-cur");
    expect(b - a).toBe(1n);
  });

  it("getCursor returns 0 for unknown user", async () => {
    expect(await getCursor("nobody")).toBe(0n);
  });

  it("getCursor returns current cursor after increments", async () => {
    await incrementCursor("u-cur");
    await incrementCursor("u-cur");
    const c = await getCursor("u-cur");
    expect(c).toBe(2n);
  });
});
