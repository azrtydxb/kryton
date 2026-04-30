/**
 * Shared utilities for bench scripts.
 */
import { execSync } from "node:child_process";

export const SERVER_URL = process.env.BENCH_SERVER_URL ?? "http://localhost:3001";
export const BENCH_EMAIL = process.env.BENCH_EMAIL ?? "bench@test.local";
export const BENCH_PASSWORD = process.env.BENCH_PASSWORD ?? "Bench123!";

export interface AuthSession {
  token: string;
  userId: string;
  /** Cookie jar string for cookie-based auth */
  cookieHeader: string;
}

export interface PctResult {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
}

export function percentiles(latencies: number[]): PctResult {
  if (latencies.length === 0) throw new Error("Empty latency array");
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;
  const pct = (p: number) => sorted[Math.min(Math.floor(n * p), n - 1)]!;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return {
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    mean: Math.round(mean * 100) / 100,
    min: sorted[0]!,
    max: sorted[n - 1]!,
  };
}

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "Origin": process.env.APP_URL ?? "http://localhost:5173",
};

export async function provisionUser(): Promise<AuthSession> {
  // Try sign-in first; fall back to registration
  const trySignIn = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email: BENCH_EMAIL, password: BENCH_PASSWORD }),
  });

  let sessionToken: string;
  let userId: string;
  let cookieValue: string;

  if (trySignIn.ok) {
    const body = (await trySignIn.json()) as { token: string; user: { id: string } };
    sessionToken = body.token;
    userId = body.user.id;
    // Extract set-cookie header for cookie-based auth
    const raw = trySignIn.headers.get("set-cookie") ?? "";
    cookieValue = extractSessionCookie(raw, sessionToken);
  } else {
    // Register
    const reg = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ email: BENCH_EMAIL, password: BENCH_PASSWORD, name: "Bench User" }),
    });
    if (!reg.ok) throw new Error(`Registration failed: ${reg.status} ${await reg.text()}`);
    const regBody = (await reg.json()) as { token: string; user: { id: string } };
    sessionToken = regBody.token;
    userId = regBody.user.id;
    const raw = reg.headers.get("set-cookie") ?? "";
    cookieValue = extractSessionCookie(raw, sessionToken);
  }

  return { token: sessionToken, userId, cookieHeader: cookieValue };
}

function extractSessionCookie(setCookieHeader: string, fallbackToken: string): string {
  // Try to extract better-auth.session_token from set-cookie header
  const match = setCookieHeader.match(/better-auth\.session_token=([^;]+)/);
  if (match) return `better-auth.session_token=${match[1]}`;
  // Fallback: just use the token value
  return `better-auth.session_token=${encodeURIComponent(fallbackToken)}`;
}

export async function authFetch(
  session: AuthSession,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: session.cookieHeader,
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetch(url, { ...init, headers });
}

export function hardware(): string {
  try {
    return execSync("uname -a", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** Unique run ID to avoid unique-constraint collisions on repeated bench runs */
export const RUN_ID = Date.now().toString(36);

/**
 * Seed N notes via sync v2 push. Returns after all notes are accepted.
 * @param offset  Starting index (for incremental seeding without duplicates)
 */
export async function seedNotes(
  session: AuthSession,
  n: number,
  offset = 0,
): Promise<void> {
  const BATCH = 50;
  let seeded = 0;
  while (seeded < n) {
    const batchSize = Math.min(BATCH, n - seeded);
    const ops = Array.from({ length: batchSize }, (_, i) => ({
      op: "create" as const,
      id: `bench/${RUN_ID}/note-${offset + seeded + i}.md`,
      fields: {
        path: `bench/${RUN_ID}/note-${offset + seeded + i}.md`,
        title: `Bench Note ${offset + seeded + i}`,
        content: `# Bench Note ${offset + seeded + i}\nContent for bench note ${offset + seeded + i}. `.repeat(5),
        tags: "[]",
        modifiedAt: Date.now(),
      },
    }));
    const res = await authFetch(session, `${SERVER_URL}/api/sync/v2/push`, {
      method: "POST",
      body: JSON.stringify({ changes: { notes: ops } }),
    });
    if (!res.ok) throw new Error(`Seed push failed: ${res.status} ${await res.text()}`);
    seeded += batchSize;
  }
}

/**
 * Seed N folders via sync v2 push.
 * @param offset  Starting index (for incremental seeding without duplicates)
 */
export async function seedFolders(
  session: AuthSession,
  n: number,
  offset = 0,
): Promise<void> {
  const BATCH = 50;
  let seeded = 0;
  while (seeded < n) {
    const batchSize = Math.min(BATCH, n - seeded);
    const ops = Array.from({ length: batchSize }, (_, i) => ({
      op: "create" as const,
      id: `folder-bench-${RUN_ID}-${offset + seeded + i}`,
      fields: {
        id: `folder-bench-${RUN_ID}-${offset + seeded + i}`,
        path: `bench/${RUN_ID}/folder-${offset + seeded + i}`,
        parentId: null,
      },
    }));
    const res = await authFetch(session, `${SERVER_URL}/api/sync/v2/push`, {
      method: "POST",
      body: JSON.stringify({ changes: { folders: ops } }),
    });
    if (!res.ok) throw new Error(`Seed folders failed: ${res.status} ${await res.text()}`);
    seeded += batchSize;
  }
}

/**
 * Seed N tags via sync v2 push.
 * @param offset  Starting index (for incremental seeding without duplicates)
 */
export async function seedTags(
  session: AuthSession,
  n: number,
  offset = 0,
): Promise<void> {
  const BATCH = 50;
  let seeded = 0;
  while (seeded < n) {
    const batchSize = Math.min(BATCH, n - seeded);
    const ops = Array.from({ length: batchSize }, (_, i) => ({
      op: "create" as const,
      id: `tag-bench-${RUN_ID}-${offset + seeded + i}`,
      fields: {
        id: `tag-bench-${RUN_ID}-${offset + seeded + i}`,
        name: `bench-tag-${RUN_ID}-${offset + seeded + i}`,
      },
    }));
    const res = await authFetch(session, `${SERVER_URL}/api/sync/v2/push`, {
      method: "POST",
      body: JSON.stringify({ changes: { tags: ops } }),
    });
    if (!res.ok) throw new Error(`Seed tags failed: ${res.status} ${await res.text()}`);
    seeded += batchSize;
  }
}
