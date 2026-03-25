import { create } from 'zustand';

// Helper type for React-style setState that accepts value or updater function
type SetState<T> = (valueOrUpdater: T | ((prev: T) => T)) => void;

interface UIState {
  // Layout
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  graphHeight: number | null;
  mobileMenuOpen: boolean;

  // Editing
  editing: boolean;
  editContent: string | null;
  originalContent: string | null;

  // Modals
  showAdmin: boolean;
  showTemplatePicker: boolean;
  pendingTemplatePath: string | null;
  showQuickSwitcher: boolean;
  showShareDialog: boolean;
  shareTarget: { path: string; isFolder: boolean } | null;
  showAccessRequests: boolean;

  // Editor
  cursorState: { line: number; col: number; wordCount: number };

  // Actions — these accept value or updater function for backward compat with React setState
  setSidebarOpen: SetState<boolean>;
  setSidebarWidth: SetState<number>;
  setRightPanelWidth: SetState<number>;
  setGraphHeight: SetState<number | null>;
  setMobileMenuOpen: SetState<boolean>;
  setEditing: SetState<boolean>;
  setEditContent: SetState<string | null>;
  setOriginalContent: SetState<string | null>;
  setCursorState: SetState<{ line: number; col: number; wordCount: number }>;
  setShowAdmin: SetState<boolean>;
  setShowTemplatePicker: SetState<boolean>;
  setPendingTemplatePath: SetState<string | null>;
  setShowQuickSwitcher: SetState<boolean>;
  setShowShareDialog: SetState<boolean>;
  setShareTarget: SetState<{ path: string; isFolder: boolean } | null>;
  setShowAccessRequests: SetState<boolean>;

  // Compound actions
  enterEditMode: (content: string) => void;
  cancelEdit: () => void;
}

// Helper: resolve value-or-updater against current state field
function resolve<T>(valueOrUpdater: T | ((prev: T) => T), current: T): T {
  return typeof valueOrUpdater === 'function'
    ? (valueOrUpdater as (prev: T) => T)(current)
    : valueOrUpdater;
}

export const useUIStore = create<UIState>((set, get) => ({
  // Initial values
  sidebarOpen: true,
  sidebarWidth: 256,
  rightPanelWidth: 320,
  graphHeight: null,
  mobileMenuOpen: false,
  editing: false,
  editContent: null,
  originalContent: null,
  showAdmin: false,
  showTemplatePicker: false,
  pendingTemplatePath: null,
  showQuickSwitcher: false,
  showShareDialog: false,
  shareTarget: null,
  showAccessRequests: false,
  cursorState: { line: 1, col: 1, wordCount: 0 },

  // Setters — all support updater functions
  setSidebarOpen: (v) => set({ sidebarOpen: resolve(v, get().sidebarOpen) }),
  setSidebarWidth: (v) => set({ sidebarWidth: resolve(v, get().sidebarWidth) }),
  setRightPanelWidth: (v) => set({ rightPanelWidth: resolve(v, get().rightPanelWidth) }),
  setGraphHeight: (v) => set({ graphHeight: resolve(v, get().graphHeight) }),
  setMobileMenuOpen: (v) => set({ mobileMenuOpen: resolve(v, get().mobileMenuOpen) }),
  setEditing: (v) => set({ editing: resolve(v, get().editing) }),
  setEditContent: (v) => set({ editContent: resolve(v, get().editContent) }),
  setOriginalContent: (v) => set({ originalContent: resolve(v, get().originalContent) }),
  setCursorState: (v) => set({ cursorState: resolve(v, get().cursorState) }),
  setShowAdmin: (v) => set({ showAdmin: resolve(v, get().showAdmin) }),
  setShowTemplatePicker: (v) => set({ showTemplatePicker: resolve(v, get().showTemplatePicker) }),
  setPendingTemplatePath: (v) => set({ pendingTemplatePath: resolve(v, get().pendingTemplatePath) }),
  setShowQuickSwitcher: (v) => set({ showQuickSwitcher: resolve(v, get().showQuickSwitcher) }),
  setShowShareDialog: (v) => set({ showShareDialog: resolve(v, get().showShareDialog) }),
  setShareTarget: (v) => set({ shareTarget: resolve(v, get().shareTarget) }),
  setShowAccessRequests: (v) => set({ showAccessRequests: resolve(v, get().showAccessRequests) }),

  enterEditMode: (content) => set({ editing: true, editContent: content, originalContent: content }),
  cancelEdit: () => set({ editing: false, editContent: null, originalContent: null }),
}));
