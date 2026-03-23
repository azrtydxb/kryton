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
import { provisionUserNotes } from "../services/userNotesDir";

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
export function createAuthRouter(notesDir: string): Router {
  const router = Router();

  // GET /auth/config — public auth configuration
  router.get("/config", async (_req: Request, res: Response) => {
    try {
      const settingsRepo = AppDataSource.getRepository(Settings);
      const row = await settingsRepo.findOneBy({ key: "registration_mode" });
      const registrationMode = row?.value ?? "open";
      res.json({
        registrationMode,
        googleEnabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        githubEnabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
        smtpEnabled: !!process.env.SMTP_HOST,
      });
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

      // Provision per-user notes directory with sample notes
      await provisionUserNotes(notesDir, savedUser.id);

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

  /**
   * @swagger
   * /auth/password:
   *   put:
   *     summary: Change password
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [currentPassword, newPassword]
   *             properties:
   *               currentPassword:
   *                 type: string
   *               newPassword:
   *                 type: string
   *                 minLength: 8
   *                 maxLength: 72
   *     responses:
   *       200:
   *         description: Password changed
   *       400:
   *         description: Validation error
   *       401:
   *         description: Current password incorrect
   */
  router.put("/password", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: "Current password and new password are required" });
        return;
      }
      if (newPassword.length < 8 || newPassword.length > 72) {
        res.status(400).json({ error: "New password must be 8-72 characters" });
        return;
      }

      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOneBy({ id: req.user!.id });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (!user.passwordHash) {
        res.status(400).json({ error: "Account uses OAuth only — set a password via admin or re-register" });
        return;
      }

      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      user.passwordHash = await bcrypt.hash(newPassword, 12);
      await userRepo.save(user);

      res.json({ ok: true });
    } catch (err) {
      console.error("Error changing password:", err);
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  // --------------- Forgot/Reset Password ---------------

  /**
   * @swagger
   * /auth/forgot-password:
   *   post:
   *     summary: Request a password reset
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [email]
   *             properties:
   *               email:
   *                 type: string
   *     responses:
   *       200:
   *         description: If email exists and SMTP is configured, a reset link is sent
   */
  router.post("/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      // Always return 200 to prevent email enumeration
      if (!email) { res.json({ ok: true }); return; }

      const smtpHost = process.env.SMTP_HOST;
      if (!smtpHost) {
        // SMTP not configured — silently succeed (admin can reset manually)
        res.json({ ok: true, message: "If SMTP is not configured, ask an admin to reset your password." });
        return;
      }

      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOneBy({ email });
      if (!user || user.disabled) { res.json({ ok: true }); return; }

      // Generate reset token
      const crypto = await import("crypto");
      const raw = crypto.randomBytes(32).toString("hex");
      const hash = crypto.createHash("sha256").update(raw).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      const { PasswordResetToken } = await import("../entities/PasswordResetToken");
      const resetRepo = AppDataSource.getRepository(PasswordResetToken);
      // Delete any existing tokens for this user
      await resetRepo.delete({ userId: user.id });
      const token = resetRepo.create({ userId: user.id, tokenHash: hash, expiresAt });
      const saved = await resetRepo.save(token);

      const resetUrl = `${process.env.APP_URL || "http://localhost:5173"}/reset-password?token=${saved.id}:${raw}`;

      // Send email via nodemailer
      try {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587", 10),
          secure: process.env.SMTP_SECURE === "true",
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || `"Mnemo" <noreply@${process.env.SMTP_HOST}>`,
          to: user.email,
          subject: "Mnemo — Password Reset",
          text: `You requested a password reset.\n\nClick here to reset your password:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, ignore this email.`,
          html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p>This link expires in 1 hour.</p><p>If you didn't request this, ignore this email.</p>`,
        });
      } catch (emailErr) {
        console.error("Failed to send reset email:", emailErr);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Error in forgot-password:", err);
      res.json({ ok: true }); // Don't leak errors
    }
  });

  /**
   * @swagger
   * /auth/reset-password:
   *   post:
   *     summary: Reset password using a token
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [token, newPassword]
   *             properties:
   *               token:
   *                 type: string
   *               newPassword:
   *                 type: string
   *     responses:
   *       200:
   *         description: Password reset successfully
   *       400:
   *         description: Invalid or expired token
   */
  router.post("/reset-password", async (req: Request, res: Response) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) { res.status(400).json({ error: "Token and new password are required" }); return; }
      if (newPassword.length < 8 || newPassword.length > 72) { res.status(400).json({ error: "Password must be 8-72 characters" }); return; }

      const parts = token.split(":");
      if (parts.length !== 2) { res.status(400).json({ error: "Invalid token format" }); return; }
      const [tokenId, rawToken] = parts;

      const crypto = await import("crypto");
      const { PasswordResetToken } = await import("../entities/PasswordResetToken");
      const resetRepo = AppDataSource.getRepository(PasswordResetToken);
      const record = await resetRepo.findOneBy({ id: tokenId });

      if (!record || record.expiresAt < new Date()) {
        if (record) await resetRepo.delete(record.id);
        res.status(400).json({ error: "Invalid or expired reset token" });
        return;
      }

      const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
      if (hash !== record.tokenHash) { res.status(400).json({ error: "Invalid reset token" }); return; }

      // Reset the password
      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOneBy({ id: record.userId });
      if (!user) { res.status(400).json({ error: "User not found" }); return; }

      user.passwordHash = await bcrypt.hash(newPassword, 12);
      await userRepo.save(user);

      // Clean up token and invalidate sessions
      await resetRepo.delete(record.id);
      const { deleteAllUserRefreshTokens } = await import("../services/tokenService");
      await deleteAllUserRefreshTokens(user.id);

      res.json({ ok: true });
    } catch (err) {
      console.error("Error in reset-password:", err);
      res.status(500).json({ error: "Failed to reset password" });
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
      const { user, isNewUser } = await resolveOAuthUser("google", profile, state);

      if (isNewUser) {
        await provisionUserNotes(notesDir, user.id);
      }

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
      const { user, isNewUser } = await resolveOAuthUser("github", profile, state);

      if (isNewUser) {
        await provisionUserNotes(notesDir, user.id);
      }

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
