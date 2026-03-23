import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import { Settings } from "../entities/Settings";
import { InviteCode } from "../entities/InviteCode";
import { authMiddleware } from "../middleware/auth";
import {
  generateAccessToken,
  createRefreshToken,
  validateRefreshToken,
  deleteRefreshToken,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_OPTIONS,
} from "../services/tokenService";
import {
  getGoogleAuthUrl,
  exchangeGoogleCode,
  getGitHubAuthUrl,
  exchangeGitHubCode,
  resolveOAuthUser,
} from "../services/oauthService";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatarUrl,
  };
}

/**
 * @swagger
 * /auth/config:
 *   get:
 *     summary: Get auth configuration
 *     description: Returns the current registration mode (open or invite-only).
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Auth configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 registrationMode:
 *                   type: string
 *                   enum: [open, invite-only]
 *                   example: open
 *       500:
 *         description: Failed to fetch auth config
 */
/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     description: Creates a new user account with email and password. The first registered user is automatically assigned the admin role.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, name]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 maxLength: 72
 *                 example: securepassword
 *               name:
 *                 type: string
 *                 example: John Doe
 *               inviteCode:
 *                 type: string
 *                 description: Required when registration mode is invite-only
 *     responses:
 *       200:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     name:
 *                       type: string
 *                     role:
 *                       type: string
 *                     avatarUrl:
 *                       type: string
 *                       nullable: true
 *                 accessToken:
 *                   type: string
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid or expired invite code
 *       409:
 *         description: Email already registered
 *       500:
 *         description: Registration failed
 */
/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Log in with email and password
 *     description: Authenticates a user and returns access and refresh tokens.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     name:
 *                       type: string
 *                     role:
 *                       type: string
 *                     avatarUrl:
 *                       type: string
 *                       nullable: true
 *                 accessToken:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Login failed
 */
/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     description: Uses the httpOnly refresh cookie to issue a new access token and rotate the refresh token.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Tokens refreshed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     name:
 *                       type: string
 *                     role:
 *                       type: string
 *                     avatarUrl:
 *                       type: string
 *                       nullable: true
 *                 accessToken:
 *                   type: string
 *       401:
 *         description: Missing or invalid refresh token
 */
/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Log out
 *     description: Invalidates the refresh token and clears the cookie.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 */
/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user
 *     description: Returns the authenticated user's profile. Requires a valid access token.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 email:
 *                   type: string
 *                 name:
 *                   type: string
 *                 role:
 *                   type: string
 *                 avatarUrl:
 *                   type: string
 *                   nullable: true
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: User not found
 */
