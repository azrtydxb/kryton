import http from "http";
import express, { Request, Response } from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import swaggerUi from "swagger-ui-express";
import * as path from "path";
import * as fs from "fs/promises";
import { prisma } from "./prisma.js";
import { swaggerSpec } from "./swagger.js";
import { auth } from "./auth.js";
import { authMiddleware, adminMiddleware } from "./middleware/auth.js";
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

const PORT = parseInt(process.env.PORT || "3001", 10);
const NOTES_DIR = path.resolve(
  process.env.NOTES_DIR || path.join(import.meta.dirname, "../../notes")
);

async function main(): Promise<void> {
  // Initialize the database
  try {
    await prisma.$connect();
    console.log("Database connection established.");
  } catch (err) {
    console.error("Failed to connect to database:", err);
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
  } catch (err) {
    console.log("Orphan cleanup skipped (table may have been recreated):", err);
  }

  // Ensure registration_mode global setting exists
  const GLOBAL_USER = "__global__";
  const regMode = await prisma.settings.findUnique({
    where: { key_userId: { key: "registration_mode", userId: GLOBAL_USER } },
  });
  if (!regMode) {
    await prisma.settings.create({
      data: { key: "registration_mode", value: "open", userId: GLOBAL_USER },
    });
    console.log("Created default registration_mode = open");
  }

  // Note: per-user indexing is now handled during provisioning and login.
  console.log("Startup complete — per-user notes are indexed on demand.");

  // Create Express app
  const app = express();

  // Middleware
  app.use(cors({
    origin: process.env.APP_URL || "http://localhost:5173",
    credentials: true,
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
      console.warn(`[plugins] Auto-disabling plugin ${pluginId} due to excessive errors`);
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

  // Serve plugin client bundles as static files
  app.use("/plugins", express.static(pluginsDir));

  // better-auth handler (replaces old routes/auth.ts)
  app.all("/api/auth/*splat", toNodeHandler(auth));

  // Swagger API docs (unauthenticated, GET-only)
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Mnemo API Docs',
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
   *                 notesDir:
   *                   type: string
   *                   example: /path/to/notes
   */
  // Health check (unauthenticated, GET-only)
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", notesDir: NOTES_DIR });
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
  app.get("/api/files/{*path}", authMiddleware, async (req: Request, res: Response) => {
    const filePath = decodeURIComponent(Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path as string);
    const allowedExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"];
    const ext = path.extname(filePath).toLowerCase();

    if (!allowedExts.includes(ext)) {
      res.status(403).json({ error: "File type not allowed" });
      return;
    }

    const userDir = await getUserNotesDir(NOTES_DIR, req.user!.id);
    const fullPath = path.resolve(path.join(userDir, filePath));
    const resolvedBase = path.resolve(userDir);
    if (!fullPath.startsWith(resolvedBase + path.sep) && fullPath !== resolvedBase) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }

    try {
      await fs.stat(fullPath);
      res.sendFile(fullPath);
    } catch {
      res.status(404).json({ error: "File not found" });
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
      console.log(`Serving static files from ${publicDir}`);
    }
  } catch {
    // No public directory — running in dev mode
  }

  // Start server — create an explicit http.Server so WebSocket can attach to it
  const httpServer = http.createServer(app);
  const pluginWebSocket = new PluginWebSocket(httpServer);
  pluginManager.setPluginWebSocket(pluginWebSocket);

  httpServer.listen(PORT, () => {
    console.log(`Mnemo server listening on port ${PORT}`);
    console.log(`Notes directory: ${NOTES_DIR}`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
