# App.tsx Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 686-line `AppContent` component into focused, single-responsibility components and hooks, creating clean insertion points for the upcoming plugin slot system.

**Architecture:** Extract state management into a custom hook, callbacks into a second hook, and each major UI section (header, sidebar layout, edit view, preview view, right panel, modals) into its own component. `AppContent` becomes a ~100-line layout orchestrator.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind CSS 4

---

## File Structure

### New Files

```
packages/client/src/
  hooks/
    useAppState.ts              # Consolidated state: 24 state vars + 3 effects + refs
    useAppCallbacks.ts          # Consolidated callbacks: 19 useCallback + 1 useMemo
  components/
    Layout/
      Header.tsx                # Top bar: logo, search, theme toggle, user menu
      SidebarLayout.tsx         # Collapsed bar + full sidebar + resize handle
      RightPanel.tsx            # Graph panel + outline pane + resize handles
    Views/
      EditModeView.tsx          # Split editor/preview with toolbar and action buttons
      PreviewModeView.tsx       # Read-only preview with action buttons
      EmptyStateView.tsx        # "No note selected" placeholder
    Modals/
      ModalsContainer.tsx       # All modal dialogs rendered conditionally
    Toast/
      ErrorToast.tsx            # Error notification toast
```

### Modified Files

```
packages/client/src/
  App.tsx                       # Slimmed to ~100 lines, layout orchestrator only
```

---

## Task 1: Extract useAppState Hook

**Files:**
- Create: `packages/client/src/hooks/useAppState.ts`

- [ ] **Step 1: Create useAppState with all state variables, refs, and effects**

Create `packages/client/src/hooks/useAppState.ts`:
```typescript
import { useState, useRef, useEffect } from 'react';
import { EditorView } from '@codemirror/view';
import { useTheme } from './useTheme';
import { useNotes } from './useNotes';
import { useAuth } from './useAuth';
import { api, shareApi, GraphData } from '../lib/api';
import { EditorCursorState } from '../components/Editor/Editor';

export function useAppState() {
  const { user, loading } = useAuth();
  const themeCtx = useTheme();
  const notes = useNotes(user?.id);

  // Editing state
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string | null>(null);

  // UI state
  const [vimEnabled, setVimEnabled] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [pendingTemplatePath, setPendingTemplatePath] = useState<string | null>(null);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ path: string; isFolder: boolean } | null>(null);
  const [showAccessRequests, setShowAccessRequests] = useState(false);

  // Layout state
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [graphHeight, setGraphHeight] = useState<number | null>(null);

  // Data state
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [cursorState, setCursorState] = useState<EditorCursorState>({
    line: 1, col: 1, vimMode: '-- NORMAL --', wordCount: 0,
  });
  const [starredPaths, setStarredPaths] = useState<Set<string>>(new Set());
  const [sharedNotes, setSharedNotes] = useState<{ id: string; ownerUserId: string; ownerName: string; path: string; isFolder: boolean; permission: string }[]>([]);

  // Refs
  const editorViewRef = useRef<EditorView>(undefined);
  const searchInputRef = useRef<HTMLInputElement>(undefined);
  const previewRef = useRef<HTMLDivElement>(null);

  // Load starred notes & vim settings
  useEffect(() => {
    if (!user) return;
    api.getSettings().then(settings => {
      if (settings.starred) {
        try {
          const paths = JSON.parse(settings.starred) as string[];
          setStarredPaths(new Set(paths));
        } catch { /* ignore */ }
      }
      if (settings.vimEnabled !== undefined) {
        setVimEnabled(settings.vimEnabled === 'true');
      }
    }).catch(() => {});
  }, [user]);

  // Fetch shared notes
  useEffect(() => {
    if (!user) return;
    shareApi.withMe().then(data => setSharedNotes(data || [])).catch(() => {});
  }, [user]);

  // Fetch graph data
  const treeKey = notes.tree.length;
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.getGraph()
      .then(data => { if (!cancelled) { setGraphData(data); setGraphLoading(false); } })
      .catch(() => { if (!cancelled) { setGraphLoading(false); } });
    return () => { cancelled = true; };
  }, [treeKey, user]);

  const isActiveNoteStarred = notes.activeNote ? starredPaths.has(notes.activeNote.path) : false;

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
    vimEnabled, setVimEnabled,
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
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/pascal/Development/kryton && npx tsc --noEmit --project packages/client/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useAppState.ts && git commit -m "refactor: extract useAppState hook from AppContent"
```

