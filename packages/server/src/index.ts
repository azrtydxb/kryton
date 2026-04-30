import http from "http";
import express, { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { validateEnv } from "./lib/env.js";
import { createLogger } from "./lib/logger.js";
import { GLOBAL_USER_ID, decodePathParam, validatePathWithinBase } from "./lib/pathUtils.js";
import { errorHandler } from "./lib/errors.js";
import { toNodeHandler } from "better-auth/node";
import swaggerUi from "swagger-ui-express";
import * as path from "path";
import * as fs from "fs/promises";
import { prisma } from "./prisma.js";
import { swaggerSpec } from "./swagger.js";
import { auth } from "./auth.js";
import { authMiddleware, adminMiddleware, requireUser } from "./middleware/auth.js";
import { createAdminRouter } from "./routes/admin.js";
import { createNotesRouter, createNotesRenameRouter, createSharedNotesRouter } from "./routes/notes.js";
import { createFoldersRouter, createFoldersRenameRouter } from "./routes/folders.js";
import { createSearchRouter } from "./routes/search.js";
import { createGraphRouter } from "./routes/graph.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createBacklinksRouter } from "./routes/backlinks.js";
import { createTagsRouter } from "./routes/tags.js";
import { createDailyRouter } from "./routes/daily.js";
import { createTemplatesRouter } from "./routes/templates.js";
import { createCanvasRouter } from "./routes/canvas.js";
import { createSharesRouter, createAccessRequestsRouter } from "./routes/shares.js";
import { createUsersRouter } from "./routes/users.js";
import { cleanupOldNotes, getUserNotesDir } from "./services/userNotesDir.js";
import { PluginEventBus } from "./plugins/PluginEventBus.js";
import { PluginHealthMonitor } from "./plugins/PluginHealthMonitor.js";
import { PluginRouter } from "./plugins/PluginRouter.js";
import { PluginApiFactory } from "./plugins/PluginApiFactory.js";
import { PluginManager } from "./plugins/PluginManager.js";
import { PluginWebSocket } from "./plugins/PluginWebSocket.js";
import { createPluginsRouter } from "./routes/plugins.js";
import { createApiKeysRouter } from "./routes/apiKeys.js";
import { createMcpRouter } from "./mcp/mcpServer.js";
import { setGraphWebSocket } from "./services/noteService.js";
import { createTrashRouter, createTrashEmptyRouter, purgeOldTrash } from "./routes/trash.js";
import { createHistoryRouter, createHistoryTimestampRouter, createHistoryRestoreRouter } from "./routes/history.js";
import { createSyncRouter } from "./routes/sync.js";
import { APP_VERSION, APP_COMMIT, APP_MAJOR_VERSION } from "./lib/version.js";
import { backfillFolders } from "./services/backfill/folders-backfill.js";
import { backfillTags } from "./services/backfill/tags-backfill.js";

const log = createLogger("server");
const PORT = parseInt(process.env.PORT || "3001", 10);

// Track users whose backfill has already been triggered this session (in-memory guard)
const backfilledUsers = new Set<string>();

async function ensureBackfilled(userId: string, notesRoot: string): Promise<void> {
  if (backfilledUsers.has(userId)) return;
  backfilledUsers.add(userId);
  try {
    await backfillFolders(notesRoot, userId);
    await backfillTags(userId);
  } catch (err) {
    // Non-fatal: log and continue
    log.warn("backfill failed for user", userId, err);
    backfilledUsers.delete(userId); // Allow retry on next request
  }
}
const NOTES_DIR = path.resolve(
  process.env.NOTES_DIR || path.join(import.meta.dirname, "../../notes")
);

async function main(): Promise<void> {
  // Validate environment variables early
  validateEnv();

  // Initialize the database
  try {
    await prisma.$connect();
    log.info("Database connection established.");
  } catch (err) {
    log.error("Failed to connect to database:", err);
    process.exit(1);
  }

  // Ensure notes base directory exists
  await fs.mkdir(NOTES_DIR, { recursive: true });

  // Move legacy (pre-multiuser) files out of the notes root
  await cleanupOldNotes(NOTES_DIR);

  // Clean up orphaned DB rows from pre-multiuser era (defensive)
  try {
    await prisma.searchIndex.deleteMany({ where: { userId: "" } });
    await prisma.graphEdge.deleteMany({ where: { userId: "" } });
  } catch {
    log.info("Orphan cleanup skipped (table may have been recreated)");
  }

  // Ensure registration_mode global setting exists
  const regMode = await prisma.settings.findUnique({
    where: { key_userId: { key: "registration_mode", userId: GLOBAL_USER_ID } },
  });
  if (!regMode) {
    await prisma.settings.create({
      data: { key: "registration_mode", value: "invite-only", userId: GLOBAL_USER_ID },
    });
    log.info("Created default registration_mode = invite-only");
  }

  // Auto-purge trash items older than 30 days for all users
  try {
    const userDirs = await fs.readdir(NOTES_DIR, { withFileTypes: true });
    for (const entry of userDirs) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const userNotesDir = path.join(NOTES_DIR, entry.name);
        await purgeOldTrash(userNotesDir).catch((err) => {
          log.error(`Failed to purge old trash for ${entry.name}:`, err);
        });
      }
    }
    log.info("Trash auto-purge complete.");
  } catch (err) {
    log.error("Trash auto-purge failed:", err);
  }

  // Clean up old sync deletion records (older than 90 days)
  await prisma.syncDeletion.deleteMany({
    where: { deletedAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
  });
  log.info("Sync deletion cleanup complete.");

  // Note: per-user indexing is now handled during provisioning and login.
  log.info("Startup complete — per-user notes are indexed on demand.");

  // Create Express app
  const app = express();

  // Trust proxy for correct client IP in rate limiter (behind reverse proxy/Docker)
  app.set("trust proxy", 1);

  // Middleware
  app.use(cors({
    origin: process.env.APP_URL || "http://localhost:5173",
    credentials: true,
  }));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Allow inline theme detection script (sha256 of the script in index.html)
        scriptSrc: ["'self'", "'sha256-2mWHaOgltDZJANC/lj7Lk9cZEONwp2osBnUNugvdbjc='"],
        // Allow Google Fonts stylesheet
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        // Allow Google Fonts files
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "ws:", "wss:"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Disable upgrade-insecure-requests — breaks plain HTTP deployments
        upgradeInsecureRequests: null,
      },
    },
  }));
  app.use(express.json());

  // Plugin system initialization
  const pluginsDir = path.resolve(import.meta.dirname, "../plugins");
  await fs.mkdir(pluginsDir, { recursive: true });

  const eventBus = new PluginEventBus();
  const pluginRouter = new PluginRouter(app, authMiddleware);
  // Use a container object so the healthMonitor closure can reference pluginManager
  // before it is assigned (forward reference pattern)
  const managerRef: { instance: PluginManager | null } = { instance: null };
  const healthMonitor = new PluginHealthMonitor({
    maxErrors: 5,
    windowMs: 60_000,
    onDisable: async (pluginId) => {
      log.warn(`Auto-disabling plugin ${pluginId} due to excessive errors`);
      await managerRef.instance?.disablePlugin(pluginId);
      await prisma.installedPlugin.update({
        where: { id: pluginId },
        data: { enabled: false, state: "error", error: "Auto-disabled: too many errors" },
      });
    },
  });
  const apiFactory = new PluginApiFactory({
    eventBus,
    pluginRouter,
    healthMonitor,
    notesDir: NOTES_DIR,
  });
  const pluginManager = new PluginManager({
    pluginsDir,
    eventBus,
    pluginRouter,
    healthMonitor,
    apiFactory,
  });
  managerRef.instance = pluginManager;

  // Discover and load plugins from the plugins directory
  await pluginManager.discoverAndLoadPlugins();

  // Serve plugin client bundles as static files (auth required)
  app.use("/plugins", authMiddleware, express.static(pluginsDir));

  // Rate limiters — keyed per session/key so one client can't lock out others
  // Auth: keyed by IP+email combo (unauthenticated, so IP is all we have)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50, // generous for normal use, stops brute force
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = req.body?.email || "";
      return `auth:${req.ip}:${email}`;
    },
    message: { error: "Too many authentication attempts — please wait a few minutes" },
  });

  // Web/mobile session API: keyed by user ID (authenticated), very generous
  const sessionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000, // normal UI use should never hit this
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `session:${req.user?.id || req.ip}`,
    message: { error: "Too many requests, please try again later" },
  });

  // MCP / API key: keyed by individual API key, higher limit for automation
  const apiKeyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000, // AI agents make many calls — this is per key
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `apikey:${req.apiKey?.id || req.ip}`,
    message: { error: "API key rate limit exceeded — please try again later" },
  });

  // Sync: keyed by user/key, generous for mobile sync
  const syncLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    keyGenerator: (req) => `sync:${req.apiKey?.id || req.user?.id || req.ip}`,
    message: { error: "Sync rate limit exceeded" },
  });
  app.use("/api/sync", authMiddleware, syncLimiter, createSyncRouter(NOTES_DIR));

  app.use("/api/auth", authLimiter);
  app.use("/api", (req, res, next) => {
    if (req.headers.authorization?.startsWith("Bearer kryton_")) {
      return apiKeyLimiter(req, res, next);
    }
    return sessionLimiter(req, res, next);
  });

  // better-auth handler (replaces old routes/auth.ts)
  app.all("/api/auth/*splat", toNodeHandler(auth));

  // Swagger API docs (unauthenticated, GET-only)
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Kryton API Docs',
  }));
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

  /**
   * @swagger
   * /health:
   *   get:
   *     summary: Health check
   *     tags: [Health]
   *     responses:
   *       200:
   *         description: Server is healthy
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: ok
   */
  // Version info (unauthenticated)
  app.get("/api/version", (_req, res) => {
    res.json({ version: APP_VERSION, commit: APP_COMMIT, majorVersion: APP_MAJOR_VERSION });
  });

  // Health check (unauthenticated, GET-only)
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: APP_VERSION, commit: APP_COMMIT, majorVersion: APP_MAJOR_VERSION });
  });

  // Lazy backfill middleware — fires once per user session (fire-and-forget, non-blocking)
  app.use("/api", (req, _res, next) => {
    if (req.user?.id) {
      ensureBackfilled(req.user.id, NOTES_DIR).catch((e) =>
        log.warn("ensureBackfilled error", e)
      );
    }
    next();
  });

  // Admin routes (auth + admin middleware)
  app.use("/api/admin", authMiddleware, adminMiddleware, createAdminRouter());

  // Protected routes (auth middleware)
  // Mount shared notes BEFORE the regular /api/notes router to avoid wildcard conflicts
  app.use("/api/notes/shared", authMiddleware, createSharedNotesRouter(NOTES_DIR));
  app.use("/api/notes", authMiddleware, createNotesRouter(NOTES_DIR));
  app.use("/api/notes-rename", authMiddleware, createNotesRenameRouter(NOTES_DIR));
  app.use("/api/folders", authMiddleware, createFoldersRouter(NOTES_DIR));
  app.use("/api/folders-rename", authMiddleware, createFoldersRenameRouter(NOTES_DIR));
  app.use("/api/search", authMiddleware, createSearchRouter());
  app.use("/api/graph", authMiddleware, createGraphRouter());
  app.use("/api/settings", authMiddleware, createSettingsRouter());
  app.use("/api/backlinks", authMiddleware, createBacklinksRouter());
  app.use("/api/tags", authMiddleware, createTagsRouter());
  app.use("/api/daily", authMiddleware, createDailyRouter(NOTES_DIR));
  app.use("/api/templates", authMiddleware, createTemplatesRouter(NOTES_DIR));
  app.use("/api/canvas", authMiddleware, createCanvasRouter(NOTES_DIR));
  app.use("/api/shares", authMiddleware, createSharesRouter());
  app.use("/api/access-requests", authMiddleware, createAccessRequestsRouter());
  app.use("/api/users", authMiddleware, createUsersRouter());
  app.use("/api/plugins", authMiddleware, createPluginsRouter(pluginManager, pluginsDir));
  app.use("/api/api-keys", authMiddleware, createApiKeysRouter());
  app.use("/api/mcp", createMcpRouter());
  app.use("/api/trash-empty", authMiddleware, createTrashEmptyRouter(NOTES_DIR));
  app.use("/api/trash", authMiddleware, createTrashRouter(NOTES_DIR));
  app.use("/api/history-restore", authMiddleware, createHistoryRestoreRouter(NOTES_DIR));
  app.use("/api/history-version", authMiddleware, createHistoryTimestampRouter(NOTES_DIR));
  app.use("/api/history", authMiddleware, createHistoryRouter(NOTES_DIR));

  /**
   * @swagger
   * /files:
   *   post:
   *     summary: Upload an image attachment to the notes directory
   *     tags: [Files]
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *     responses:
   *       200:
   *         description: Upload successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 path:
   *                   type: string
   *                 url:
   *                   type: string
   *       400:
   *         description: No file provided or file type not allowed
   *       413:
   *         description: File too large
   */
  const uploadStorage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });

  app.post("/api/files", authMiddleware, uploadStorage.single("file"), async (req: Request, res: Response, next) => {
    try {
      const user = requireUser(req);
      if (!req.file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      const allowedExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!allowedExts.includes(ext)) {
        res.status(400).json({ error: "File type not allowed" });
        return;
      }

      const timestamp = Date.now();
      const safeOriginalName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filename = `${timestamp}-${safeOriginalName}`;

      const userDir = await getUserNotesDir(NOTES_DIR, user.id);
      const attachmentsDir = path.join(userDir, "attachments");
      await fs.mkdir(attachmentsDir, { recursive: true });

      const destPath = path.join(attachmentsDir, filename);
      validatePathWithinBase(destPath, userDir);
      await fs.writeFile(destPath, req.file.buffer);

      res.json({
        path: `attachments/${filename}`,
        url: `/api/files/attachments/${filename}`,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /files/{path}:
   *   get:
   *     summary: Serve an image file from the notes directory
   *     tags: [Files]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Relative path to the image file within the notes directory
   *     responses:
   *       200:
   *         description: The image file
   *         content:
   *           image/*:
   *             schema:
   *               type: string
   *               format: binary
   *       403:
   *         description: File type not allowed
   *       404:
   *         description: File not found
   */
  // Serve image files from notes directory (protected)
  app.get("/api/files/{*path}", authMiddleware, async (req: Request, res: Response, next) => {
    try {
      const user = requireUser(req);
      const filePath = decodePathParam(req.params.path);
      const allowedExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"];
      const ext = path.extname(filePath).toLowerCase();

      if (!allowedExts.includes(ext)) {
        res.status(403).json({ error: "File type not allowed" });
        return;
      }

      const userDir = await getUserNotesDir(NOTES_DIR, user.id);
      const fullPath = path.resolve(path.join(userDir, filePath));
      validatePathWithinBase(fullPath, userDir);

      await fs.stat(fullPath);
      // Prevent script execution in served files (especially SVG)
      res.setHeader("Content-Security-Policy", "script-src 'none'");
      res.setHeader("Content-Disposition", "inline");
      res.sendFile(fullPath);
    } catch (err) {
      next(err);
    }
  });

  // Serve static frontend in production
  const publicDir = path.join(import.meta.dirname, "../public");
  try {
    const stat = await fs.stat(publicDir);
    if (stat.isDirectory()) {
      app.use(express.static(publicDir));
      // SPA fallback: serve index.html for all non-API routes
      app.get("*", (_req, res) => {
        res.sendFile(path.join(publicDir, "index.html"));
      });
      log.info(`Serving static files from ${publicDir}`);
    }
  } catch {
    // No public directory — running in dev mode
  }

  // Global error handler (must be last middleware)
  app.use(errorHandler);

  // Start server — create an explicit http.Server so WebSocket can attach to it
  const httpServer = http.createServer(app);
  const pluginWebSocket = new PluginWebSocket(httpServer);
  setGraphWebSocket(pluginWebSocket);
  pluginManager.setPluginWebSocket(pluginWebSocket);

  httpServer.listen(PORT, () => {
    log.info(`Kryton server listening on port ${PORT}`);
    log.info(`Notes directory: ${NOTES_DIR}`);
  });
}

main().catch((err) => {
  log.error("Fatal error:", err);
  process.exit(1);
});
