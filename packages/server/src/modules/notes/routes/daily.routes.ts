import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq } from "drizzle-orm";
import { dailyNoteResponseSchema } from "../schemas/daily.schemas.js";
import type { NoteService } from "../services/note.service.js";
import { getUserNotesDir } from "../services/user-notes-dir.service.js";
import { settings } from "../../../db/schema/settings.js";

const DEFAULT_TEMPLATE = `# Daily Note — {{date}}\n\n## Tasks\n- [ ] \n\n## Notes\n\n\n#daily\n`;

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function applyTemplateVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

export interface DailyRoutesDeps {
  notesDir: string;
  noteService: NoteService;
  ensureBackfilled: (userId: string) => Promise<void>;
}

/**
 * Daily-note routes — mounted at `/api/daily`.
 *
 * URL summary:
 *   POST /api/daily    create or fetch today's daily note
 */
export function dailyRoutes(deps: DailyRoutesDeps): FastifyPluginAsync {
  const { notesDir, noteService, ensureBackfilled } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    async function getDailyTemplate(userId: string): Promise<string> {
      try {
        const userSetting = await app.db.query.settings.findFirst({
          where: and(eq(settings.key, "dailyNoteTemplate"), eq(settings.userId, userId)),
        });
        if (userSetting?.value) return userSetting.value;
      } catch {
        // fall through
      }
      return DEFAULT_TEMPLATE;
    }

    typed.post(
      "/",
      {
        schema: {
          tags: ["notes"],
          summary: "Create or get today's daily note",
          response: { 200: dailyNoteResponseSchema, 201: dailyNoteResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req, reply) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        const userDir = await getUserNotesDir(notesDir, ctx.user.id);
        const today = formatDate(new Date());
        const notePath = `Daily/${today}.md`;
        const fullPath = path.join(userDir, notePath);

        try {
          await fs.access(fullPath);
          // exists already
          return await noteService.readNote(userDir, notePath);
        } catch {
          // not yet — create it
        }

        await fs.mkdir(path.join(userDir, "Daily"), { recursive: true });
        const template = await getDailyTemplate(ctx.user.id);
        const content = applyTemplateVars(template, {
          date: today,
          title: `Daily Note — ${today}`,
        });

        await noteService.writeNote(userDir, notePath, content, ctx.user.id);
        const note = await noteService.readNote(userDir, notePath);
        reply.status(201);
        return note;
      },
    );
  };
}
