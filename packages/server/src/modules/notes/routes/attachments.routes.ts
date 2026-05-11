import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { eq } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../../../lib/errors.js";
import { attachment } from "../../../db/schema/notes.js";

const attachmentResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  notePath: z.string(),
  filename: z.string(),
  contentHash: z.string(),
  sizeBytes: z.number().int(),
  mimeType: z.string(),
  storagePath: z.string(),
  createdAt: z.union([z.string(), z.date()]),
});

/**
 * Attachments routes — file upload + download.
 * Mounted under `/api/attachments` by the parent module.
 *
 * Uses @fastify/multipart for multipart parsing (registered globally in app.ts).
 */
export const attachmentsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const storageRoot = app.config.NOTES_DIR;

  // POST /api/attachments — upload
  typed.post(
    "/",
    {
      preHandler: [async (req) => { await app.auth.requireUser(req); }],
      schema: {
        tags: ["notes"],
        summary: "Upload an attachment",
        consumes: ["multipart/form-data"],
        response: { 200: attachmentResponseSchema },
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const data = await req.file();
      if (!data) throw new ValidationError("file required");

      const buffer = await data.toBuffer();
      // notePath is sent as a multipart field; @fastify/multipart exposes it via data.fields
      const notePathField = data.fields.notePath;
      let notePath = "";
      if (notePathField && !Array.isArray(notePathField) && "value" in notePathField) {
        notePath = String(notePathField.value ?? "");
      }

      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const userRoot = path.join(path.resolve(storageRoot), user.id);
      const targetPath = path.join(userRoot, "attachments", hash);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, buffer);

      const [att] = await app.db
        .insert(attachment)
        .values({
          userId: user.id,
          notePath,
          filename: data.filename,
          contentHash: `sha256:${hash}`,
          sizeBytes: buffer.length,
          mimeType: data.mimetype,
          storagePath: targetPath,
        })
        .returning();
      return att;
    },
  );

  // GET /api/attachments/:id — download
  typed.get(
    "/:id",
    {
      preHandler: [async (req) => { await app.auth.requireUser(req); }],
      schema: {
        tags: ["notes"],
        summary: "Download an attachment",
        params: z.object({ id: z.string() }),
      },
    },
    async (req, reply) => {
      const user = await app.auth.requireUser(req);
      const { id } = req.params as { id: string };

      const att = await app.db.query.attachment.findFirst({
        where: eq(attachment.id, id),
      });
      if (!att || att.userId !== user.id) {
        throw new NotFoundError("Attachment not found");
      }

      const data = await fs.readFile(att.storagePath);
      reply.header("Content-Type", att.mimeType);
      reply.header("ETag", `"${att.contentHash}"`);
      reply.header("Cache-Control", "max-age=31536000, immutable");
      return reply.send(data);
    },
  );
};
