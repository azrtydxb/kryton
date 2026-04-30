import * as fs from "fs/promises";
import * as path from "path";
import { createFolder } from "../folder.js";
import { prisma } from "../../prisma.js";

export async function backfillFolders(notesRoot: string, userId: string): Promise<number> {
  const userRoot = path.join(notesRoot, userId);
  let stats;
  try { stats = await fs.stat(userRoot); }
  catch { return 0; }
  if (!stats.isDirectory()) return 0;

  const dirs: string[] = [];
  await walk(userRoot, "", dirs);
  // Insert in sorted order so parents come before children
  dirs.sort();
  let count = 0;
  for (const rel of dirs) {
    const parts = rel.split("/");
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : undefined;
    const existing = await prisma.folder.findUnique({ where: { userId_path: { userId, path: rel } } });
    if (!existing) {
      await createFolder(userId, { path: rel, parentPath });
      count++;
    }
  }
  return count;
}

async function walk(absRoot: string, rel: string, out: string[]): Promise<void> {
  const dir = path.join(absRoot, rel);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      const sub = rel ? `${rel}/${e.name}` : e.name;
      out.push(sub);
      await walk(absRoot, sub, out);
    }
  }
}
