const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i;

interface NoteEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: NoteEntry[];
}

/** Recursively flatten a NoteEntry tree into a Set of file paths. */
export function flattenNotePaths(tree: NoteEntry[]): Set<string> {
  const paths = new Set<string>();
  function walk(nodes: NoteEntry[]) {
    for (const node of nodes) {
      if (node.type === "file") paths.add(node.path);
      if (node.children) walk(node.children);
    }
  }
  walk(tree);
  return paths;
}

export function sanitizePath(filePath: string): string {
  let p = filePath;
  p = p.replace(/[\x00-\x1f\x7f]/g, "");
  p = p.replace(/\.\.\//g, "").replace(/\.\.\\/g, "");
  p = p.replace(/^[/\\]+/, "");
  p = p
    .split("/")
    .map((seg) => {
      const base = seg.replace(/\.[^.]*$/, "");
      if (WINDOWS_RESERVED.test(base)) return "_" + seg;
      return seg;
    })
    .join("/");
  return p;
}

export interface ValidationResult {
  originalName: string;
  resolvedPath: string;
  size: number;
  status: "valid" | "duplicate" | "warning" | "invalid";
  errors: string[];
  existingNote?: boolean;
}

export function validateFile(
  originalName: string,
  resolvedPath: string,
  content: Buffer,
  maxFileSize: number,
  existingPaths: Set<string>
): ValidationResult {
  const errors: string[] = [];
  let hasHardError = false;

  if (!originalName.toLowerCase().endsWith(".md")) {
    errors.push("File must have .md extension");
    hasHardError = true;
  }

  if (content.length === 0) {
    errors.push("File is empty");
    hasHardError = true;
  } else if (content.length > maxFileSize) {
    errors.push(`File size (${content.length} bytes) exceeds maximum (${maxFileSize} bytes)`);
    hasHardError = true;
  }

  if (content.length > 0 && content.includes(0)) {
    errors.push("File contains binary data");
    hasHardError = true;
  }

  if (content.length > 0 && !hasHardError) {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
      if (!decoded.trimStart().startsWith("# ")) {
        errors.push("File does not start with a # heading");
      }
    } catch {
      errors.push("File is not valid UTF-8");
      hasHardError = true;
    }
  }

  const safePath = sanitizePath(resolvedPath);
  const isDuplicate = existingPaths.has(safePath);

  let status: ValidationResult["status"];
  if (hasHardError) {
    status = "invalid";
  } else if (isDuplicate) {
    status = "duplicate";
  } else if (errors.length > 0) {
    status = "warning";
  } else {
    status = "valid";
  }

  return {
    originalName,
    resolvedPath: safePath,
    size: content.length,
    status,
    errors,
    existingNote: isDuplicate || undefined,
  };
}
