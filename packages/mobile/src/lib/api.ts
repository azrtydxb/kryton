import { storage } from "./storage";

// ---- Types ----

export interface SyncPullResponse {
  changes: {
    notes: SyncTableChanges;
    settings: SyncTableChanges;
    note_shares: SyncTableChanges;
    trash_items: SyncTableChanges;
  };
  timestamp: number;
}

export interface SyncTableChanges {
  created: object[];
  updated: object[];
  deleted: string[];
}

export interface NoteVersion {
  timestamp: number;
  date: string;
  size: number;
}

export interface NoteVersionContent {
  content: string;
  timestamp: number;
  date: string;
}

export interface TrashItem {
  path: string;
  originalPath: string;
  trashedAt: string;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  scope: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreateApiKeyResponse extends ApiKeyInfo {
  key: string;
}

export interface AccessRequestData {
  id: string;
  requesterUserId: string;
  ownerUserId: string;
  notePath: string;
  status: string;
  createdAt: string;
  requesterName?: string;
  requesterEmail?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

// ---- HTTP helpers ----

async function getBaseUrl(): Promise<string> {
  const url = await storage.getServerUrl();
  if (!url) throw new Error("Server URL not configured");
  return url.replace(/\/$/, "");
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const [baseUrl, apiKey] = await Promise.all([
    getBaseUrl(),
    storage.getApiKey(),
  ]);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    await storage.clearAuth();
    throw new Error("Unauthorized — please sign in again");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || res.statusText);
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
}

// ---- API ----

export const api = {
  // Auth — uses better-auth endpoints at /api/auth/*
  login: (email: string, password: string) =>
    request<{ token: string; user: AuthUser }>("/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (name: string, email: string, password: string) =>
    request<{ token: string; user: AuthUser }>("/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    }),

  getSession: () =>
    request<{ user: AuthUser; session: object }>("/auth/get-session"),

  // API Keys
  createApiKey: (
    name: string,
    scope: "read-only" | "read-write",
    expiresAt?: string
  ) =>
    request<CreateApiKeyResponse>("/api-keys", {
      method: "POST",
      body: JSON.stringify({ name, scope, ...(expiresAt ? { expiresAt } : {}) }),
    }),

  listApiKeys: () => request<ApiKeyInfo[]>("/api-keys"),

  // Sync
  syncPull: (lastPulledAt: number) =>
    request<SyncPullResponse>("/sync/pull", {
      method: "POST",
      body: JSON.stringify({ last_pulled_at: lastPulledAt }),
    }),

  syncPush: (changes: object, lastPulledAt: number) =>
    request<void>("/sync/push", {
      method: "POST",
      body: JSON.stringify({ changes, last_pulled_at: lastPulledAt }),
    }),

  // History
  listVersions: (notePath: string) =>
    request<{ versions: NoteVersion[] }>(
      `/history/${encodeURIComponent(notePath)}`
    ),

  getVersion: (notePath: string, timestamp: number) =>
    request<NoteVersionContent>(
      `/history-version/${encodeURIComponent(notePath)}?ts=${timestamp}`
    ),

  restoreVersion: (notePath: string, timestamp: number) =>
    request<{ restored: boolean }>(
      `/history-restore/${encodeURIComponent(notePath)}?ts=${timestamp}`,
      { method: "POST" }
    ),

  // Files
  uploadFile: async (
    fileUri: string,
    filename: string,
    mimeType: string
  ): Promise<{ path: string; url: string }> => {
    const [baseUrl, apiKey] = await Promise.all([
      getBaseUrl(),
      storage.getApiKey(),
    ]);

    const formData = new FormData();
    formData.append("file", {
      uri: fileUri,
      name: filename,
      type: mimeType,
    } as unknown as Blob);

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${baseUrl}/api/files`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error || res.statusText);
    }

    return res.json();
  },

  // Trash
  listTrash: () => request<TrashItem[]>("/trash"),

  restoreFromTrash: (notePath: string) =>
    request<{ message: string; path: string }>(
      `/trash/restore/${encodeURIComponent(notePath)}`,
      { method: "POST" }
    ),

  emptyTrash: () =>
    request<{ message: string }>("/trash-empty", { method: "DELETE" }),

  // Users
  listUsers: () =>
    request<{ id: string; name: string; email: string }[]>("/users/search"),

  // Access Requests
  listAccessRequests: () =>
    request<AccessRequestData[]>("/access-requests"),
};
