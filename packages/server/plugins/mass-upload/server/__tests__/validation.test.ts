import { describe, it, expect } from "vitest";
import { validateFile, sanitizePath, flattenNotePaths } from "../validation.js";

describe("sanitizePath", () => {
  it("strips path traversal", () => {
    expect(sanitizePath("../../etc/passwd")).toBe("etc/passwd");
  });
  it("strips leading slashes", () => {
    expect(sanitizePath("/absolute/path.md")).toBe("absolute/path.md");
  });
  it("strips control characters", () => {
    expect(sanitizePath("file\x00name.md")).toBe("filename.md");
  });
  it("rejects Windows reserved names", () => {
    expect(sanitizePath("CON.md")).toBe("_CON.md");
    expect(sanitizePath("folder/NUL.md")).toBe("folder/_NUL.md");
  });
  it("preserves valid relative paths", () => {
    expect(sanitizePath("Projects/todo.md")).toBe("Projects/todo.md");
  });
});

describe("flattenNotePaths", () => {
  it("flattens nested tree structure", () => {
    const tree = [
      { name: "root.md", path: "root.md", type: "file" as const },
      {
        name: "Projects", path: "Projects", type: "directory" as const,
        children: [
          { name: "todo.md", path: "Projects/todo.md", type: "file" as const },
        ],
      },
    ];
    const paths = flattenNotePaths(tree);
    expect(paths).toContain("root.md");
    expect(paths).toContain("Projects/todo.md");
    expect(paths).not.toContain("Projects");
  });
});

describe("validateFile", () => {
  const existingPaths = new Set(["existing.md"]);

  it("rejects non-.md extension", () => {
    const result = validateFile("test.txt", "test.txt", Buffer.from("# Hello"), 1048576, existingPaths);
    expect(result.status).toBe("invalid");
    expect(result.errors).toContain("File must have .md extension");
  });
  it("rejects empty files", () => {
    const result = validateFile("test.md", "test.md", Buffer.alloc(0), 1048576, existingPaths);
    expect(result.status).toBe("invalid");
    expect(result.errors).toContain("File is empty");
  });
  it("rejects files exceeding max size", () => {
    const result = validateFile("test.md", "test.md", Buffer.alloc(100), 50, existingPaths);
    expect(result.status).toBe("invalid");
    expect(result.errors[0]).toMatch(/exceeds maximum/);
  });
  it("rejects binary files (null bytes)", () => {
    const result = validateFile("test.md", "test.md", Buffer.from("hello\x00world"), 1048576, existingPaths);
    expect(result.status).toBe("invalid");
    expect(result.errors).toContain("File contains binary data");
  });
  it("warns if missing title heading", () => {
    const result = validateFile("test.md", "test.md", Buffer.from("no heading here"), 1048576, existingPaths);
    expect(result.status).toBe("warning");
    expect(result.errors).toContain("File does not start with a # heading");
  });
  it("marks valid file", () => {
    const result = validateFile("test.md", "test.md", Buffer.from("# Hello\nContent"), 1048576, existingPaths);
    expect(result.status).toBe("valid");
    expect(result.errors).toEqual([]);
  });
  it("detects duplicates", () => {
    const result = validateFile("existing.md", "existing.md", Buffer.from("# Hello"), 1048576, existingPaths);
    expect(result.status).toBe("duplicate");
    expect(result.existingNote).toBe(true);
  });
  it("collects all errors without short-circuiting", () => {
    const result = validateFile("test.txt", "test.txt", Buffer.alloc(0), 1048576, existingPaths);
    expect(result.errors).toContain("File must have .md extension");
    expect(result.errors).toContain("File is empty");
  });
});
