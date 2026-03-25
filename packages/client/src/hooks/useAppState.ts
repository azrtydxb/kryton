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
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const rightPanelWidth = useUIStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useUIStore((s) => s.setRightPanelWidth);
  const graphHeight = useUIStore((s) => s.graphHeight);
  const setGraphHeight = useUIStore((s) => s.setGraphHeight);
  const mobileMenuOpen = useUIStore((s) => s.mobileMenuOpen);
  const setMobileMenuOpen = useUIStore((s) => s.setMobileMenuOpen);
  const editing = useUIStore((s) => s.editing);
  const setEditing = useUIStore((s) => s.setEditing);
  const editContent = useUIStore((s) => s.editContent);
  const setEditContent = useUIStore((s) => s.setEditContent);
  const originalContent = useUIStore((s) => s.originalContent);
  const setOriginalContent = useUIStore((s) => s.setOriginalContent);
  const showAdmin = useUIStore((s) => s.showAdmin);
  const setShowAdmin = useUIStore((s) => s.setShowAdmin);
  const showTemplatePicker = useUIStore((s) => s.showTemplatePicker);
  const setShowTemplatePicker = useUIStore((s) => s.setShowTemplatePicker);
  const pendingTemplatePath = useUIStore((s) => s.pendingTemplatePath);
  const setPendingTemplatePath = useUIStore((s) => s.setPendingTemplatePath);
  const showQuickSwitcher = useUIStore((s) => s.showQuickSwitcher);
  const setShowQuickSwitcher = useUIStore((s) => s.setShowQuickSwitcher);
  const showShareDialog = useUIStore((s) => s.showShareDialog);
  const setShowShareDialog = useUIStore((s) => s.setShowShareDialog);
  const shareTarget = useUIStore((s) => s.shareTarget);
  const setShareTarget = useUIStore((s) => s.setShareTarget);
  const showAccessRequests = useUIStore((s) => s.showAccessRequests);
  const setShowAccessRequests = useUIStore((s) => s.setShowAccessRequests);
  const cursorState = useUIStore((s) => s.cursorState);
  const setCursorState = useUIStore((s) => s.setCursorState);

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
    // Editing
    editing, setEditing,
    editContent, setEditContent,
    originalContent, setOriginalContent,
    // UI toggles
    showAdmin, setShowAdmin,
    sidebarOpen, setSidebarOpen,
    mobileMenuOpen, setMobileMenuOpen,
    showTemplatePicker, setShowTemplatePicker,
    pendingTemplatePath, setPendingTemplatePath,
    showQuickSwitcher, setShowQuickSwitcher,
    showShareDialog, setShowShareDialog,
    shareTarget, setShareTarget,
    showAccessRequests, setShowAccessRequests,
    // Layout
    sidebarWidth, setSidebarWidth,
    rightPanelWidth, setRightPanelWidth,
    graphHeight, setGraphHeight,
    // Data
    graphData, graphLoading,
    cursorState, setCursorState,
    starredPaths, setStarredPaths,
    sharedNotes,
    isActiveNoteStarred,
    // Refs
    editorViewRef, searchInputRef, previewRef,
  };
}

export type AppState = ReturnType<typeof useAppState>;
