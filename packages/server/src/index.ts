import "reflect-metadata";
import http from "http";
import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import * as path from "path";
import * as fs from "fs/promises";
import { IsNull } from "typeorm";
import { AppDataSource } from "./data-source";
import { swaggerSpec } from "./swagger";
import { authMiddleware, adminMiddleware, csrfCheck } from "./middleware/auth";
import { createAuthRouter } from "./routes/auth";
import { createAdminRouter } from "./routes/admin";
import { createNotesRouter, createNotesRenameRouter, createSharedNotesRouter } from "./routes/notes";
import { createFoldersRouter, createFoldersRenameRouter } from "./routes/folders";
import { createSearchRouter } from "./routes/search";
import { createGraphRouter } from "./routes/graph";
import { createSettingsRouter } from "./routes/settings";
import { createBacklinksRouter } from "./routes/backlinks";
import { createTagsRouter } from "./routes/tags";
import { createDailyRouter } from "./routes/daily";
import { createTemplatesRouter } from "./routes/templates";
import { createCanvasRouter } from "./routes/canvas";
import { createSharesRouter, createAccessRequestsRouter } from "./routes/shares";
import { createUsersRouter } from "./routes/users";
import { cleanupOldNotes, getUserNotesDir } from "./services/userNotesDir";
import { SearchIndex } from "./entities/SearchIndex";
import { GraphEdge } from "./entities/GraphEdge";
import { Settings } from "./entities/Settings";
import { InstalledPlugin } from "./entities/InstalledPlugin";
import { PluginEventBus } from "./plugins/PluginEventBus";
import { PluginHealthMonitor } from "./plugins/PluginHealthMonitor";
import { PluginRouter } from "./plugins/PluginRouter";
import { PluginApiFactory } from "./plugins/PluginApiFactory";
import { PluginManager } from "./plugins/PluginManager";
import { PluginWebSocket } from "./plugins/PluginWebSocket";
import { createPluginsRouter } from "./routes/plugins";

const PORT = parseInt(process.env.PORT || "3001", 10);
const NOTES_DIR = path.resolve(
  process.env.NOTES_DIR || path.join(__dirname, "../../notes")
);

async function main(): Promise<void> {
  // Initialize the database
  try {
    await AppDataSource.initialize();
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
    await AppDataSource.getRepository(SearchIndex).delete({ userId: "" });
    await AppDataSource.getRepository(GraphEdge).delete({ userId: "" });
  } catch (err) {
    console.log("Orphan cleanup skipped (table may have been recreated):", err);
  }

  // Ensure registration_mode global setting exists
  const settingsRepo = AppDataSource.getRepository(Settings);
  const regMode = await settingsRepo.findOneBy({ key: "registration_mode", userId: IsNull() });
  if (!regMode) {
    const s = settingsRepo.create({ key: "registration_mode", value: "open", userId: null });
    await settingsRepo.save(s);
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
  app.use(cookieParser());

  // Plugin system initialization
  const pluginsDir = path.join(process.cwd(), "plugins");
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
      const repo = AppDataSource.getRepository(InstalledPlugin);
      await repo.update(pluginId, { enabled: false, state: "error", error: "Auto-disabled: too many errors" });
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
    dataSource: AppDataSource,
  });
  managerRef.instance = pluginManager;

  // Discover and load plugins from the plugins directory
  await pluginManager.discoverAndLoadPlugins();

  // Serve plugin client bundles as static files
  app.use("/plugins", express.static(pluginsDir));

  // Auth routes (unauthenticated, no CSRF)
  app.use("/api/auth", createAuthRouter(NOTES_DIR));

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

  // CSRF protection for all remaining routes
  app.use(csrfCheck);

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
  const publicDir = path.join(__dirname, "../public");
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