---

## Task 2: Extract useAppCallbacks Hook

**Files:**
- Create: `packages/client/src/hooks/useAppCallbacks.ts`

- [ ] **Step 1: Create useAppCallbacks with all callback functions**

Create `packages/client/src/hooks/useAppCallbacks.ts`:
```typescript
import { useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import { exportNoteToPdf } from '../lib/exportPdf';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { AppState } from './useAppState';

export function useAppCallbacks(state: AppState) {
  const {
    notes, editing, editContent, originalContent,
    setEditing, setEditContent, setOriginalContent,
    setVimEnabled, setMobileMenuOpen,
    setShowTemplatePicker, setPendingTemplatePath,
    setShowQuickSwitcher, setSidebarOpen, setSidebarWidth,
    setRightPanelWidth, setGraphHeight, setStarredPaths,
    setShareTarget, setShowShareDialog,
    editorViewRef, searchInputRef, previewRef,
    pendingTemplatePath, starredPaths,
  } = state;

  const toggleStar = useCallback((path: string) => {
    setStarredPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      api.updateSetting('starred', JSON.stringify(Array.from(next))).catch(() => {});
      return next;
    });
  }, [setStarredPaths]);

  const handleVimToggle = useCallback((enabled: boolean) => {
    setVimEnabled(enabled);
    api.updateSetting('vimEnabled', String(enabled)).catch(() => {});
  }, [setVimEnabled]);

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
    window.dispatchEvent(new CustomEvent('kryton:rename-note', { detail: { path: notes.activeNote.path } }));
  }, [notes.activeNote]);

  const handlePdfExport = useCallback(async () => {
    if (!notes.activeNote) return;
    const el = previewRef.current;
    if (el) {
      await exportNoteToPdf(notes.activeNote.title, el.innerHTML);
    } else {
      const div = document.createElement('div');
      div.innerHTML = `<h1>${notes.activeNote.title}</h1><pre>${notes.activeNote.content}</pre>`;
      await exportNoteToPdf(notes.activeNote.title, div.innerHTML);
    }
  }, [notes.activeNote, previewRef]);

  const enterEditMode = useCallback(() => {
    if (!notes.activeNote) return;
    setOriginalContent(notes.activeNote.content);
    setEditContent(notes.activeNote.content);
    setEditing(true);
  }, [notes.activeNote, setOriginalContent, setEditContent, setEditing]);

  const saveEdit = useCallback(async () => {
    if (!notes.activeNote || editContent === null) return;
    notes.updateContent(editContent);
    setEditing(false);
    setEditContent(null);
    setOriginalContent(null);
  }, [notes, editContent, setEditing, setEditContent, setOriginalContent]);

  const cancelEdit = useCallback(() => {
    if (originalContent !== null && notes.activeNote) {
      notes.setActiveNoteContent(originalContent);
    }
    setEditing(false);
    setEditContent(null);
    setOriginalContent(null);
  }, [originalContent, notes, setEditing, setEditContent, setOriginalContent]);

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

  // Keyboard shortcuts
  const shortcutActions = useMemo(() => ({
    toggleSidebar: () => setSidebarOpen(prev => !prev),
    toggleEdit: () => { if (editing) cancelEdit(); else enterEditMode(); },
    openQuickSwitcher: () => setShowQuickSwitcher(true),
    focusSearch: () => searchInputRef.current?.focus(),
    createNote: handleNewNote,
    renameNote: handleRenameNote,
    toggleStar: toggleActiveNoteStar,
  }), [handleNewNote, handleRenameNote, toggleActiveNoteStar, editing, cancelEdit, enterEditMode, setSidebarOpen, setShowQuickSwitcher, searchInputRef]);

  useKeyboardShortcuts(shortcutActions);

  return {
    toggleStar, handleVimToggle, toggleActiveNoteStar,
    handleNoteSelect, handleLinkClick, handleCreateNoteFromLink,
    handleDailyNote, handleCreateFromTemplate, handleTemplateSelected,
    handleOutlineJump, handleNewNote, handleRenameNote, handlePdfExport,
    enterEditMode, saveEdit, cancelEdit,
    handleSidebarResize, handleRightPanelResize, handleGraphResize,
    handleShare,
  };
}

export type AppCallbacks = ReturnType<typeof useAppCallbacks>;
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/pascal/Development/kryton && npx tsc --noEmit --project packages/client/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useAppCallbacks.ts && git commit -m "refactor: extract useAppCallbacks hook from AppContent"
```

