import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { EditorView } from '@codemirror/view';
import { useTheme } from './hooks/useTheme';
import { useNotes } from './hooks/useNotes';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { api, shareApi, GraphData } from './lib/api';
import { exportNoteToPdf } from './lib/exportPdf';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Editor, EditorCursorState } from './components/Editor/Editor';
import { EditorToolbar } from './components/Editor/EditorToolbar';
import { Preview } from './components/Preview/Preview';
import { SearchBar } from './components/Search/SearchBar';
import { GraphPanel } from './components/Graph/GraphPanel';
import { ThemeToggle } from './components/Layout/ThemeToggle';
import { UserMenu } from './components/Layout/UserMenu';
import { BacklinksPanel } from './components/Backlinks/BacklinksPanel';
import { OutgoingLinksPanel } from './components/OutgoingLinks/OutgoingLinksPanel';
import { TemplatePicker } from './components/Templates/TemplatePicker';
import { OutlinePane } from './components/Outline/OutlinePane';
import { StatusBar } from './components/StatusBar/StatusBar';
import { QuickSwitcher } from './components/QuickSwitcher/QuickSwitcher';
import { ResizeHandle } from './components/Layout/ResizeHandle';
import { ShareDialog } from './components/Sharing/ShareDialog';
import { AccessRequestsModal } from './components/Sharing/AccessRequestsModal';
import LoginPage from './pages/LoginPage';
import AdminPage from './pages/AdminPage';
import { PanelLeft, BookOpen, X, Menu, Star, FileDown, Pencil, Share2 } from 'lucide-react';

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { user, loading } = useAuth();
  const themeCtx = useTheme();
  const notes = useNotes();
  const [editing, setEditing] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [graphHeight, setGraphHeight] = useState<number | null>(null); // null = flex-1 (auto)
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [pendingTemplatePath, setPendingTemplatePath] = useState<string | null>(null);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [cursorState, setCursorState] = useState<EditorCursorState>({
    line: 1, col: 1, vimMode: '-- NORMAL --', wordCount: 0,
  });
  const [starredPaths, setStarredPaths] = useState<Set<string>>(new Set());
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ path: string; isFolder: boolean } | null>(null);
  const [showAccessRequests, setShowAccessRequests] = useState(false);
  const [sharedNotes, setSharedNotes] = useState<{ id: string; ownerUserId: string; ownerName: string; path: string; isFolder: boolean; permission: string }[]>([]);
  const editorViewRef = useRef<EditorView>(undefined);
  const searchInputRef = useRef<HTMLInputElement>(undefined);
  const previewRef = useRef<HTMLDivElement>(null);

  // Load starred notes from settings on mount
  useEffect(() => {
    api.getSettings().then(settings => {
      if (settings.starred) {
        try {
          const paths = JSON.parse(settings.starred) as string[];
          setStarredPaths(new Set(paths));
        } catch {
          // ignore invalid JSON
        }
      }
    }).catch(() => {
      // settings endpoint might fail, ignore
    });
  }, []);

  // Fetch shared notes on mount
  useEffect(() => {
    shareApi.withMe().then(data => setSharedNotes(data || [])).catch(() => {});
  }, []);

  // Fetch graph data whenever the note tree changes
  const treeKey = notes.tree.length;

  useEffect(() => {
    let cancelled = false;
    api.getGraph()
      .then(data => { if (!cancelled) { setGraphData(data); setGraphLoading(false); } })
      .catch(() => { if (!cancelled) { setGraphLoading(false); } });
    return () => { cancelled = true; };
  }, [treeKey]);

  const toggleStar = useCallback((path: string) => {
    setStarredPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      const arr = Array.from(next);
      api.updateSetting('starred', JSON.stringify(arr)).catch(() => {});
      return next;
    });
  }, []);

  const toggleActiveNoteStar = useCallback(() => {
    if (notes.activeNote) {
      toggleStar(notes.activeNote.path);
    }
  }, [notes.activeNote, toggleStar]);

  const handleNoteSelect = useCallback((path: string) => {
    if (path.startsWith('shared:')) {
      // Parse shared:{ownerUserId}:{notePath} — shared note viewer is a follow-up
      // For now, navigation doesn't crash
    } else {
      notes.openNote(path);
    }
    setEditing(false);
    setMobileMenuOpen(false);
  }, [notes]);

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
  }, [notes]);

  const handleCreateFromTemplate = useCallback(() => {
    setPendingTemplatePath(null);
    setShowTemplatePicker(true);
  }, []);

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
  }, [notes, pendingTemplatePath]);

  const handleOutlineJump = useCallback((line: number) => {
    if (editing) {
      const view = editorViewRef.current;
      if (!view) return;
      const doc = view.state.doc;
      if (line < 1 || line > doc.lines) return;
      const lineObj = doc.line(line);
      view.dispatch({
        selection: { anchor: lineObj.from },
        scrollIntoView: true,
      });
      view.focus();
    } else {
      // Preview mode: scroll to heading by sequential index, code-block-aware
      const lines = (notes.activeNote?.content || '').split('\n');
      let inCodeBlock = false;
      let headingIndex = 0;
      let targetIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        if (!inCodeBlock && /^#{1,6}\s+/.test(lines[i])) {
          headingIndex++;
          if (i + 1 === line) {
            targetIndex = headingIndex;
            break;
          }
        }
      }
      if (targetIndex > 0) {
        const el = document.getElementById(`heading-${targetIndex}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [editing, notes.activeNote?.content]);

  const handleNewNote = useCallback(async () => {
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const noteName = `New Note ${timestamp}`;
    await notes.createNote(noteName);
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
      // Fallback: render content to HTML string
      const div = document.createElement('div');
      div.innerHTML = `<h1>${notes.activeNote.title}</h1><pre>${notes.activeNote.content}</pre>`;
      await exportNoteToPdf(notes.activeNote.title, div.innerHTML);
    }
  }, [notes.activeNote]);

  const shortcutActions = useMemo(() => ({
    toggleSidebar: () => setSidebarOpen(prev => !prev),
    toggleEdit: () => { if (notes.activeNote) setEditing(prev => !prev); },
    openQuickSwitcher: () => setShowQuickSwitcher(true),
    focusSearch: () => searchInputRef.current?.focus(),
    createNote: handleNewNote,
    renameNote: handleRenameNote,
    toggleStar: toggleActiveNoteStar,
  }), [handleNewNote, handleRenameNote, toggleActiveNoteStar, notes.activeNote]);

  useKeyboardShortcuts(shortcutActions);

  const isActiveNoteStarred = notes.activeNote ? starredPaths.has(notes.activeNote.path) : false;

  // Resize handlers
  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth(w => Math.max(180, Math.min(500, w + delta)));
  }, []);
  const handleRightPanelResize = useCallback((delta: number) => {
    setRightPanelWidth(w => Math.max(200, Math.min(600, w - delta)));
  }, []);
  const handleGraphResize = useCallback((delta: number) => {
    setGraphHeight(h => {
      const current = h ?? 400;
      return Math.max(100, current + delta);
    });
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-950">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-surface-950">
      {/* Header */}
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
            <img src="/logo.png" alt="Mnemo" className="h-11 w-auto" />
          </div>
        </div>

        <div className="flex-1 max-w-md mx-4">
          <SearchBar onSelect={handleNoteSelect} inputRef={searchInputRef} />
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
          <ThemeToggle theme={themeCtx.theme} setTheme={themeCtx.setTheme} />
          <UserMenu onAdminClick={() => setShowAdmin(true)} onAccessRequestsClick={() => setShowAccessRequests(true)} />
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar - collapsed bar on desktop when closed, full sidebar when open */}
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
          {/* Toggle button at top of open sidebar */}
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
            tree={notes.tree}
            activeNotePath={notes.activeNote?.path || null}
            onSelect={handleNoteSelect}
            onCreateNote={notes.createNote}
            onDeleteNote={notes.deleteNote}
            onRenameNote={notes.renameNote}
            onCreateFolder={notes.createFolder}
            onDeleteFolder={notes.deleteFolder}
            onRenameFolder={notes.renameFolder}
            onDailyNote={handleDailyNote}
            onCreateFromTemplate={handleCreateFromTemplate}
            starredPaths={starredPaths}
            onToggleStar={toggleStar}
            sharedNotes={sharedNotes}
            onShare={(path, isFolder) => { setShareTarget({ path, isFolder }); setShowShareDialog(true); }}
          />
        </aside>

        {/* Sidebar resize handle */}
        {sidebarOpen && <ResizeHandle direction="horizontal" onResize={handleSidebarResize} />}

        {/* Main content area */}
        <main className="flex-1 flex overflow-hidden">
          {notes.activeNote ? (
            editing ? (
              /* ── Edit mode: Editor (left half) | Preview (right half) ── */
              <>
                <div className="w-1/2 flex flex-col overflow-hidden border-r">
                  <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50/50 dark:bg-surface-900/50">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">
                      {notes.activeNote.path}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditing(false)}
                        className="p-1 rounded text-violet-500 hover:text-violet-400 transition-colors"
                        title="Done editing (Ctrl+E)"
                      >
                        <X size={14} />
                      </button>
                      <button
                        onClick={() => { setShareTarget({ path: notes.activeNote!.path, isFolder: false }); setShowShareDialog(true); }}
                        className="p-1 rounded text-gray-400 hover:text-violet-500 transition-colors"
                        title="Share note"
                      >
                        <Share2 size={14} />
                      </button>
                      <button
                        onClick={toggleActiveNoteStar}
                        className={`p-1 rounded transition-colors ${
                          isActiveNoteStarred
                            ? 'text-yellow-500 hover:text-yellow-600'
                            : 'text-gray-400 hover:text-yellow-500'
                        }`}
                        title={isActiveNoteStarred ? 'Unstar (Ctrl+Shift+S)' : 'Star (Ctrl+Shift+S)'}
                      >
                        <Star size={14} fill={isActiveNoteStarred ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={handlePdfExport}
                        className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        title="Export as PDF"
                      >
                        <FileDown size={14} />
                      </button>
                      {notes.saving && (
                        <span className="text-xs text-gray-400">Saving...</span>
                      )}
                      {!notes.saving && (
                        <span className="text-xs text-green-500">Saved</span>
                      )}
                    </div>
                  </div>
                  <EditorToolbar viewRef={editorViewRef} />
                  <div className="flex-1 overflow-hidden">
                    <Editor
                      content={notes.activeNote.content}
                      onChange={notes.updateContent}
                      darkMode={themeCtx.resolvedTheme === 'dark'}
                      allNotes={notes.tree}
                      onCursorStateChange={setCursorState}
                      viewRef={editorViewRef}
                    />
                  </div>
                  <OutgoingLinksPanel
                    content={notes.activeNote.content}
                    allNotes={notes.tree}
                    onNoteSelect={handleNoteSelect}
                    onCreateNote={handleCreateNoteFromLink}
                  />
                  <BacklinksPanel
                    notePath={notes.activeNote.path}
                    onNoteSelect={handleNoteSelect}
                  />
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
                      content={notes.activeNote.content}
                      onLinkClick={handleLinkClick}
                      allNotes={notes.tree}
                      onCreateNote={handleCreateNoteFromLink}
                    />
                  </div>
                </div>
              </>
            ) : (
              /* ── Default mode: Preview (center) ── */
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50/50 dark:bg-surface-900/50">
                  <div className="flex items-center">
                    <BookOpen size={14} className="text-gray-400 mr-2" />
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">
                      {notes.activeNote.path}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditing(true)}
                      className="p-1 rounded text-gray-400 hover:text-violet-500 transition-colors"
                      title="Edit note (Ctrl+E)"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => { setShareTarget({ path: notes.activeNote!.path, isFolder: false }); setShowShareDialog(true); }}
                      className="p-1 rounded text-gray-400 hover:text-violet-500 transition-colors"
                      title="Share note"
                    >
                      <Share2 size={14} />
                    </button>
                    <button
                      onClick={toggleActiveNoteStar}
                      className={`p-1 rounded transition-colors ${
                        isActiveNoteStarred
                          ? 'text-yellow-500 hover:text-yellow-600'
                          : 'text-gray-400 hover:text-yellow-500'
                      }`}
                      title={isActiveNoteStarred ? 'Unstar (Ctrl+Shift+S)' : 'Star (Ctrl+Shift+S)'}
                    >
                      <Star size={14} fill={isActiveNoteStarred ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={handlePdfExport}
                      className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title="Export as PDF"
                    >
                      <FileDown size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto" ref={previewRef}>
                  <Preview
                    content={notes.activeNote.content}
                    onLinkClick={handleLinkClick}
                    allNotes={notes.tree}
                    onCreateNote={handleCreateNoteFromLink}
                  />
                </div>
                <OutgoingLinksPanel
                  content={notes.activeNote.content}
                  allNotes={notes.tree}
                  onNoteSelect={handleNoteSelect}
                  onCreateNote={handleCreateNoteFromLink}
                />
                <BacklinksPanel
                  notePath={notes.activeNote.path}
                  onNoteSelect={handleNoteSelect}
                />
              </div>
            )
          ) : (
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
          )}
        </main>

        {/* Right panel: Graph + Outline (hidden in edit mode) */}
        {!editing && (
          <>
            <ResizeHandle direction="horizontal" onResize={handleRightPanelResize} />
            <aside
              className="flex-shrink-0 flex flex-col bg-gray-50 dark:bg-surface-900 overflow-hidden"
              style={{ width: `${rightPanelWidth}px` }}
            >
              <div style={graphHeight != null ? { height: `${graphHeight}px` } : { flex: 1 }} className="flex flex-col overflow-hidden">
                <GraphPanel
                  graphData={graphData}
                  loading={graphLoading}
                  activeNotePath={notes.activeNote?.path || null}
                  onNoteSelect={handleNoteSelect}
                  starredPaths={starredPaths}
                />
              </div>
              {notes.activeNote && (
                <>
                  <ResizeHandle direction="vertical" onResize={handleGraphResize} />
                  <div className="flex-1 min-h-[100px] overflow-hidden">
                    <OutlinePane
                      content={notes.activeNote.content}
                      onJumpToLine={handleOutlineJump}
                    />
                  </div>
                </>
              )}
            </aside>
          </>
        )}
      </div>

      {/* Status bar */}
      <StatusBar
        notePath={notes.activeNote?.path || null}
        vimMode={cursorState.vimMode}
        line={cursorState.line}
        col={cursorState.col}
        wordCount={cursorState.wordCount}
      />

      {/* Error toast */}
      {notes.error && (
        <div className="fixed bottom-10 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom">
          <span className="text-sm">{notes.error}</span>
          <button onClick={() => notes.setError(null)} className="hover:bg-red-600 rounded p-0.5">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Template picker modal */}
      {showTemplatePicker && (
        <TemplatePicker
          onSelect={handleTemplateSelected}
          onClose={() => setShowTemplatePicker(false)}
          noteTitle="New Note"
        />
      )}

      {/* Quick switcher modal */}
      {showQuickSwitcher && (
        <QuickSwitcher
          notes={notes.tree}
          onSelect={handleNoteSelect}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}

      {/* Admin panel */}
      {showAdmin && <AdminPage onClose={() => setShowAdmin(false)} />}

      {/* Share dialog */}
      {showShareDialog && shareTarget && (
        <ShareDialog notePath={shareTarget.path} isFolder={shareTarget.isFolder} onClose={() => setShowShareDialog(false)} />
      )}

      {/* Access requests modal */}
      {showAccessRequests && (
        <AccessRequestsModal onClose={() => setShowAccessRequests(false)} />
      )}
    </div>
  );
}
