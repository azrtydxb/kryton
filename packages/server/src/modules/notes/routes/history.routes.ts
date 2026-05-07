import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { NotFoundError, ValidationError } from "../../../lib/errors.js";

// notes-core module exposes the decorator.


import { getNoteHistoryDir } from "../services/history.service.js";

const versionEntrySchema = z.object({
  timestamp: z.number().int(),
  date: z.string(),
  size: z.number().int(),
});

const listResponseSchema = z.object({ versions: z.array(versionEntrySchema) });

const versionContentSchema = z.object({
  content: z.string(),
  timestamp: z.number().int(),
  date: z.string(),
});

function decodePathParam(raw: string | string[] | undefined): string {
  if (raw === undefined) return "";
  const joined = Array.isArray(raw) ? raw.join("/") : raw;
  return decodeURIComponent(joined);
}

/**
 * History routes — list/read/restore versioned snapshots of notes.
 *
 * Three different URL prefixes are preserved from the legacy server:
 *   - GET  /api/history/<note path>
 *   - GET  /api/history-version/<note path>?ts=<timestamp>
 *   - POST /api/history-restore/<note path>?ts=<timestamp>
 *
 * The plugin is registered three times by `aux-routes.ts` with the
 * appropriate prefix and a flag that selects which handler to mount.
 */
type HistoryMode = "list" | "version" | "restore";

interface HistoryRoutesOptions {
  mode: HistoryMode;
}

export const historyRoutes: FastifyPluginAsync<HistoryRoutesOptions> = async (app, opts) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  if (opts.mode === "list") {
    typed.get(
      "/*",
      {
        preHandler: [async (req) => { await app.auth.requireUser(req); }],
        schema: {
          tags: ["notes"],
          summary: "List versions of a note",
          response: { 200: listResponseSchema },
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const wildcardParam = (req.params as Record<string, string>)["*"];
        const notePath = decodePathParam(wildcardParam);
        if (!notePath) throw new ValidationError("Path is required");

        const userDir = await app.notes.getUserNotesDir(user.id);
        const historyDir = getNoteHistoryDir(userDir, notePath);

        let entries: import("fs").Dirent[];
        try {
          entries = await fs.readdir(historyDir, { withFileTypes: true });
        } catch {
          return { versions: [] };
        }

        const versions: { timestamp: number; date: string; size: number }[] = [];
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
          const timestampStr = entry.name.slice(0, -3);
          const timestamp = parseInt(timestampStr, 10);
          if (isNaN(timestamp)) continue;

          const fullPath = path.join(historyDir, entry.name);
          const stat = await fs.stat(fullPath);
          versions.push({
            timestamp,
            date: new Date(timestamp).toISOString(),
            size: stat.size,
          });
        }
        versions.sort((a, b) => b.timestamp - a.timestamp);
        return { versions };
      },
    );
    return;
  }

  if (opts.mode === "version") {
    typed.get(
      "/*",
      {
        preHandler: [async (req) => { await app.auth.requireUser(req); }],
        schema: {
          tags: ["notes"],
          summary: "Read a specific version of a note",
          querystring: z.object({ ts: z.coerce.number().int() }),
          response: { 200: versionContentSchema },
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const wildcardParam = (req.params as Record<string, string>)["*"];
        const notePath = decodePathParam(wildcardParam);
        const { ts } = req.query as { ts: number };

        if (!notePath) throw new ValidationError("Path is required");
        if (!Number.isFinite(ts)) {
          throw new ValidationError("Timestamp query parameter (ts) is required");
        }

        const userDir = await app.notes.getUserNotesDir(user.id);
        const historyDir = getNoteHistoryDir(userDir, notePath);
        const versionFile = path.join(historyDir, `${ts}.md`);

        const resolvedVersion = path.resolve(versionFile);
        const resolvedHistoryDir = path.resolve(historyDir);
        if (!resolvedVersion.startsWith(resolvedHistoryDir + path.sep)) {
          throw new ValidationError("Invalid path");
        }

        let content: string;
        try {
          content = await fs.readFile(versionFile, "utf-8");
        } catch {
          throw new NotFoundError("Version not found");
        }
        return { content, timestamp: ts, date: new Date(ts).toISOString() };
      },
    );
    return;
  }

  // restore
  typed.post(
    "/*",
    {
      preHandler: [async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
      }],
      schema: {
        tags: ["notes"],
        summary: "Restore a specific version of a note",
        querystring: z.object({ ts: z.coerce.number().int() }),
        response: { 200: z.object({ restored: z.boolean() }) },
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const wildcardParam = (req.params as Record<string, string>)["*"];
      const notePath = decodePathParam(wildcardParam);
      const { ts } = req.query as { ts: number };

      if (!notePath) throw new ValidationError("Path is required");
      if (!Number.isFinite(ts)) {
        throw new ValidationError("Timestamp query parameter (ts) is required");
      }

      const userDir = await app.notes.getUserNotesDir(user.id);
      const historyDir = getNoteHistoryDir(userDir, notePath);
      const versionFile = path.join(historyDir, `${ts}.md`);

      const resolvedVersion = path.resolve(versionFile);
      const resolvedHistoryDir = path.resolve(historyDir);
      if (!resolvedVersion.startsWith(resolvedHistoryDir + path.sep)) {
        throw new ValidationError("Invalid path");
      }

      let content: string;
      try {
        content = await fs.readFile(versionFile, "utf-8");
      } catch {
        throw new NotFoundError("Version not found");
      }

      await app.notes.writeNote(notePath, content, user.id);
      return { restored: true };
    },
  );
};