---

## Task 3: Extract Header Component

**Files:**
- Create: `packages/client/src/components/Layout/Header.tsx`

- [ ] **Step 1: Create Header component**

Create `packages/client/src/components/Layout/Header.tsx`:
```tsx
import { RefObject } from 'react';
import { SearchBar } from '../Search/SearchBar';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { Menu } from 'lucide-react';

interface HeaderProps {
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  theme: string;
  setTheme: (theme: string) => void;
  onNoteSelect: (path: string) => void;
  onAdminClick: () => void;
  onAccessRequestsClick: () => void;
}

export function Header({
  mobileMenuOpen, setMobileMenuOpen,
  searchInputRef, theme, setTheme,
  onNoteSelect, onAdminClick, onAccessRequestsClick,
}: HeaderProps) {
  return (
    <header className="h-14 flex-shrink-0 flex items-center justify-between px-3 border-b border-gray-700/50 bg-surface-900 text-gray-100 [&_.btn-ghost]:text-gray-400 [&_.btn-ghost:hover]:bg-gray-800">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="btn-ghost p-2 md:hidden"
          aria-label="Toggle menu"
        >
          <Menu size={18} />
        </button>
        <div className="flex items-center ml-1">
          <img src="/logo.png" alt="Kryton" className="h-11 w-auto" />
        </div>
      </div>

      <div className="flex-1 max-w-md mx-4">
        <SearchBar onSelect={onNoteSelect} inputRef={searchInputRef} />
      </div>

      <div className="flex items-center gap-0.5">
        <a
          href="/api/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost px-2 py-1 text-xs font-medium"
          title="API Docs"
        >
          API
        </a>
        <ThemeToggle theme={theme} setTheme={setTheme} />
        <UserMenu onAdminClick={onAdminClick} onAccessRequestsClick={onAccessRequestsClick} />
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/pascal/Development/kryton && npx tsc --noEmit --project packages/client/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Layout/Header.tsx && git commit -m "refactor: extract Header component from AppContent"
```

---

## Task 4: Extract SidebarLayout Component

**Files:**
- Create: `packages/client/src/components/Layout/SidebarLayout.tsx`

- [ ] **Step 1: Create SidebarLayout component**

Create `packages/client/src/components/Layout/SidebarLayout.tsx`:
```tsx
import { Sidebar } from '../Sidebar/Sidebar';
import { ResizeHandle } from './ResizeHandle';
import { PanelLeft } from 'lucide-react';

interface SidebarLayoutProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  sidebarWidth: number;
  onSidebarResize: (delta: number) => void;
  tree: any[];
  activeNotePath: string | null;
  starredPaths: Set<string>;
  sharedNotes: any[];
  onSelect: (path: string) => void;
  onCreateNote: (name: string, content?: string) => Promise<any>;
  onDeleteNote: (path: string) => Promise<void>;
  onRenameNote: (oldPath: string, newPath: string) => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onDeleteFolder: (path: string) => Promise<void>;
  onRenameFolder: (oldPath: string, newPath: string) => Promise<void>;
  onDailyNote: () => void;
  onCreateFromTemplate: () => void;
  onToggleStar: (path: string) => void;
  onShare: (path: string, isFolder: boolean) => void;
}

export function SidebarLayout({
  sidebarOpen, setSidebarOpen,
  mobileMenuOpen, setMobileMenuOpen,
  sidebarWidth, onSidebarResize,
  tree, activeNotePath, starredPaths, sharedNotes,
  onSelect, onCreateNote, onDeleteNote, onRenameNote,
  onCreateFolder, onDeleteFolder, onRenameFolder,
  onDailyNote, onCreateFromTemplate, onToggleStar, onShare,
}: SidebarLayoutProps) {
  return (
    <>
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Collapsed bar (desktop only) */}
      <div className={`hidden ${sidebarOpen ? 'md:hidden' : 'md:flex'} flex-col items-center w-10 flex-shrink-0 border-r bg-gray-50 dark:bg-surface-900 py-2`}>
        <button
          onClick={() => setSidebarOpen(true)}
          className="btn-ghost p-2"
          aria-label="Open sidebar"
          title="Open sidebar (Ctrl+B)"
        >
          <PanelLeft size={18} />
        </button>
      </div>

      {/* Full sidebar */}
      <aside
        className={`
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
          ${sidebarOpen ? '' : 'md:!w-0 md:overflow-hidden md:border-r-0'}
          fixed md:relative inset-y-0 left-0 z-40 md:z-0
          w-72 flex-shrink-0
          bg-gray-50 dark:bg-surface-900 border-r
        `}
        style={sidebarOpen ? { width: `${sidebarWidth}px` } : undefined}
      >
        <div className="hidden md:flex items-center px-2 py-1.5 border-b">
          <button
            onClick={() => setSidebarOpen(false)}
            className="btn-ghost p-1.5"
            aria-label="Close sidebar"
            title="Close sidebar (Ctrl+B)"
          >
            <PanelLeft size={16} />
          </button>
        </div>
        <Sidebar
          tree={tree}
          activeNotePath={activeNotePath}
          onSelect={onSelect}
          onCreateNote={onCreateNote}
          onDeleteNote={onDeleteNote}
          onRenameNote={onRenameNote}
          onCreateFolder={onCreateFolder}
          onDeleteFolder={onDeleteFolder}
          onRenameFolder={onRenameFolder}
          onDailyNote={onDailyNote}
          onCreateFromTemplate={onCreateFromTemplate}
          starredPaths={starredPaths}
          onToggleStar={onToggleStar}
          sharedNotes={sharedNotes}
          onShare={onShare}
        />
      </aside>

      {/* Sidebar resize handle */}
      {sidebarOpen && <ResizeHandle direction="horizontal" onResize={onSidebarResize} />}
    </>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/pascal/Development/kryton && npx tsc --noEmit --project packages/client/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Layout/SidebarLayout.tsx && git commit -m "refactor: extract SidebarLayout component from AppContent"
```

