import { create } from 'zustand';

// Helper type for React-style setState that accepts value or updater function
type SetState<T> = (valueOrUpdater: T | ((prev: T) => T)) => void;

/** Top-level main-pane view selector. Drives whether the editor, all-notes,
 *  or fullscreen graph is rendered between sidebar + right panel. */
export type MainView = 'note' | 'all' | 'graph' | 'tags';

interface UIState {
  // Layout
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  graphHeight: number | null;
  mobileMenuOpen: boolean;
  view: MainView;

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
  showAccountSettings: boolean;
  /** Per-note version-history dropdown — toggled by the top-bar History
   *  button when a note is active; consumed by PreviewModeView. */
  showNoteHistory: boolean;
  /** Sidebar customisation toggle — when true, sidebar plugin panels render
   *  as outlined cards with move-side / move-up / move-down controls. The
   *  layout is persisted on the server when the user flips this back to
   *  false (see Header.tsx). */
  sidebarEditMode: boolean;
  /** Ordered list of note paths currently open in the tab strip.
   *  Opening a note adds it (if absent) and makes it active; closing a tab
   *  removes its path and falls back to the previous tab as active. */
  openTabs: string[];

  // Editor
  cursorState: { line: number; col: number; wordCount: number };

  // Actions — these accept value or updater function for backward compat with React setState
  setSidebarOpen: SetState<boolean>;
  setSidebarWidth: SetState<number>;
  setRightPanelWidth: SetState<number>;
  setGraphHeight: SetState<number | null>;
  setMobileMenuOpen: SetState<boolean>;
  /** Set the top-level view. Subscribed-to by `useUrlSync` so navigation
   *  to `all` / `graph` / `tags` writes a matching `/view/...` URL. */
  setView: SetState<MainView>;
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
  setShowAccountSettings: SetState<boolean>;
  setShowNoteHistory: SetState<boolean>;
  setSidebarEditMode: SetState<boolean>;
  /** Open or focus a tab for `path`. Appends if absent; idempotent.
   *  Subscribed-to by `useUrlSync` — every call surfaces in the URL. */
  openTab: (path: string) => void;
  /** Close the tab for `path`. Returns the next path to activate (or null).
   *  Subscribed-to by `useUrlSync` — every call surfaces in the URL. */
  closeTab: (path: string) => string | null;

  // Compound actions
  enterEditMode: (content: string) => void;
  cancelEdit: () => void;
  /** Reset all UI state to initial values (call on logout) */
  reset: () => void;
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
  view: 'note',
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
  showAccountSettings: false,
  showNoteHistory: false,
  sidebarEditMode: false,
  openTabs: [],
  cursorState: { line: 1, col: 1, wordCount: 0 },

  // Setters — all support updater functions
  setSidebarOpen: (v) => set({ sidebarOpen: resolve(v, get().sidebarOpen) }),
  setSidebarWidth: (v) => set({ sidebarWidth: resolve(v, get().sidebarWidth) }),
  setRightPanelWidth: (v) => set({ rightPanelWidth: resolve(v, get().rightPanelWidth) }),
  setGraphHeight: (v) => set({ graphHeight: resolve(v, get().graphHeight) }),
  setMobileMenuOpen: (v) => set({ mobileMenuOpen: resolve(v, get().mobileMenuOpen) }),
  setView: (v) => set({ view: resolve(v, get().view) }),
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
  setShowAccountSettings: (v) => set({ showAccountSettings: resolve(v, get().showAccountSettings) }),
  setShowNoteHistory: (v) => set({ showNoteHistory: resolve(v, get().showNoteHistory) }),
  setSidebarEditMode: (v) => set({ sidebarEditMode: resolve(v, get().sidebarEditMode) }),

  openTab: (path) => {
    const tabs = get().openTabs;
    if (tabs.includes(path)) return;
    set({ openTabs: [...tabs, path] });
  },
  closeTab: (path) => {
    const tabs = get().openTabs;
    const idx = tabs.indexOf(path);
    if (idx === -1) return null;
    const next = tabs.filter((p) => p !== path);
    set({ openTabs: next });
    // Activate neighbour (prefer left, fall back to right) so the user
    // doesn't drop into an empty view when closing the focused tab.
    if (next.length === 0) return null;
    return next[Math.max(0, idx - 1)] ?? next[0];
  },

  enterEditMode: (content) => set({ editing: true, editContent: content, originalContent: content }),
  cancelEdit: () => set({ editing: false, editContent: null, originalContent: null }),
  reset: () => set({
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
    showAccountSettings: false,
    showNoteHistory: false,
    sidebarEditMode: false,
    openTabs: [],
    cursorState: { line: 1, col: 1, wordCount: 0 },
  }),
}));
