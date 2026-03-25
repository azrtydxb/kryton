import { Router, Request, Response } from "express";
import * as path from "path";
import * as fs from "fs/promises";
import { format } from "date-fns";
import { readNote, writeNote } from "../services/noteService.js";
import { prisma } from "../prisma.js";
import { getUserNotesDir } from "../services/userNotesDir.js";

async function getDailyTemplate(userId: string): Promise<string> {
  try {
    // Try user-specific template first
    const userSetting = await prisma.settings.findUnique({
      where: { key_userId: { key: "dailyNoteTemplate", userId } },
    });
    if (userSetting?.value) return userSetting.value;

    // No global fallback with Prisma (userId is required in composite key),
    // so just return default
  } catch {
    // Use default
  }
  return `# Daily Note — {{date}}\n\n## Tasks\n- [ ] \n\n## Notes\n\n\n#daily\n`;
}

function applyTemplateVars(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

/**
 * @swagger
 * /daily:
 *   post:
 *     summary: Create or get today's daily note
 *     description: Creates a daily note for today using the configured template. If the note already exists, returns the existing note.
 *     tags: [Daily]
 *     responses:
 *       200:
 *         description: Existing daily note returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 path:
 *                   type: string
 *                   example: Daily/2026-03-23.md
 *                 content:
 *                   type: string
 *                   example: "# Daily Note — 2026-03-23\n..."
 *       201:
 *         description: New daily note created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 path:
 *                   type: string
 *                   example: Daily/2026-03-23.md
 *                 content:
 *                   type: string
 *       500:
 *         description: Failed to create daily note
 */
export function createDailyRouter(notesDir: string): Router {
  const router = Router();

  // POST /api/daily — Create or get today's daily note
  router.post("/", async (req: Request, res: Response) => {
    try {
      const userDir = await getUserNotesDir(notesDir, req.user!.id);
      const today = format(new Date(), "yyyy-MM-dd");
      const notePath = `Daily/${today}.md`;
      const fullPath = path.join(userDir, notePath);

      // Check if note already exists
      try {
        await fs.access(fullPath);
        // Note exists, just return it
        const note = await readNote(userDir, notePath);
        res.json(note);
        return;
      } catch {
        // Note doesn't exist, create it
      }

      // Create the Daily directory if needed
      await fs.mkdir(path.join(userDir, "Daily"), { recursive: true });

      // Get template and apply variables
      const template = await getDailyTemplate(req.user!.id);
      const content = applyTemplateVars(template, {
        date: today,
        title: `Daily Note — ${today}`,
      });

      await writeNote(userDir, notePath, content, req.user!.id);
      const note = await readNote(userDir, notePath);
      res.status(201).json(note);
    } catch (err) {
      console.error("Error creating daily note:", err);
      res.status(500).json({ error: "Failed to create daily note" });
    }
  });

  return router;
}
