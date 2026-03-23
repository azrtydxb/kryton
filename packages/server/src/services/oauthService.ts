import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import { AuthProvider } from "../entities/AuthProvider";
import { Settings } from "../entities/Settings";
import { InviteCode } from "../entities/InviteCode";

// Environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const APP_URL = process.env.APP_URL || "http://localhost:5173";

export interface OAuthProfile {
  email: string;
  name: string;
  avatarUrl: string | null;
  providerAccountId: string;
}

// --------------- Google ---------------

export function getGoogleAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });
  if (state) {
    params.set("state", state);
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string): Promise<OAuthProfile> {
  // Exchange authorization code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: `${APP_URL}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };

  // Fetch user profile
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!profileRes.ok) {
    throw new Error("Failed to fetch Google user profile");
  }

  const profile = (await profileRes.json()) as {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };

  return {
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.picture ?? null,
    providerAccountId: profile.id,
  };
}

// --------------- GitHub ---------------

export function getGitHubAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/auth/github/callback`,
    scope: "user:email",
  });
  if (state) {
    params.set("state", state);
  }
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGitHubCode(code: string): Promise<OAuthProfile> {
  // Exchange authorization code for access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${APP_URL}/api/auth/github/callback`,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error("GitHub token exchange failed");
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    error?: string;
  };

  if (tokenData.error) {
    throw new Error(`GitHub token error: ${tokenData.error}`);
  }

  // Fetch user profile
  const profileRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/json",
      "User-Agent": "mnemo-app",
    },
  });

  if (!profileRes.ok) {
    throw new Error("Failed to fetch GitHub user profile");
  }

  const profile = (await profileRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  };

  let email = profile.email;

  // If email is null, fetch from /user/emails
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/json",
        "User-Agent": "mnemo-app",
      },
    });

    if (!emailsRes.ok) {
      throw new Error("Failed to fetch GitHub user emails");
    }

    const emails = (await emailsRes.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;

    const primary = emails.find((e) => e.primary && e.verified);
    if (!primary) {
      throw new Error("No verified primary email found on GitHub account");
    }
    email = primary.email;
  }

  return {
    email,
    name: profile.name || profile.login,
    avatarUrl: profile.avatar_url ?? null,
    providerAccountId: String(profile.id),
  };
}

// --------------- Shared ---------------

export async function resolveOAuthUser(
  provider: string,
  profile: OAuthProfile,
  inviteCode: string | null,
): Promise<User> {
  const authProviderRepo = AppDataSource.getRepository(AuthProvider);
  const userRepo = AppDataSource.getRepository(User);
  const settingsRepo = AppDataSource.getRepository(Settings);
  const inviteRepo = AppDataSource.getRepository(InviteCode);

  // 1. Look up AuthProvider by (provider, providerAccountId)
  const existingProvider = await authProviderRepo.findOne({
    where: { provider, providerAccountId: profile.providerAccountId },
  });

  if (existingProvider) {
    const user = await userRepo.findOneBy({ id: existingProvider.userId });
    if (!user) {
      throw new Error("Linked user not found");
    }
    if (user.disabled) {
      throw new Error("Account is disabled");
    }
    return user;
  }

  // 2. Look up User by email — link provider to existing user
  const existingUser = await userRepo.findOneBy({ email: profile.email });
  if (existingUser) {
    if (existingUser.disabled) {
      throw new Error("Account is disabled");
    }
    const newProvider = authProviderRepo.create({
      userId: existingUser.id,
      provider,
      providerAccountId: profile.providerAccountId,
    });
    await authProviderRepo.save(newProvider);

    // Update avatar if not set
    if (!existingUser.avatarUrl && profile.avatarUrl) {
      existingUser.avatarUrl = profile.avatarUrl;
      await userRepo.save(existingUser);
    }

    return existingUser;
  }

  // 3. Completely new user — check registration_mode
  const modeRow = await settingsRepo.findOneBy({ key: "registration_mode" });
  const registrationMode = modeRow?.value ?? "open";

  let invite: InviteCode | null = null;
  if (registrationMode === "invite-only") {
    if (!inviteCode) {
      throw new Error("Registration requires an invite code");
    }
    invite = await inviteRepo.findOneBy({ code: inviteCode });
    if (!invite) {
      throw new Error("Invalid invite code");
    }
    if (invite.usedBy) {
      throw new Error("Invite code has already been used");
    }
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new Error("Invite code has expired");
    }
  }

  // Determine role — first user becomes admin
  const userCount = await userRepo.count();
  const role = userCount === 0 ? "admin" : "user";

  // Create user
  const user = userRepo.create({
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    role,
  });
  const savedUser = await userRepo.save(user);

  // Create auth provider link
  const newProvider = authProviderRepo.create({
    userId: savedUser.id,
    provider,
    providerAccountId: profile.providerAccountId,
  });
  await authProviderRepo.save(newProvider);

  // Mark invite as used
  if (invite) {
    invite.usedBy = savedUser.id;
    await inviteRepo.save(invite);
  }

  return savedUser;
}
