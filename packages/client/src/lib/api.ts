import { ActivePluginInfo } from "../plugins/types";

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
}

export interface NoteData {
  path: string;
  content: string;
  title: string;
  modifiedAt: string;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  tags: string[];
  isShared?: boolean;
  ownerUserId?: string;
}

export interface GraphData {
  nodes: { id: string; title: string; path: string; shared?: boolean; ownerUserId?: string }[];
  edges: { fromNoteId: string; toNoteId: string }[];
}

export interface BacklinkData {
  path: string;
  title: string;
}

export interface TagData {
  tag: string;
  count: number;
}

export interface TagNoteData {
  notePath: string;
  title: string;
}

export interface TemplateData {
  name: string;
  path: string;
}

export interface TemplateContent {
  name: string;
  content: string;
}

export interface CanvasData {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: { notePath: string; label: string; content?: string };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
  }>;
}

export interface NoteShareData {
  id: string;
  ownerUserId: string;
  path: string;
  isFolder: boolean;
  sharedWithUserId: string;
  permission: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedWithMeData {
  id: string;
  ownerUserId: string;
  ownerName: string;
  path: string;
  isFolder: boolean;
  permission: string;
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

export interface RegistryPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  minKrytonVersion: string;
  tags: string[];
  icon: string;
}

export interface PluginUpdate {
  id: string;
  currentVersion: string;
  latestVersion: string;
}

export interface TrashItem {
  path: string;
  originalPath: string;
  trashedAt: string;
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

const BASE = '/api';

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  // Notes
  getNotes: () => request<FileNode[]>('/notes'),
  getNote: (path: string) => request<NoteData>(`/notes/${encodeURIComponent(path)}`),
  createNote: (path: string, content: string) =>
    request<NoteData>('/notes', { method: 'POST', body: JSON.stringify({ path, content }) }),
  updateNote: (path: string, content: string) =>
    request<NoteData>(`/notes/${encodeURIComponent(path)}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  deleteNote: (path: string) =>
    request<void>(`/notes/${encodeURIComponent(path)}`, { method: 'DELETE' }),
  renameNote: (path: string, newPath: string) =>
    request<void>(`/notes-rename/${encodeURIComponent(path)}`, { method: 'POST', body: JSON.stringify({ newPath }) }),

  // Folders
  createFolder: (path: string) =>
    request<void>('/folders', { method: 'POST', body: JSON.stringify({ path }) }),
  deleteFolder: (path: string) =>
    request<void>(`/folders/${encodeURIComponent(path)}`, { method: 'DELETE' }),
  renameFolder: (path: string, newPath: string) =>
    request<void>(`/folders-rename/${encodeURIComponent(path)}`, { method: 'POST', body: JSON.stringify({ newPath }) }),

  // Search
  search: (query: string) => request<SearchResult[]>(`/search?q=${encodeURIComponent(query)}`),

  // Graph
  getGraph: () => request<GraphData>('/graph'),

  // Settings
  getSettings: () => request<Record<string, string>>('/settings'),
  updateSetting: (key: string, value: string) =>
    request<void>(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),

  // Backlinks
  getBacklinks: (path: string) => request<BacklinkData[]>(`/backlinks/${encodeURIComponent(path)}`),

  // Tags
  getTags: () => request<TagData[]>('/tags'),
  getNotesByTag: (tag: string) => request<TagNoteData[]>(`/tags/${encodeURIComponent(tag)}/notes`),

  // Templates
  getTemplates: () => request<TemplateData[]>('/templates'),
  getTemplateContent: (name: string) => request<TemplateContent>(`/templates/${encodeURIComponent(name)}`),

  // Daily note
  createDailyNote: () => request<NoteData>('/daily', { method: 'POST' }),

  // Canvas
  getCanvasList: () => request<string[]>('/canvas'),
  getCanvas: (name: string) => request<CanvasData>(`/canvas/${encodeURIComponent(name)}`),
  saveCanvas: (name: string, data: CanvasData) =>
    request<void>(`/canvas/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) }),
  createCanvas: (name: string) =>
    request<void>('/canvas', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteCanvas: (name: string) =>
    request<void>(`/canvas/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // Trash
  listTrash: () => request<TrashItem[]>('/trash'),
  restoreFromTrash: (notePath: string) =>
    request<{ message: string; path: string }>(`/trash/restore/${encodeURIComponent(notePath)}`, { method: 'POST' }),
  permanentlyDelete: (notePath: string) =>
    request<{ message: string }>(`/trash/${encodeURIComponent(notePath)}`, { method: 'DELETE' }),
  emptyTrash: () =>
    request<{ message: string }>('/trash-empty', { method: 'DELETE' }),

  // History
  listVersions: (notePath: string) =>
    request<{ versions: NoteVersion[] }>(`/history/${encodeURIComponent(notePath)}`),
  getVersion: (notePath: string, timestamp: number) =>
    request<NoteVersionContent>(`/history-version/${encodeURIComponent(notePath)}?ts=${timestamp}`),
  restoreVersion: (notePath: string, timestamp: number) =>
    request<{ restored: boolean }>(`/history-restore/${encodeURIComponent(notePath)}?ts=${timestamp}`, { method: 'POST' }),

  // Files
  uploadFile: (file: File): Promise<{ path: string; url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${BASE}/files`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      return res.json();
    });
  },

  // Plugins
  getActivePlugins: () => request<ActivePluginInfo[]>('/plugins/active'),
  getAllPlugins: () => request<unknown[]>('/plugins/all'),

  // Plugin registry
  getRegistry: () => request<RegistryPlugin[]>('/plugins/registry'),
  installPlugin: (id: string) => request<unknown>('/plugins/install/' + id, { method: 'POST' }),
  updatePlugin: (id: string) => request<unknown>('/plugins/update/' + id, { method: 'POST' }),
  uninstallPlugin: (id: string) => request<unknown>('/plugins/' + id + '/uninstall', { method: 'POST' }),
  checkPluginUpdates: () => request<PluginUpdate[]>('/plugins/updates'),
  enablePlugin: (id: string) => request<unknown>('/plugins/' + id + '/enable', { method: 'POST' }),
  disablePlugin: (id: string) => request<unknown>('/plugins/' + id + '/disable', { method: 'POST' }),
  reloadPlugin: (id: string) => request<unknown>('/plugins/' + id + '/reload', { method: 'POST' }),
};

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl: string | null;
}

