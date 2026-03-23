import crypto from "crypto";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../data-source";
import { RefreshToken } from "../entities/RefreshToken";
import { User } from "../entities/User";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_DAYS = 30;

export const REFRESH_COOKIE_NAME = "mnemo_refresh";

export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
  path: "/",
};

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
}

export function generateAccessToken(user: {
  id: string;
  email: string;
  role: string;
}): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, JWT_SECRET) as AccessTokenPayload;
  return { sub: payload.sub, email: payload.email, role: payload.role };
}

export async function createRefreshToken(
  userId: string,
): Promise<{ cookieValue: string }> {
  const repo = AppDataSource.getRepository(RefreshToken);

  const rawToken = crypto.randomBytes(64).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_DAYS);

  const refreshToken = repo.create({ userId, tokenHash, expiresAt });
  const saved = await repo.save(refreshToken);

  return { cookieValue: `${saved.id}:${rawToken}` };
}

export async function validateRefreshToken(
  cookieValue: string,
): Promise<User | null> {
  const colonIndex = cookieValue.indexOf(":");
  if (colonIndex === -1) return null;

  const tokenId = cookieValue.substring(0, colonIndex);
  const rawToken = cookieValue.substring(colonIndex + 1);

  const refreshRepo = AppDataSource.getRepository(RefreshToken);
  const stored = await refreshRepo.findOneBy({ id: tokenId });

  if (!stored) return null;
  if (stored.expiresAt < new Date()) {
    await refreshRepo.delete({ id: tokenId });
    return null;
  }

  const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(stored.tokenHash))) {
    return null;
  }

  // Delete the old token (caller creates a new one for rotation)
  await refreshRepo.delete({ id: tokenId });

  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOneBy({ id: stored.userId });

  if (!user || user.disabled) return null;

  return user;
}

export async function deleteRefreshToken(cookieValue: string): Promise<void> {
  const colonIndex = cookieValue.indexOf(":");
  if (colonIndex === -1) return;

  const tokenId = cookieValue.substring(0, colonIndex);
  const repo = AppDataSource.getRepository(RefreshToken);
  await repo.delete({ id: tokenId });
}

export async function deleteAllUserRefreshTokens(
  userId: string,
): Promise<void> {
  const repo = AppDataSource.getRepository(RefreshToken);
  await repo.delete({ userId });
}
