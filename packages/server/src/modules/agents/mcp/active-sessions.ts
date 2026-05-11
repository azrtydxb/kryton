/**
 * Process-wide registry of live MCP sessions, shared by every transport
 * (SSE + Streamable HTTP). Each transport calls `register` on session create
 * and `unregister` on session close / reap.
 *
 * Used by `/api/agents/online` to drive the sidebar "agents online" indicator
 * — turns the previously-static "2 agents online" mock into a real count.
 *
 * Process-local by design: an MCP session lives only as long as the Node
 * process that opened it, so a single in-memory map matches its lifetime
 * exactly. Horizontal-scale deployments would replace this with Redis.
 */

export type McpTransport = "sse" | "streamable";

export interface ActiveSession {
  /** Unique session id (UUID). */
  sessionId: string;
  /** Authenticated user the session belongs to. */
  userId: string;
  /** Transport family — display this in the agents-online UI if useful. */
  transport: McpTransport;
  /** Optional client name reported via the MCP initialize handshake. */
  clientName?: string;
  /** Optional client version reported via the MCP initialize handshake. */
  clientVersion?: string;
  /** Wall-clock ms when the session was opened. */
  startedAt: number;
  /** Wall-clock ms of the last JSON-RPC activity (updated by transports). */
  lastActivity: number;
}

const sessions = new Map<string, ActiveSession>();

export function register(entry: ActiveSession): void {
  sessions.set(entry.sessionId, entry);
}

export function unregister(sessionId: string): void {
  sessions.delete(sessionId);
}

export function touch(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (s) s.lastActivity = Date.now();
}

export function updateClientInfo(
  sessionId: string,
  info: { clientName?: string; clientVersion?: string },
): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (info.clientName) s.clientName = info.clientName;
  if (info.clientVersion) s.clientVersion = info.clientVersion;
}

/** Snapshot of every active session for `userId`. */
export function listForUser(userId: string): ActiveSession[] {
  const out: ActiveSession[] = [];
  for (const s of sessions.values()) {
    if (s.userId === userId) out.push({ ...s });
  }
  return out;
}

/** Snapshot of every active session — admin-only consumers. */
export function listAll(): ActiveSession[] {
  return [...sessions.values()].map((s) => ({ ...s }));
}