export const authApi = {
  config: (): Promise<{ registrationMode: string }> =>
    fetch('/api/auth/config').then(r => r.json()),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

export const shareApi = {
  create: (data: { path: string; isFolder: boolean; sharedWithUserId: string; permission: string }) =>
    request<NoteShareData>('/shares', { method: 'POST', body: JSON.stringify(data) }),
  list: () => request<NoteShareData[]>('/shares'),
  withMe: () => request<SharedWithMeData[]>('/shares/with-me'),
  update: (id: string, permission: string) =>
    request<NoteShareData>(`/shares/${id}`, { method: 'PUT', body: JSON.stringify({ permission }) }),
  revoke: (id: string) =>
    request<void>(`/shares/${id}`, { method: 'DELETE' }),
  searchUser: (email: string) =>
    request<{ id: string; name: string; email: string }>(`/users/search?email=${encodeURIComponent(email)}`),
};

export const accessRequestApi = {
  create: (ownerUserId: string, notePath: string) =>
    request<AccessRequestData>('/access-requests', { method: 'POST', body: JSON.stringify({ ownerUserId, notePath }) }),
  list: () => request<AccessRequestData[]>('/access-requests'),
  mine: () => request<AccessRequestData[]>('/access-requests/mine'),
  respond: (id: string, action: string, permission?: string) =>
    request<void>(`/access-requests/${id}`, { method: 'PUT', body: JSON.stringify({ action, permission }) }),
};

export const sharedNoteApi = {
  read: (ownerUserId: string, notePath: string) =>
    request<{ path: string; content: string; title: string }>(`/notes/shared/${ownerUserId}/${encodeURIComponent(notePath)}`),
  write: (ownerUserId: string, notePath: string, content: string) =>
    request<void>(`/notes/shared/${ownerUserId}/${encodeURIComponent(notePath)}`, {
      method: 'PUT', body: JSON.stringify({ content }),
    }),
};

// API Key types
export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  scope: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreateApiKeyRequest {
  name: string;
  scope: "read-only" | "read-write";
  expiresAt?: string;
}

export interface CreateApiKeyResponse extends ApiKeyInfo {
  key: string;
}

export const apiKeyApi = {
  list: (): Promise<ApiKeyInfo[]> =>
    request<ApiKeyInfo[]>("/api-keys"),

  create: (data: CreateApiKeyRequest): Promise<CreateApiKeyResponse> =>
    request<CreateApiKeyResponse>("/api-keys", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  revoke: (id: string): Promise<void> =>
    request<void>(`/api-keys/${id}`, { method: "DELETE" }),
};