---

## Task 5: Extract View Components

**Files:**
- Create: `packages/client/src/components/Views/EditModeView.tsx`
- Create: `packages/client/src/components/Views/PreviewModeView.tsx`
- Create: `packages/client/src/components/Views/EmptyStateView.tsx`

- [ ] **Step 1: Create EditModeView**

Create `packages/client/src/components/Views/EditModeView.tsx`:
```tsx
import { RefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { Editor, EditorCursorState } from '../Editor/Editor';
import { EditorToolbar } from '../Editor/EditorToolbar';
import { Preview } from '../Preview/Preview';
import { OutgoingLinksPanel } from '../OutgoingLinks/OutgoingLinksPanel';
import { BacklinksPanel } from '../Backlinks/BacklinksPanel';
import { BookOpen, Star, FileDown } from 'lucide-react';

interface EditModeViewProps {
  activeNote: { path: string; title: string; content: string };
  editContent: string | null;
  originalContent: string | null;
  vimEnabled: boolean;
  isStarred: boolean;
  resolvedTheme: string;
  allNotes: any[];
  editorViewRef: RefObject<EditorView | undefined>;
  previewRef: RefObject<HTMLDivElement | null>;
  onSave: () => void;
  onCancel: () => void;
  onToggleStar: () => void;
  onPdfExport: () => void;
  onVimToggle: (enabled: boolean) => void;
  onContentChange: (content: string) => void;
  onCursorStateChange: (state: EditorCursorState) => void;
  onNoteSelect: (path: string) => void;
  onLinkClick: (name: string) => void;
  onCreateNote: (name: string) => void;
}

export function EditModeView({
  activeNote, editContent, originalContent,
  vimEnabled, isStarred, resolvedTheme, allNotes,
  editorViewRef, previewRef,
  onSave, onCancel, onToggleStar, onPdfExport,
  onVimToggle, onContentChange, onCursorStateChange,
  onNoteSelect, onLinkClick, onCreateNote,
}: EditModeViewProps) {
  const hasChanges = editContent !== originalContent;

  return (
    <>
      <div className="w-1/2 flex flex-col overflow-hidden border-r">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50/50 dark:bg-surface-900/50">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">
            {activeNote.path}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              className="px-2 py-0.5 rounded text-xs font-medium bg-violet-500 text-white hover:bg-violet-600 transition-colors"
              title="Save changes"
            >
              Save
            </button>
            <button
              onClick={onCancel}
              className="px-2 py-0.5 rounded text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors"
              title="Cancel editing (discard changes)"
            >
              Cancel
            </button>
            <button
              onClick={onToggleStar}
              className={`p-1 rounded transition-colors ${isStarred ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-400 hover:text-yellow-500'}`}
              title={isStarred ? 'Unstar (Ctrl+Shift+S)' : 'Star (Ctrl+Shift+S)'}
            >
              <Star size={14} fill={isStarred ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={onPdfExport}
              className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title="Export as PDF"
            >
              <FileDown size={14} />
            </button>
            {hasChanges && <span className="text-xs text-yellow-500">Unsaved</span>}
            {!hasChanges && <span className="text-xs text-gray-500">No changes</span>}
          </div>
        </div>
        <EditorToolbar viewRef={editorViewRef} vimEnabled={vimEnabled} onVimToggle={onVimToggle} />
        <div className="flex-1 overflow-hidden">
          <Editor
            content={editContent ?? activeNote.content}
            onChange={onContentChange}
            darkMode={resolvedTheme === 'dark'}
            allNotes={allNotes}
            onCursorStateChange={onCursorStateChange}
            viewRef={editorViewRef}
            vimEnabled={vimEnabled}
          />
        </div>
        <OutgoingLinksPanel
          content={activeNote.content}
          allNotes={allNotes}
          onNoteSelect={onNoteSelect}
          onCreateNote={onCreateNote}
        />
        <BacklinksPanel notePath={activeNote.path} onNoteSelect={onNoteSelect} />
      </div>
      <div className="w-1/2 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 border-b bg-gray-50/50 dark:bg-surface-900/50" style={{ minHeight: '39px' }}>
          <div className="flex items-center">
            <BookOpen size={14} className="text-gray-400 mr-2" />
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Preview</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" ref={previewRef}>
          <Preview
            content={activeNote.content}
            onLinkClick={onLinkClick}
            allNotes={allNotes}
            onCreateNote={onCreateNote}
          />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Create PreviewModeView**

Create `packages/client/src/components/Views/PreviewModeView.tsx`:
```tsx
import { RefObject } from 'react';
import { Preview } from '../Preview/Preview';
import { OutgoingLinksPanel } from '../OutgoingLinks/OutgoingLinksPanel';
import { BacklinksPanel } from '../Backlinks/BacklinksPanel';
import { BookOpen, Pencil, Share2, Star, FileDown } from 'lucide-react';

interface PreviewModeViewProps {
  activeNote: { path: string; title: string; content: string };
  isStarred: boolean;
  allNotes: any[];
  previewRef: RefObject<HTMLDivElement | null>;
  onEdit: () => void;
  onShare: () => void;
  onToggleStar: () => void;
  onPdfExport: () => void;
  onNoteSelect: (path: string) => void;
  onLinkClick: (name: string) => void;
  onCreateNote: (name: string) => void;
}

export function PreviewModeView({
  activeNote, isStarred, allNotes, previewRef,
  onEdit, onShare, onToggleStar, onPdfExport,
  onNoteSelect, onLinkClick, onCreateNote,
}: PreviewModeViewProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50/50 dark:bg-surface-900/50">
        <div className="flex items-center">
          <BookOpen size={14} className="text-gray-400 mr-2" />
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">
            {activeNote.path}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="p-1 rounded text-gray-400 hover:text-violet-500 transition-colors" title="Edit note (Ctrl+E)">
            <Pencil size={14} />
          </button>
          <button onClick={onShare} className="p-1 rounded text-gray-400 hover:text-violet-500 transition-colors" title="Share note">
            <Share2 size={14} />
          </button>
          <button
            onClick={onToggleStar}
            className={`p-1 rounded transition-colors ${isStarred ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-400 hover:text-yellow-500'}`}
            title={isStarred ? 'Unstar (Ctrl+Shift+S)' : 'Star (Ctrl+Shift+S)'}
          >
            <Star size={14} fill={isStarred ? 'currentColor' : 'none'} />
          </button>
          <button onClick={onPdfExport} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" title="Export as PDF">
            <FileDown size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" ref={previewRef}>
        <Preview content={activeNote.content} onLinkClick={onLinkClick} allNotes={allNotes} onCreateNote={onCreateNote} />
      </div>
      <OutgoingLinksPanel content={activeNote.content} allNotes={allNotes} onNoteSelect={onNoteSelect} onCreateNote={onCreateNote} />
      <BacklinksPanel notePath={activeNote.path} onNoteSelect={onNoteSelect} />
    </div>
  );
}
```

- [ ] **Step 3: Create EmptyStateView**

Create `packages/client/src/components/Views/EmptyStateView.tsx`:
```tsx
import { BookOpen } from 'lucide-react';

export function EmptyStateView() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
          <BookOpen size={28} className="text-violet-500" />
        </div>
        <h2 className="text-lg font-semibold mb-1">No note selected</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Select a note from the sidebar or create a new one
        </p>
        <div className="mt-4 text-xs text-gray-400 dark:text-gray-500 inline-grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-left">
          <kbd className="kbd">Ctrl+P</kbd> <span>Quick switcher</span>
          <kbd className="kbd">Ctrl+N</kbd> <span>New note</span>
          <kbd className="kbd">Ctrl+B</kbd> <span>Toggle sidebar</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify types compile**

Run: `cd /Users/pascal/Development/kryton && npx tsc --noEmit --project packages/client/tsconfig.json`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Views/ && git commit -m "refactor: extract EditModeView, PreviewModeView, and EmptyStateView"
```

---

## Task 6: Extract RightPanel Component

**Files:**
- Create: `packages/client/src/components/Layout/RightPanel.tsx`

- [ ] **Step 1: Create RightPanel component**

Create `packages/client/src/components/Layout/RightPanel.tsx`:
```tsx
import { GraphPanel } from '../Graph/GraphPanel';
import { OutlinePane } from '../Outline/OutlinePane';
import { ResizeHandle } from './ResizeHandle';
import { GraphData } from '../../lib/api';

interface RightPanelProps {
  rightPanelWidth: number;
  graphHeight: number | null;
  graphData: GraphData | null;
  graphLoading: boolean;
  activeNotePath: string | null;
  activeNoteContent: string | null;
  starredPaths: Set<string>;
  onRightPanelResize: (delta: number) => void;
  onGraphResize: (delta: number) => void;
  onNoteSelect: (path: string) => void;
  onOutlineJump: (line: number) => void;
}

export function RightPanel({
  rightPanelWidth, graphHeight,
  graphData, graphLoading,
  activeNotePath, activeNoteContent, starredPaths,
  onRightPanelResize, onGraphResize,
  onNoteSelect, onOutlineJump,
}: RightPanelProps) {
  return (
    <>
      <ResizeHandle direction="horizontal" onResize={onRightPanelResize} />
      <aside
        className="flex-shrink-0 flex flex-col bg-gray-50 dark:bg-surface-900 overflow-hidden"
        style={{ width: `${rightPanelWidth}px` }}
      >
        <div style={graphHeight != null ? { height: `${graphHeight}px` } : { flex: 1 }} className="flex flex-col overflow-hidden">
          <GraphPanel
            graphData={graphData}
            loading={graphLoading}
            activeNotePath={activeNotePath}
            onNoteSelect={onNoteSelect}
            starredPaths={starredPaths}
          />
        </div>
        {activeNoteContent != null && (
          <>
            <ResizeHandle direction="vertical" onResize={onGraphResize} />
            <div className="flex-1 min-h-[100px] overflow-hidden">
              <OutlinePane content={activeNoteContent} onJumpToLine={onOutlineJump} />
            </div>
          </>
        )}
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/pascal/Development/kryton && npx tsc --noEmit --project packages/client/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Layout/RightPanel.tsx && git commit -m "refactor: extract RightPanel component from AppContent"
```

---

## Task 7: Extract ModalsContainer and ErrorToast

**Files:**
- Create: `packages/client/src/components/Modals/ModalsContainer.tsx`
- Create: `packages/client/src/components/Toast/ErrorToast.tsx`

- [ ] **Step 1: Create ErrorToast**

Create `packages/client/src/components/Toast/ErrorToast.tsx`:
```tsx
import { X } from 'lucide-react';

interface ErrorToastProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  return (
    <div className="fixed bottom-10 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom">
      <span className="text-sm">{message}</span>
      <button onClick={onDismiss} className="hover:bg-red-600 rounded p-0.5">
        <X size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create ModalsContainer**

Create `packages/client/src/components/Modals/ModalsContainer.tsx`:
```tsx
import { TemplatePicker } from '../Templates/TemplatePicker';
import { QuickSwitcher } from '../QuickSwitcher/QuickSwitcher';
import { ShareDialog } from '../Sharing/ShareDialog';
import { AccessRequestsModal } from '../Sharing/AccessRequestsModal';
import AdminPage from '../../pages/AdminPage';

interface ModalsContainerProps {
  showTemplatePicker: boolean;
  showQuickSwitcher: boolean;
  showAdmin: boolean;
  showShareDialog: boolean;
  showAccessRequests: boolean;
  shareTarget: { path: string; isFolder: boolean } | null;
  noteTree: any[];
  onTemplateSelected: (content: string) => void;
  onCloseTemplatePicker: () => void;
  onNoteSelect: (path: string) => void;
  onCloseQuickSwitcher: () => void;
  onCloseAdmin: () => void;
  onCloseShareDialog: () => void;
  onCloseAccessRequests: () => void;
}

export function ModalsContainer({
  showTemplatePicker, showQuickSwitcher, showAdmin,
  showShareDialog, showAccessRequests, shareTarget, noteTree,
  onTemplateSelected, onCloseTemplatePicker,
  onNoteSelect, onCloseQuickSwitcher,
  onCloseAdmin, onCloseShareDialog, onCloseAccessRequests,
}: ModalsContainerProps) {
  return (
    <>
      {showTemplatePicker && (
        <TemplatePicker onSelect={onTemplateSelected} onClose={onCloseTemplatePicker} noteTitle="New Note" />
      )}
      {showQuickSwitcher && (
        <QuickSwitcher notes={noteTree} onSelect={onNoteSelect} onClose={onCloseQuickSwitcher} />
      )}
      {showAdmin && <AdminPage onClose={onCloseAdmin} />}
      {showShareDialog && shareTarget && (
        <ShareDialog notePath={shareTarget.path} isFolder={shareTarget.isFolder} onClose={onCloseShareDialog} />
      )}
      {showAccessRequests && <AccessRequestsModal onClose={onCloseAccessRequests} />}
    </>
  );
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/pascal/Development/kryton && npx tsc --noEmit --project packages/client/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/Modals/ModalsContainer.tsx packages/client/src/components/Toast/ErrorToast.tsx && git commit -m "refactor: extract ModalsContainer and ErrorToast components"
```

---

## Task 8: Rewrite App.tsx as Layout Orchestrator

**Files:**
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Rewrite AppContent to use extracted components and hooks**

Replace the `AppContent` function in `packages/client/src/App.tsx` with:
```tsx
import { AuthProvider } from './hooks/useAuth';
import { useAppState } from './hooks/useAppState';
import { useAppCallbacks } from './hooks/useAppCallbacks';
import { Header } from './components/Layout/Header';
import { SidebarLayout } from './components/Layout/SidebarLayout';
import { RightPanel } from './components/Layout/RightPanel';
import { EditModeView } from './components/Views/EditModeView';
import { PreviewModeView } from './components/Views/PreviewModeView';
import { EmptyStateView } from './components/Views/EmptyStateView';
import { ModalsContainer } from './components/Modals/ModalsContainer';
import { ErrorToast } from './components/Toast/ErrorToast';
import { StatusBar } from './components/StatusBar/StatusBar';
import LoginPage from './pages/LoginPage';

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const state = useAppState();
  const callbacks = useAppCallbacks(state);

  if (state.loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-950">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!state.user) {
    return <LoginPage />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-surface-950">
      <Header
        mobileMenuOpen={state.mobileMenuOpen}
        setMobileMenuOpen={state.setMobileMenuOpen}
        searchInputRef={state.searchInputRef}
        theme={state.themeCtx.theme}
        setTheme={state.themeCtx.setTheme}
        onNoteSelect={callbacks.handleNoteSelect}
        onAdminClick={() => state.setShowAdmin(true)}
        onAccessRequestsClick={() => state.setShowAccessRequests(true)}
      />

      <div className="flex-1 flex overflow-hidden relative">
        <SidebarLayout
          sidebarOpen={state.sidebarOpen}
          setSidebarOpen={state.setSidebarOpen}
          mobileMenuOpen={state.mobileMenuOpen}
          setMobileMenuOpen={state.setMobileMenuOpen}
          sidebarWidth={state.sidebarWidth}
          onSidebarResize={callbacks.handleSidebarResize}
          tree={state.notes.tree}
          activeNotePath={state.notes.activeNote?.path || null}
          starredPaths={state.starredPaths}
          sharedNotes={state.sharedNotes}
          onSelect={callbacks.handleNoteSelect}
          onCreateNote={state.notes.createNote}
          onDeleteNote={state.notes.deleteNote}
          onRenameNote={state.notes.renameNote}
          onCreateFolder={state.notes.createFolder}
          onDeleteFolder={state.notes.deleteFolder}
          onRenameFolder={state.notes.renameFolder}
          onDailyNote={callbacks.handleDailyNote}
          onCreateFromTemplate={callbacks.handleCreateFromTemplate}
          onToggleStar={callbacks.toggleStar}
          onShare={callbacks.handleShare}
        />

        <main className="flex-1 flex overflow-hidden">
          {state.notes.activeNote ? (
            state.editing ? (
              <EditModeView
                activeNote={state.notes.activeNote}
                editContent={state.editContent}
                originalContent={state.originalContent}
                vimEnabled={state.vimEnabled}
                isStarred={state.isActiveNoteStarred}
                resolvedTheme={state.themeCtx.resolvedTheme}
                allNotes={state.notes.tree}
                editorViewRef={state.editorViewRef}
                previewRef={state.previewRef}
                onSave={callbacks.saveEdit}
                onCancel={callbacks.cancelEdit}
                onToggleStar={callbacks.toggleActiveNoteStar}
                onPdfExport={callbacks.handlePdfExport}
                onVimToggle={callbacks.handleVimToggle}
                onContentChange={state.setEditContent}
                onCursorStateChange={state.setCursorState}
                onNoteSelect={callbacks.handleNoteSelect}
                onLinkClick={callbacks.handleLinkClick}
                onCreateNote={callbacks.handleCreateNoteFromLink}
              />
            ) : (
              <PreviewModeView
                activeNote={state.notes.activeNote}
                isStarred={state.isActiveNoteStarred}
                allNotes={state.notes.tree}
                previewRef={state.previewRef}
                onEdit={callbacks.enterEditMode}
                onShare={() => callbacks.handleShare(state.notes.activeNote!.path, false)}
                onToggleStar={callbacks.toggleActiveNoteStar}
                onPdfExport={callbacks.handlePdfExport}
                onNoteSelect={callbacks.handleNoteSelect}
                onLinkClick={callbacks.handleLinkClick}
                onCreateNote={callbacks.handleCreateNoteFromLink}
              />
            )
          ) : (
            <EmptyStateView />
          )}
        </main>

        {!state.editing && (
          <RightPanel
            rightPanelWidth={state.rightPanelWidth}
            graphHeight={state.graphHeight}
            graphData={state.graphData}
            graphLoading={state.graphLoading}
            activeNotePath={state.notes.activeNote?.path || null}
            activeNoteContent={state.notes.activeNote?.content ?? null}
            starredPaths={state.starredPaths}
            onRightPanelResize={callbacks.handleRightPanelResize}
            onGraphResize={callbacks.handleGraphResize}
            onNoteSelect={callbacks.handleNoteSelect}
            onOutlineJump={callbacks.handleOutlineJump}
          />
        )}
      </div>

      <StatusBar
        notePath={state.notes.activeNote?.path || null}
        vimMode={state.cursorState.vimMode}
        line={state.cursorState.line}
        col={state.cursorState.col}
        wordCount={state.cursorState.wordCount}
      />

      {state.notes.error && (
        <ErrorToast message={state.notes.error} onDismiss={() => state.notes.setError(null)} />
      )}

      <ModalsContainer
        showTemplatePicker={state.showTemplatePicker}
        showQuickSwitcher={state.showQuickSwitcher}
        showAdmin={state.showAdmin}
        showShareDialog={state.showShareDialog}
        showAccessRequests={state.showAccessRequests}
        shareTarget={state.shareTarget}
        noteTree={state.notes.tree}
        onTemplateSelected={callbacks.handleTemplateSelected}
        onCloseTemplatePicker={() => state.setShowTemplatePicker(false)}
        onNoteSelect={callbacks.handleNoteSelect}
        onCloseQuickSwitcher={() => state.setShowQuickSwitcher(false)}
        onCloseAdmin={() => state.setShowAdmin(false)}
        onCloseShareDialog={() => state.setShowShareDialog(false)}
        onCloseAccessRequests={() => state.setShowAccessRequests(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd /Users/pascal/Development/kryton && npm run build`
Expected: No errors.

- [ ] **Step 3: Verify linting passes**

Run: `cd /Users/pascal/Development/kryton && npm run lint`
Expected: No lint errors.

- [ ] **Step 4: Verify typecheck passes**

Run: `cd /Users/pascal/Development/kryton && npm run typecheck`
Expected: No type errors.

- [ ] **Step 5: Manual smoke test**

Run: `cd /Users/pascal/Development/kryton && npm run dev`
Verify in browser:
- App loads, login works
- Sidebar opens/closes, resizes
- Note selection, editing, preview all work
- Graph panel and outline pane render
- Modals (quick switcher, template picker, share, admin) all open/close
- Status bar shows correct info
- Error toast appears on errors

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/App.tsx && git commit -m "refactor: rewrite App.tsx as slim layout orchestrator using extracted components and hooks"
```