export function createAuthRouter(): Router {
  const router = Router();

  // GET /auth/config — public auth configuration
  router.get("/config", async (_req: Request, res: Response) => {
    try {
      const settingsRepo = AppDataSource.getRepository(Settings);
      const row = await settingsRepo.findOneBy({ key: "registration_mode" });
      const registrationMode = row?.value ?? "open";
      res.json({ registrationMode });
    } catch (err) {
      console.error("Error fetching auth config:", err);
      res.status(500).json({ error: "Failed to fetch auth config" });
    }
  });

  // POST /auth/register — email/password registration
  router.post("/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name, inviteCode } = req.body as {
        email?: string;
        password?: string;
        name?: string;
        inviteCode?: string;
      };

      // Validation
      if (!email || !EMAIL_REGEX.test(email)) {
        res.status(400).json({ error: "Invalid email format" });
        return;
      }
      if (!password || password.length < 8 || password.length > 72) {
        res.status(400).json({ error: "Password must be between 8 and 72 characters" });
        return;
      }
      if (!name || name.trim().length === 0) {
        res.status(400).json({ error: "Name is required" });
        return;
      }

      const userRepo = AppDataSource.getRepository(User);
      const settingsRepo = AppDataSource.getRepository(Settings);
      const inviteRepo = AppDataSource.getRepository(InviteCode);

      // Check registration mode
      const modeRow = await settingsRepo.findOneBy({ key: "registration_mode" });
      const registrationMode = modeRow?.value ?? "open";

      let invite: InviteCode | null = null;
      if (registrationMode === "invite-only") {
        if (!inviteCode) {
          res.status(401).json({ error: "Invite code is required" });
          return;
        }
        invite = await inviteRepo.findOneBy({ code: inviteCode });
        if (!invite) {
          res.status(401).json({ error: "Invalid invite code" });
          return;
        }
        if (invite.usedBy) {
          res.status(401).json({ error: "Invite code has already been used" });
          return;
        }
        if (invite.expiresAt && invite.expiresAt < new Date()) {
          res.status(401).json({ error: "Invite code has expired" });
          return;
        }
      }

      // Check if email already exists
      const existing = await userRepo.findOneBy({ email });
      if (existing) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Determine role — first user becomes admin
      const userCount = await userRepo.count();
      const role = userCount === 0 ? "admin" : "user";

      // Create user
      const user = userRepo.create({
        email,
        name: name.trim(),
        passwordHash,
        role,
      });
      const savedUser = await userRepo.save(user);

      // Mark invite code as used
      if (invite) {
        invite.usedBy = savedUser.id;
        await inviteRepo.save(invite);
      }

      // Generate tokens
      const accessToken = generateAccessToken(savedUser);
      const { cookieValue } = await createRefreshToken(savedUser.id);
      res.cookie(REFRESH_COOKIE_NAME, cookieValue, REFRESH_COOKIE_OPTIONS);

      res.json({ user: sanitizeUser(savedUser), accessToken });
    } catch (err) {
      console.error("Registration error:", err);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // POST /auth/login — email/password login
  router.post("/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as {
        email?: string;
        password?: string;
      };

      if (!email || !password) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOneBy({ email });

      if (!user) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      if (user.disabled) {
        res.status(401).json({ error: "Account is disabled" });
        return;
      }

      if (!user.passwordHash) {
        res.status(401).json({ error: "Use OAuth to sign in" });
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      // Generate tokens
      const accessToken = generateAccessToken(user);
      const { cookieValue } = await createRefreshToken(user.id);
      res.cookie(REFRESH_COOKIE_NAME, cookieValue, REFRESH_COOKIE_OPTIONS);

      res.json({ user: sanitizeUser(user), accessToken });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // POST /auth/refresh — token refresh (no CSRF check)
  router.post("/refresh", async (req: Request, res: Response) => {
    try {
      const cookieValue = req.cookies?.[REFRESH_COOKIE_NAME];
      if (!cookieValue) {
        res.status(401).json({ error: "Missing refresh token" });
        return;
      }

      const user = await validateRefreshToken(cookieValue);
      if (!user) {
        res.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
        res.status(401).json({ error: "Invalid or expired refresh token" });
        return;
      }

      // Rotate: create new refresh token and access token
      const accessToken = generateAccessToken(user);
      const { cookieValue: newCookieValue } = await createRefreshToken(user.id);
      res.cookie(REFRESH_COOKIE_NAME, newCookieValue, REFRESH_COOKIE_OPTIONS);

      res.json({ user: sanitizeUser(user), accessToken });
    } catch (err) {
      console.error("Refresh error:", err);
      res.status(500).json({ error: "Token refresh failed" });
    }
  });

  // POST /auth/logout — logout
  router.post("/logout", async (req: Request, res: Response) => {
    try {
      const cookieValue = req.cookies?.[REFRESH_COOKIE_NAME];
      if (cookieValue) {
        await deleteRefreshToken(cookieValue);
      }
      res.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("Logout error:", err);
      res.status(500).json({ error: "Logout failed" });
    }
  });

  // GET /auth/me — get current user (requires auth)
  router.get("/me", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOneBy({ id: req.user!.id });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json(sanitizeUser(user));
    } catch (err) {
      console.error("Error fetching user:", err);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // --------------- OAuth: Google ---------------

  /**
   * @swagger
   * /auth/google:
   *   get:
   *     summary: Initiate Google OAuth login
   *     description: Redirects the user to Google's OAuth consent screen. Returns 404 if Google OAuth is not configured.
   *     tags: [Auth]
   *     parameters:
   *       - in: query
   *         name: inviteCode
   *         schema:
   *           type: string
   *         description: Optional invite code passed through as OAuth state
   *     responses:
   *       302:
   *         description: Redirect to Google OAuth consent screen
   *       404:
   *         description: Google OAuth not configured
   */
  router.get("/google", (req: Request, res: Response) => {
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    if (!clientId) {
      res.status(404).json({ error: "Google OAuth is not configured" });
      return;
    }
    const inviteCode = (req.query.inviteCode as string) || undefined;
    const url = getGoogleAuthUrl(inviteCode);
    res.redirect(url);
  });

  /**
   * @swagger
   * /auth/google/callback:
   *   get:
   *     summary: Google OAuth callback
   *     description: Handles the callback from Google OAuth. Exchanges the authorization code, resolves the user, and redirects to the app.
   *     tags: [Auth]
   *     parameters:
   *       - in: query
   *         name: code
   *         required: true
   *         schema:
   *           type: string
   *         description: Authorization code from Google
   *       - in: query
   *         name: state
   *         schema:
   *           type: string
   *         description: State parameter (invite code)
   *     responses:
   *       302:
   *         description: Redirect to app with auth result
   */
  router.get("/google/callback", async (req: Request, res: Response) => {
    const appUrl = process.env.APP_URL || "http://localhost:5173";
    try {
      const code = req.query.code as string;
      const state = (req.query.state as string) || null;

      if (!code) {
        res.redirect(`${appUrl}/login?error=oauth-failed`);
        return;
      }

      const profile = await exchangeGoogleCode(code);
      const user = await resolveOAuthUser("google", profile, state);

      const accessToken = generateAccessToken(user);
      const { cookieValue } = await createRefreshToken(user.id);
      res.cookie(REFRESH_COOKIE_NAME, cookieValue, REFRESH_COOKIE_OPTIONS);

      res.redirect(`${appUrl}/?auth=success&token=${accessToken}`);
    } catch (err) {
      console.error("Google OAuth error:", err);
      res.redirect(`${appUrl}/login?error=oauth-failed`);
    }
  });

  // --------------- OAuth: GitHub ---------------

  /**
   * @swagger
   * /auth/github:
   *   get:
   *     summary: Initiate GitHub OAuth login
   *     description: Redirects the user to GitHub's OAuth authorization screen. Returns 404 if GitHub OAuth is not configured.
   *     tags: [Auth]
   *     parameters:
   *       - in: query
   *         name: inviteCode
   *         schema:
   *           type: string
   *         description: Optional invite code passed through as OAuth state
   *     responses:
   *       302:
   *         description: Redirect to GitHub OAuth authorization screen
   *       404:
   *         description: GitHub OAuth not configured
   */
  router.get("/github", (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID || "";
    if (!clientId) {
      res.status(404).json({ error: "GitHub OAuth is not configured" });
      return;
    }
    const inviteCode = (req.query.inviteCode as string) || undefined;
    const url = getGitHubAuthUrl(inviteCode);
    res.redirect(url);
  });

  /**
   * @swagger
   * /auth/github/callback:
   *   get:
   *     summary: GitHub OAuth callback
   *     description: Handles the callback from GitHub OAuth. Exchanges the authorization code, resolves the user, and redirects to the app.
   *     tags: [Auth]
   *     parameters:
   *       - in: query
   *         name: code
   *         required: true
   *         schema:
   *           type: string
   *         description: Authorization code from GitHub
   *       - in: query
   *         name: state
   *         schema:
   *           type: string
   *         description: State parameter (invite code)
   *     responses:
   *       302:
   *         description: Redirect to app with auth result
   */
  router.get("/github/callback", async (req: Request, res: Response) => {
    const appUrl = process.env.APP_URL || "http://localhost:5173";
    try {
      const code = req.query.code as string;
      const state = (req.query.state as string) || null;

      if (!code) {
        res.redirect(`${appUrl}/login?error=oauth-failed`);
        return;
      }

      const profile = await exchangeGitHubCode(code);
      const user = await resolveOAuthUser("github", profile, state);

      const accessToken = generateAccessToken(user);
      const { cookieValue } = await createRefreshToken(user.id);
      res.cookie(REFRESH_COOKIE_NAME, cookieValue, REFRESH_COOKIE_OPTIONS);

      res.redirect(`${appUrl}/?auth=success&token=${accessToken}`);
    } catch (err) {
      console.error("GitHub OAuth error:", err);
      res.redirect(`${appUrl}/login?error=oauth-failed`);
    }
  });

  return router;
}
