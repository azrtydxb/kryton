import { describe, it, expect } from "vitest";
import { parseField } from "../lib/field-parser";

describe("parseField", () => {
  it("parses scalar required string", () => {
    expect(parseField("  name  String")).toEqual({
      name: "name", prismaType: "String", optional: false, isArray: false,
      attrs: [], default: undefined, isId: false,
    });
  });

  it("parses optional", () => {
    expect(parseField("  bio   String?")).toMatchObject({ optional: true, isArray: false });
  });

  it("parses array", () => {
    expect(parseField("  tags  String[]")).toMatchObject({ isArray: true, optional: false });
  });

  it("parses id", () => {
    expect(parseField("  id    String   @id @default(cuid())"))
      .toMatchObject({ name: "id", isId: true });
  });

  it("captures @updatedAt", () => {
    expect(parseField("  updatedAt DateTime @updatedAt").attrs).toContain("@updatedAt");
  });

  it("ignores relation fields", () => {
    expect(parseField("  user User @relation(fields:[userId], references:[id])")).toBeNull();
  });

  it("ignores fields starting with @@", () => {
    expect(parseField("@@unique([userId, key])")).toBeNull();
  });
});
