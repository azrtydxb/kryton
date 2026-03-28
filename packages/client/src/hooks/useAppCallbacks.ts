import { useCallback } from 'react';
import { api } from '../lib/api';
import { exportNoteToPdf } from '../lib/exportPdf';
import { useUIStore } from '../stores/uiStore';
import { AppState } from './useAppState';

export function useAppCallbacks(state: AppState) {
  const {
    notes, editing, editContent, originalContent,
    setEditing, setEditContent, setOriginalContent,
    setMobileMenuOpen,
    setShowTemplatePicker, setPendingTemplatePath,
    setSidebarWidth,
    setRightPanelWidth, setGraphHeight, setStarredPaths,
    setShareTarget, setShowShareDialog,
    editorViewRef, previewRef,
    pendingTemplatePath,
  } = state;

  const storeEnterEditMode = useUIStore((s) => s.enterEditMode);
  const storeCancelEdit = useUIStore((s) => s.cancelEdit);

  const toggleStar = useCallback((path: string) => {
    setStarredPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      api.updateSetting('starred', JSON.stringify(Array.from(next))).catch((err) => console.error("[starred] Failed to persist:", err));
      return next;
    });
  }, [setStarredPaths]);

  const toggleActiveNoteStar = useCallback(() => {
    if (notes.activeNote) toggleStar(notes.activeNote.path);
  }, [notes.activeNote, toggleStar]);

  const handleNoteSelect = useCallback((path: string) => {
    if (!path.startsWith('shared:')) {
      notes.openNote(path);
    }
    setEditing(false);
    setEditContent(null);
    setOriginalContent(null);
    setMobileMenuOpen(false);
  }, [notes, setEditing, setEditContent, setOriginalContent, setMobileMenuOpen]);

  const handleLinkClick = useCallback((noteName: string) => {
    const findNote = (nodes: typeof notes.tree): string | null => {
      for (const node of nodes) {
        if (node.type === 'file') {
          const nameWithoutExt = node.path.replace(/\.md$/, '');
          if (nameWithoutExt === noteName || nameWithoutExt.endsWith('/' + noteName) || node.name.replace(/\.md$/, '') === noteName) {
            return node.path;
          }
        }
        if (node.children) {
          const found = findNote(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    const path = findNote(notes.tree);
    if (path) notes.openNote(path);
  }, [notes]);

  const handleCreateNoteFromLink = useCallback(async (name: string) => {
    await notes.createNote(name);
  }, [notes]);

  const handleDailyNote = useCallback(async () => {
    try {
      const note = await api.createDailyNote();
      await notes.refreshTree();
      notes.openNote(note.path);
      setMobileMenuOpen(false);
    } catch {
      notes.setError('Failed to create daily note');
    }
  }, [notes, setMobileMenuOpen]);

  const handleCreateFromTemplate = useCallback(() => {
    setPendingTemplatePath(null);
    setShowTemplatePicker(true);
  }, [setPendingTemplatePath, setShowTemplatePicker]);

  const handleTemplateSelected = useCallback(async (templateContent: string) => {
    setShowTemplatePicker(false);
    if (pendingTemplatePath) {
      await notes.createNote(pendingTemplatePath, templateContent || undefined);
    } else {
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const noteName = `New Note ${timestamp}`;
      const content = templateContent || `# ${noteName}\n\n`;
      await notes.createNote(noteName, content);
    }
    setPendingTemplatePath(null);
  }, [notes, pendingTemplatePath, setShowTemplatePicker, setPendingTemplatePath]);

  const handleOutlineJump = useCallback((line: number) => {
    if (editing) {
      const view = editorViewRef.current;
      if (!view) return;
      const doc = view.state.doc;
      if (line < 1 || line > doc.lines) return;
      const lineObj = doc.line(line);
      view.dispatch({ selection: { anchor: lineObj.from }, scrollIntoView: true });
      view.focus();
    } else {
      const lines = (notes.activeNote?.content || '').split('\n');
      let inCodeBlock = false;
      let headingIndex = 0;
      let targetIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
        if (!inCodeBlock && /^#{1,6}\s+/.test(lines[i])) {
          headingIndex++;
          if (i + 1 === line) { targetIndex = headingIndex; break; }
        }
      }
      if (targetIndex > 0) {
        const el = document.getElementById(`heading-${targetIndex}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [editing, notes.activeNote?.content, editorViewRef]);

  const handleNewNote = useCallback(async () => {
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    await notes.createNote(`New Note ${timestamp}`);
  }, [notes]);

  const handleRenameNote = useCallback(() => {
    if (!notes.activeNote) return;
    window.dispatchEvent(new CustomEvent('mnemo:rename-note', { detail: { path: notes.activeNote.path } }));
  }, [notes.activeNote]);

  const handlePdfExport = useCallback(async () => {
    if (!notes.activeNote) return;
    const el = previewRef.current;
    if (el) {
      await exportNoteToPdf(notes.activeNote.title, el.innerHTML);
    } else {
      const div = document.createElement('div');
      const h1 = document.createElement('h1');
      h1.textContent = notes.activeNote.title;
      const pre = document.createElement('pre');
      pre.textContent = notes.activeNote.content;
      div.appendChild(h1);
      div.appendChild(pre);
      await exportNoteToPdf(notes.activeNote.title, div.innerHTML);
    }
  }, [notes.activeNote, previewRef]);

  const enterEditMode = useCallback(() => {
    if (!notes.activeNote) return;
    storeEnterEditMode(notes.activeNote.content);
  }, [notes.activeNote, storeEnterEditMode]);

  const saveEdit = useCallback(async () => {
    if (!notes.activeNote || editContent === null) return;
    notes.updateContent(editContent);
    setEditing(false);
    setEditContent(null);
    setOriginalContent(null);
  }, [notes, editContent, setEditing, setEditContent, setOriginalContent]);

  const saveEditInPlace = useCallback(async () => {
    if (!notes.activeNote || editContent === null) return;
    if (editContent === originalContent) return;
    notes.updateContent(editContent);
    setOriginalContent(editContent);
  }, [notes, editContent, originalContent, setOriginalContent]);

  const cancelEdit = useCallback(() => {
    if (originalContent !== null && notes.activeNote) {
      notes.setActiveNoteContent(originalContent);
    }
    storeCancelEdit();
  }, [originalContent, notes, storeCancelEdit]);

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth(w => Math.max(180, Math.min(500, w + delta)));
  }, [setSidebarWidth]);

  const handleRightPanelResize = useCallback((delta: number) => {
    setRightPanelWidth(w => Math.max(200, Math.min(600, w - delta)));
  }, [setRightPanelWidth]);

  const handleGraphResize = useCallback((delta: number) => {
    setGraphHeight(h => Math.max(100, (h ?? 400) + delta));
  }, [setGraphHeight]);

  const handleShare = useCallback((path: string, isFolder: boolean) => {
    setShareTarget({ path, isFolder });
    setShowShareDialog(true);
  }, [setShareTarget, setShowShareDialog]);

  return {
    toggleStar, toggleActiveNoteStar,
    handleNoteSelect, handleLinkClick, handleCreateNoteFromLink,
    handleDailyNote, handleCreateFromTemplate, handleTemplateSelected,
    handleOutlineJump, handleNewNote, handleRenameNote, handlePdfExport,
    enterEditMode, saveEdit, saveEditInPlace, cancelEdit,
    handleSidebarResize, handleRightPanelResize, handleGraphResize,
    handleShare,
  };
}

export type AppCallbacks = ReturnType<typeof useAppCallbacks>;
