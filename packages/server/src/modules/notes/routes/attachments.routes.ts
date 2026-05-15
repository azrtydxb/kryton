import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import * as crypto from "crypto";
import { createWriteStream } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { pipeline } from "stream/promises";
import { eq } from "drizzle-orm";
import {
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from "../../../lib/errors.js";
import { attachment } from "../../../db/schema/notes.js";

// Attachments are user-uploaded content rendered inside notes. The list
// below is conservative: raster images, A/V media, PDFs for inline
// render, and a couple of structured text types for code/data
// references.
//
// Explicitly excluded — these can execute in the app origin if served
// back with their declared content-type, which would be a stored XSS:
//   - text/html, application/xhtml+xml — scripts + arbitrary DOM
//   - image/svg+xml — can embed <script>, <foreignObject>, javascript: URLs
//   - text/xml, application/xml — same XSS surface as HTML via XSLT
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
]);
const ALLOWED_MIME_PREFIXES = ["audio/", "video/"];
const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "application/json",
  "application/zip",
  "text/plain",
  "text/markdown",
  "text/csv",
]);
const isAllowedMime = (mime: string): boolean =>
  ALLOWED_IMAGE_TYPES.has(mime) ||
  ALLOWED_MIME_EXACT.has(mime) ||
  ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));

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

      if (!isAllowedMime(data.mimetype)) {
        // Drain so the multipart parser doesn't dangle.
        data.file.resume();
        throw new ValidationError(`unsupported mime type: ${data.mimetype}`);
      }

      // notePath is sent as a multipart field; @fastify/multipart exposes it via data.fields
      const notePathField = data.fields.notePath;
      let notePath = "";
      if (notePathField && !Array.isArray(notePathField) && "value" in notePathField) {
        notePath = String(notePathField.value ?? "");
      }
      if (!notePath) {
        data.file.resume();
        throw new ValidationError("notePath required");
      }
      // Verify the note belongs to the uploading user. readNote throws
      // NotFoundError if the path doesn't resolve under the user's dir.
      try {
        await app.notes.readNote(notePath, user.id);
      } catch {
        data.file.resume();
        throw new NotFoundError(`note not found: ${notePath}`);
      }

      const userRoot = path.join(path.resolve(storageRoot), user.id);
      const uploadDir = path.join(userRoot, ".uploads");
      const finalDir = path.join(userRoot, "attachments");
      await fs.mkdir(uploadDir, { recursive: true });
      await fs.mkdir(finalDir, { recursive: true });

      // Stream straight to disk while hashing inline. Avoids loading the
      // full upload into memory (multipart caps at 50MB but concurrent
      // uploads still add up). The hash becomes the final filename so
      // identical content is naturally deduped on disk.
      const tmpPath = path.join(uploadDir, `${crypto.randomUUID()}.part`);
      const hasher = crypto.createHash("sha256");
      let sizeBytes = 0;

      try {
        await pipeline(
          data.file,
          async function* (source) {
            for await (const chunk of source) {
              const buf = chunk as Buffer;
              hasher.update(buf);
              sizeBytes += buf.length;
              yield buf;
            }
          },
          createWriteStream(tmpPath),
        );
      } catch (err) {
        await fs.unlink(tmpPath).catch(() => {});
        throw err;
      }

      // @fastify/multipart marks `data.file.truncated` after fileSize is
      // exceeded; we must reject these uploads because the disk file is
      // a partial copy.
      if (data.file.truncated) {
        await fs.unlink(tmpPath).catch(() => {});
        throw new PayloadTooLargeError("file exceeds maximum upload size");
      }

      const hash = hasher.digest("hex");
      const targetPath = path.join(finalDir, hash);
      try {
        await fs.rename(tmpPath, targetPath);
      } catch (err) {
        await fs.unlink(tmpPath).catch(() => {});
        throw err;
      }

      const [att] = await app.db
        .insert(attachment)
        .values({
          userId: user.id,
          notePath,
          filename: data.filename,
          contentHash: `sha256:${hash}`,
          sizeBytes,
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
