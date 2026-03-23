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
}

export interface GraphData {
  nodes: { id: string; title: string; path: string }[];
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

const BASE = '/api';

let _accessToken: string | null = null;
export function setAccessToken(token: string | null) { _accessToken = token; }

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options?.headers as Record<string, string>),
  };
  if (_accessToken) {
    headers['Authorization'] = 'Bearer ' + _accessToken;
  }
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
  login: (email: string, password: string) =>
    request<{ user: AuthUser; accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (data: { email: string; password: string; name: string; inviteCode?: string }) =>
    request<{ user: AuthUser; accessToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  refresh: async (): Promise<{ user: AuthUser; accessToken: string } | null> => {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok) return null;
    return res.json();
  },
  logout: () =>
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    }),
  me: () => request<AuthUser>('/auth/me'),
};
