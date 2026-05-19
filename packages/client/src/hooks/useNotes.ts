import { useState, useCallback, useEffect } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { api, FileNode, NoteData, sharedNoteApi } from '../lib/api';
import { useHttpAdapter } from '../data/httpAdapterContext';

/**
 * Optional predicate the caller passes to tell `updateContent` whether a
 * given path currently has a live Y.Doc session. When true, the
 * debounced HTTP save is suppressed — the server's Y flush handles
 * persistence for that path. The local `activeNote.content` is still
 * patched so any consumers reading it (preview, tab dirty indicator,
 * etc.) see the typed text immediately.
 */
type IsLiveDocument = (path: string) => boolean;

export function useNotes(userId?: string, isLiveDocument?: IsLiveDocument) {
  const adapter = useHttpAdapter();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [activeNote, setActiveNote] = useState<NoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTree = useCallback(async () => {
    try {
      const notes = await api.getNotes();
      setTree(notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notes');
    }
  }, []);

  const openNote = useCallback(async (path: string) => {
    try {
      setError(null);
      const note = await api.getNote(path);
      setActiveNote(note);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open note');
    }
  }, []);

  /**
   * Open a note that someone else owns and has shared with the current
   * user. The FileTree emits ids of the shape "shared:<ownerUserId>:<path>"
   * for these; useAppCallbacks parses and forwards to this method.
   * Without this, clicks on shared-note rows were silent no-ops.
   */
  const openSharedNote = useCallback(
    async (ownerUserId: string, notePath: string) => {
      try {
        setError(null);
        const note = await sharedNoteApi.read(ownerUserId, notePath);
        // The on-disk path returned by the API stays in `path` so any
        // saves route to the right endpoint. Surface the prefixed
        // `shared:<ownerUserId>:<notePath>` as `tabId` so the editor
        // tab strip and starred lookups can compare against it
        // without conflating two notes that share the same `path`.
        setActiveNote({
          ...note,
          tabId: `shared:${ownerUserId}:${notePath}`,
          modifiedAt: new Date().toISOString(),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to open shared note');
      }
    },
    [],
  );

  const debouncedSave = useDebouncedCallback(async (path: string, content: string) => {
    setSaving(true);
    try {
      await api.updateNote(path, content);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, 500);

  const updateContent = useCallback((content: string) => {
    setActiveNote(prev => {
      if (!prev) return null;
      // When a live Y.Doc owns this path, persistence flows through the
      // server's Y flush instead of the HTTP PUT — skip the debounced
      // save to avoid a redundant (and racy) second write.
      if (!isLiveDocument?.(prev.path)) {
        debouncedSave(prev.path, content);
      }
      return { ...prev, content };
    });
  }, [debouncedSave, isLiveDocument]);

  const createNote = useCallback(async (path: string, content = '') => {
    try {
      setError(null);
      const initialContent =
        content || `# ${path.split('/').pop()?.replace('.md', '') || 'Untitled'}\n\n`;
      // POST /api/notes returns { path, message } (no content) — fetch the
      // full note so the editor opens with valid content. Without this the
      // preview crashed on undefined content.matchAll().
      const created = await api.createNote(path, initialContent);
      const note = await api.getNote(created.path);
      await refreshTree();
      setActiveNote(note);
      return note;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create note');
      return null;
    }
  }, [refreshTree]);

  const deleteNote = useCallback(async (path: string) => {
    try {
      setError(null);
      await api.deleteNote(path);
      if (activeNote?.path === path) setActiveNote(null);
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete note');
    }
  }, [activeNote, refreshTree]);

  const renameNote = useCallback(async (oldPath: string, newPath: string) => {
    try {
      setError(null);
      await api.renameNote(oldPath, newPath);
      if (activeNote?.path === oldPath) {
        await openNote(newPath);
      }
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename note');
    }
  }, [activeNote, openNote, refreshTree]);

  const createFolder = useCallback(async (path: string) => {
    try {
      setError(null);
      await api.createFolder(path);
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create folder');
    }
  }, [refreshTree]);

  const deleteFolder = useCallback(async (path: string) => {
    try {
      setError(null);
      await api.deleteFolder(path);
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete folder');
    }
  }, [refreshTree]);

  const renameFolder = useCallback(async (oldPath: string, newPath: string) => {
    try {
      setError(null);
      await api.renameFolder(oldPath, newPath);
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename folder');
    }
  }, [refreshTree]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Only fetch when authenticated
      if (!userId) {
        setLoading(false);
        return;
      }
      try {
        await refreshTree();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTree, userId]);

  // Live tree updates: subscribe to vault-events so the sidebar reflects
  // create / delete / rename done in other tabs or by AI agents without a
  // full refresh. The adapter's `applyVaultEvent` patches its flat
  // `_notes` cache and fires the "notes" channel; we refetch the
  // hierarchical tree on each fire since the adapter doesn't maintain one.
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = adapter.subscribe('notes', '*', () => {
      void refreshTree();
    });
    return unsubscribe;
  }, [adapter, refreshTree, userId]);

  // Set content without auto-saving (for cancel/revert)
  const setActiveNoteContent = useCallback((content: string) => {
    setActiveNote(prev => prev ? { ...prev, content } : null);
  }, []);

  const closeActiveNote = useCallback(() => {
    setActiveNote(null);
  }, []);

  return {
    tree,
    activeNote,
    loading,
    saving,
    error,
    openNote,
    openSharedNote,
    closeActiveNote,
    updateContent,
    setActiveNoteContent,
    createNote,
    deleteNote,
    renameNote,
    createFolder,
    deleteFolder,
    renameFolder,
    refreshTree,
    setError,
  };
}
