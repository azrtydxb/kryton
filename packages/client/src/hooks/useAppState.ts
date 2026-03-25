import { useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EditorView } from '@codemirror/view';
import { useTheme } from './useTheme';
import { useNotes } from './useNotes';
import { useAuth } from './useAuth';
import { GraphData } from '../lib/api';
import { useUIStore } from '../stores/uiStore';
import { useGraphQuery, useStarredNotes, useSharedNotes } from './useNotesQuery';

export function useAppState() {
  const { user, loading } = useAuth();
  const themeCtx = useTheme();
  const notes = useNotes(user?.id);
  const queryClient = useQueryClient();

  // --- Zustand UI state (replaces all useState calls) ---
  const editorSlice = useUIStore((s) => ({
    editing: s.editing,
    setEditing: s.setEditing,
    editContent: s.editContent,
    setEditContent: s.setEditContent,
    originalContent: s.originalContent,
    setOriginalContent: s.setOriginalContent,
    cursorState: s.cursorState,
    setCursorState: s.setCursorState,
  }));

  const sidebarSlice = useUIStore((s) => ({
    sidebarOpen: s.sidebarOpen,
    setSidebarOpen: s.setSidebarOpen,
    sidebarWidth: s.sidebarWidth,
    setSidebarWidth: s.setSidebarWidth,
    mobileMenuOpen: s.mobileMenuOpen,
    setMobileMenuOpen: s.setMobileMenuOpen,
  }));

  const layoutSlice = useUIStore((s) => ({
    rightPanelWidth: s.rightPanelWidth,
    setRightPanelWidth: s.setRightPanelWidth,
    graphHeight: s.graphHeight,
    setGraphHeight: s.setGraphHeight,
  }));

  const modalSlice = useUIStore((s) => ({
    showAdmin: s.showAdmin,
    setShowAdmin: s.setShowAdmin,
    showTemplatePicker: s.showTemplatePicker,
    setShowTemplatePicker: s.setShowTemplatePicker,
    pendingTemplatePath: s.pendingTemplatePath,
    setPendingTemplatePath: s.setPendingTemplatePath,
    showQuickSwitcher: s.showQuickSwitcher,
    setShowQuickSwitcher: s.setShowQuickSwitcher,
    showShareDialog: s.showShareDialog,
    setShowShareDialog: s.setShowShareDialog,
    shareTarget: s.shareTarget,
    setShareTarget: s.setShareTarget,
    showAccessRequests: s.showAccessRequests,
    setShowAccessRequests: s.setShowAccessRequests,
  }));

  // --- TanStack Query for server data (replaces useEffect fetches) ---
  const treeKey = notes.tree.length;
  const graphQuery = useGraphQuery(user?.id, treeKey);
  const graphData: GraphData | null = graphQuery.data ?? null;
  const graphLoading = graphQuery.isLoading;

  const starredQuery = useStarredNotes(user?.id);
  const starredPaths: Set<string> = starredQuery.data ?? new Set();

  // Provide a backward-compatible setter that mirrors React's setState(updater) pattern.
  // useAppCallbacks calls setStarredPaths(prev => nextSet) for optimistic UI updates.
  const setStarredPaths = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const queryKey = ['settings', 'starred', user?.id];
      const current = queryClient.getQueryData<Set<string>>(queryKey) ?? new Set<string>();
      const next = typeof updater === 'function' ? updater(current) : updater;
      queryClient.setQueryData<Set<string>>(queryKey, next);
    },
    [queryClient, user?.id],
  );

  const sharedQuery = useSharedNotes(user?.id);
  const sharedNotes = sharedQuery.data ?? [];

  const isActiveNoteStarred = notes.activeNote ? starredPaths.has(notes.activeNote.path) : false;

  // Refs (unchanged)
  const editorViewRef = useRef<EditorView>(undefined);
  const searchInputRef = useRef<HTMLInputElement>(undefined);
  const previewRef = useRef<HTMLDivElement>(null);

  return {
    // Auth
    user, loading,
    // Theme
    themeCtx,
    // Notes
    notes,
    // Zustand slices
    ...editorSlice,
    ...sidebarSlice,
    ...layoutSlice,
    ...modalSlice,
    // Data
    graphData, graphLoading,
    starredPaths, setStarredPaths,
    sharedNotes,
    isActiveNoteStarred,
    // Refs
    editorViewRef, searchInputRef, previewRef,
  };
}

export type AppState = ReturnType<typeof useAppState>;
