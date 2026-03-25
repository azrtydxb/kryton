import { useState, useCallback, useEffect } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { api, FileNode, NoteData } from '../lib/api';

export function useNotes(userId?: string) {
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
      debouncedSave(prev.path, content);
      return { ...prev, content };
    });
  }, [debouncedSave]);

  const createNote = useCallback(async (path: string, content = '') => {
    try {
      setError(null);
      const note = await api.createNote(path, content || `# ${path.split('/').pop()?.replace('.md', '') || 'Untitled'}\n\n`);
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
    // Only fetch when authenticated
    if (!userId) {
      setLoading(false);
      return;
    }
    refreshTree().finally(() => setLoading(false));
  }, [refreshTree, userId]);

  // Set content without auto-saving (for cancel/revert)
  const setActiveNoteContent = useCallback((content: string) => {
    setActiveNote(prev => prev ? { ...prev, content } : null);
  }, []);

  return {
    tree,
    activeNote,
    loading,
    saving,
    error,
    openNote,
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
