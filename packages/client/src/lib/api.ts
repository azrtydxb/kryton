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

const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
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
};
