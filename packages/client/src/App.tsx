import { useMemo, useEffect, useCallback, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import { PluginSlotRegistry, PluginProvider, usePluginSlots, setEditorOption } from '@azrtydxb/ui';
import { ClientPluginManager } from './plugins/PluginManager';
import { PluginSlot } from './components/PluginSlot/PluginSlot';
import { useUIStore } from './stores/uiStore';
import { HttpAdapter } from './data/HttpAdapter';
import { HttpDataProvider } from './data/HttpDataProvider';
import { useUrlSync } from './hooks/useUrlSync';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
const pluginRegistry = new PluginSlotRegistry();
const pluginManager = new ClientPluginManager(pluginRegistry);

/**
 * Stable per-tab client id used to suppress the echo of a vault event
 * back to the originating tab. sessionStorage keeps it stable across
 * reloads of the same tab but distinct across different tabs.
 */
function getOrCreateClientId(): string {
  try {
    const KEY = "kryton.clientId";
    const existing = window.sessionStorage.getItem(KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `c-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    window.sessionStorage.setItem(KEY, generated);
    return generated;
  } catch {
    // sessionStorage unavailable (SSR, locked-down embedded webview);
    // fall back to a fresh id so requests still carry a stable header
    // for the lifetime of this module.
    return `c-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
}

// Singleton HttpAdapter — implements KrytonDataAdapter for the web client.
// Wrap the app in HttpDataProvider so @azrtydxb/ui hooks (useUiNotes, etc.)
// can access data via useKrytonData().
const httpAdapter = new HttpAdapter({
  baseUrl: (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_BASE_URL ?? "",
  clientId: typeof window !== "undefined" ? getOrCreateClientId() : undefined,
});
import { useAppState } from './hooks/useAppState';
import { useAppCallbacks } from './hooks/useAppCallbacks';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useVaultEvents } from './hooks/useVaultEvents';
import { useHostHooksWiring } from './hooks/useHostHooksWiring';
import { Header } from './components/Layout/Header';
import { SidebarLayout } from './components/Layout/SidebarLayout';
import { RightPanel } from './components/Layout/RightPanel';
import { MobileGraphOverlay } from './components/Graph/MobileGraphOverlay';
import { EditModeView } from './components/Views/EditModeView';
import { PreviewModeView } from './components/Views/PreviewModeView';
import { AllNotesView } from './components/Views/AllNotesView';
import { TagsView } from './components/Views/TagsView';
import { GraphPanel } from './components/Graph/GraphPanel';
import { EmptyStateView } from './components/Views/EmptyStateView';
import { ModalsContainer } from './components/Modals/ModalsContainer';
import { ErrorToast } from './components/Toast/ErrorToast';
import { ToastContainer } from './components/Toast/ToastContainer';
import { NoteHistoryPopover } from './components/NoteHistoryPopover/NoteHistoryPopover';
import { StatusBar } from './components/StatusBar/StatusBar';
import { api, FileNode } from './lib/api';
import LoginPage from './pages/LoginPage';

export default function App() {
  return (
    <HttpDataProvider adapter={httpAdapter}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PluginProvider registry={pluginRegistry}>
            <AppContent />
          </PluginProvider>
        </AuthProvider>
      </QueryClientProvider>
    </HttpDataProvider>
  );
}

function AppStatusBar({
  notePath,
  noteContent,
}: {
  notePath: string | null;
  noteContent: string | null;
}) {
  const cursorState = useUIStore((s) => s.cursorState);
  const editing = useUIStore((s) => s.editing);

  // Backlinks count is server-derived (live indexer); cached so the bar
  // reflects current cross-references without forcing extra fetches.
  const backlinksQuery = useQuery({
    queryKey: ['backlinks-count', notePath],
    queryFn: () => (notePath ? api.getBacklinks(notePath) : Promise.resolve([])),
    enabled: !!notePath,
    staleTime: 5_000,
  });
  const backlinksCount = backlinksQuery.data?.length ?? 0;

  // Derive outgoing-link, tag, and word counts from the active note's content
  // so the status bar tracks the live document. For the word count we strip
  // every markdown syntax marker that a reader wouldn't count as a word —
  // headings, list bullets, blockquote arrows, bold/italic emphasis,
  // strikethroughs, inline code, code fences, and wiki/markdown link wrappers
  // — so '# Title' counts as one word ('Title'), '**bold**' as one ('bold'),
  // and '[link](url)' as one ('link').
  const { outgoing, tags, words } = useMemo(() => {
    if (!noteContent) return { outgoing: 0, tags: 0, words: 0 };
    // Count outgoing wikilinks and tags from the raw text (before stripping
    // markdown) since those constructs ARE the thing being counted.
    const outgoingMatches = noteContent.match(/\[\[[^\]]+\]\]/g) || [];
    const tagMatches = noteContent.match(/(^|\s)#[A-Za-z][\w-]*/g) || [];

    // Word count uses a markdown-aware strip so syntax tokens don't pollute
    // the result. Order matters: remove fences first, then inline markers.
    const cleaned = noteContent
      // Front-matter
      .replace(/^---[\s\S]*?---\n*/m, '')
      // Fenced code blocks
      .replace(/```[\s\S]*?```/g, ' ')
      // Inline code
      .replace(/`[^`]*`/g, ' ')
      // Wikilinks: [[Target|Label]] or [[Target]] → keep the visible label
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      // Markdown links: [text](url) → text; image alts dropped entirely
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Reference-style link targets like '[1]: http://…'
      .replace(/^\s*\[[^\]]+\]:\s.*$/gm, '')
      // HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Heading markers '# ' '## ' …, list bullets '- ', '* ', '+ ',
      // ordered-list markers '1. ', blockquote arrows '> '
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      // Horizontal rules
      .replace(/^\s*([-*_])\1{2,}\s*$/gm, ' ')
      // Emphasis markers (keep inner text)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Strikethrough
      .replace(/~~([^~]+)~~/g, '$1')
      // Task list markers
      .replace(/^\s*[-*+]?\s*\[[ xX]\]\s+/gm, '');

    const wordMatches = cleaned.match(/[A-Za-z0-9][A-Za-z0-9'_-]*/g) || [];
    return {
      outgoing: outgoingMatches.length,
      tags: tagMatches.length,
      words: wordMatches.length,
    };
  }, [noteContent]);

  return (
    <div className="flex items-center">
      <PluginSlot slot="statusbar-left" />
      <StatusBar
        notePath={notePath}
        // Ln/Col is only meaningful in edit mode (no cursor in preview).
        line={editing ? cursorState.line : null}
        col={editing ? cursorState.col : null}
        // Editor's reported word count uses raw doc.split — prefer the
        // preview-rendered count when not editing (or when the editor count
        // is zero, e.g. fresh mount).
        wordCount={editing && cursorState.wordCount ? cursorState.wordCount : words}
        outgoingCount={outgoing}
        backlinksCount={backlinksCount}
        tagsCount={tags}
      />
      <PluginSlot slot="statusbar-right" />
    </div>
  );
}

function AppModals({
  noteTree,
  onTemplateSelected,
  onNoteSelect,
  onNewNote,
  onDailyNote,
  onGraphView,
}: {
  noteTree: FileNode[];
  onTemplateSelected: (content: string) => void;
  onNoteSelect: (path: string) => void;
  onNewNote?: () => void;
  onDailyNote?: () => void;
  onGraphView?: () => void;
}) {
  const showTemplatePicker = useUIStore((s) => s.showTemplatePicker);
  const setShowTemplatePicker = useUIStore((s) => s.setShowTemplatePicker);
  const showQuickSwitcher = useUIStore((s) => s.showQuickSwitcher);
  const setShowQuickSwitcher = useUIStore((s) => s.setShowQuickSwitcher);
  const showAdmin = useUIStore((s) => s.showAdmin);
  const setShowAdmin = useUIStore((s) => s.setShowAdmin);
  const showShareDialog = useUIStore((s) => s.showShareDialog);
  const setShowShareDialog = useUIStore((s) => s.setShowShareDialog);
  const showAccessRequests = useUIStore((s) => s.showAccessRequests);
  const setShowAccessRequests = useUIStore((s) => s.setShowAccessRequests);
  const showAccountSettings = useUIStore((s) => s.showAccountSettings);
  const setShowAccountSettings = useUIStore((s) => s.setShowAccountSettings);
  const shareTarget = useUIStore((s) => s.shareTarget);

  return (
    <ModalsContainer
      showTemplatePicker={showTemplatePicker}
      showQuickSwitcher={showQuickSwitcher}
      showAdmin={showAdmin}
      showShareDialog={showShareDialog}
      showAccessRequests={showAccessRequests}
      showAccountSettings={showAccountSettings}
      shareTarget={shareTarget}
      noteTree={noteTree}
      onTemplateSelected={onTemplateSelected}
      onCloseTemplatePicker={() => setShowTemplatePicker(false)}
      onNoteSelect={onNoteSelect}
      onCloseQuickSwitcher={() => setShowQuickSwitcher(false)}
      onCloseAdmin={() => setShowAdmin(false)}
      onCloseShareDialog={() => setShowShareDialog(false)}
      onCloseAccessRequests={() => setShowAccessRequests(false)}
      onCloseAccountSettings={() => setShowAccountSettings(false)}
      onNewNote={onNewNote}
      onDailyNote={onDailyNote}
      onGraphView={onGraphView}
      onSettings={() => setShowAccountSettings(true)}
    />
  );
}

function AppContent() {
  // Open the vault-events push channel as soon as the app renders. The
  // hook itself gates internally on a live session so it's safe to call
  // before the user signs in.
  useVaultEvents();

  const state = useAppState(pluginManager);
  const callbacks = useAppCallbacks(state);

  // Wire the plugin host-hooks registry so api.notes.saveCurrent() and
  // api.ui.closePane() reach the live shell. Effects re-run when the
  // active note changes so the saveCurrent closure always sees the
  // latest buffer.
  useHostHooksWiring({
    activeNote: state.notes.activeNote,
    closeActiveNote: state.notes.closeActiveNote,
    currentUser: state.user,
    theme: state.themeCtx.resolvedTheme,
  });

  // Restore the line-number gutter as the default for the desktop / web
  // shell. The @azrtydxb/ui editor-options store ships with
  // lineNumbers=false (Phase 4.4) so plugin-less embedders stay
  // gutter-free, but the user expects line numbers in the main app.
  // Set once at app boot — vim-mode's :set nonumber can still flip it.
  useEffect(() => {
    setEditorOption('lineNumbers', true);
  }, []);

  const {
    user, loading,
    themeCtx,
    notes,
    editing,
    editContent,
    originalContent,
    sidebarOpen, setSidebarOpen,
    mobileMenuOpen, setMobileMenuOpen,
    sidebarWidth,
    rightPanelWidth,
    graphData, graphLoading,
    setCursorState,
    starredPaths,
    sharedNotes,
    isActiveNoteStarred,
    searchInputRef, previewRef,
  } = state;

  const setShowAdmin = useUIStore((s) => s.setShowAdmin);
  const setShowAccessRequests = useUIStore((s) => s.setShowAccessRequests);
  const setShowQuickSwitcher = useUIStore((s) => s.setShowQuickSwitcher);
  const setEditContent = useUIStore((s) => s.setEditContent);
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  // Tag selected via the sidebar chip click — passed into <TagsView> as
  // initialTag so the view opens already filtered. Subsequent clicks
  // inside the TagsView manage selection internally.
  const [pendingTag, setPendingTag] = useState<string | null>(null);
  const handleSidebarTagSelect = useCallback((tag: string) => {
    setPendingTag(tag);
    setView('tags');
  }, [setView]);

  // URL is the source of truth for shareable nav state. The hook listens for
  // popstate, writes the URL on view/tab changes, and dispatches a
  // `kryton:url-tag` CustomEvent so the local `pendingTag` state can be
  // seeded on restore without coupling the hook to App-local state.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tag: string | null }>).detail;
      setPendingTag(detail?.tag ?? null);
    };
    window.addEventListener('kryton:url-tag', handler);
    return () => window.removeEventListener('kryton:url-tag', handler);
  }, []);

  const notesTree = state.notes.tree;
  const noteExists = useCallback((path: string) => {
    if (notesTree.length === 0) return true;
    const walk = (nodes: typeof notesTree): boolean => {
      for (const n of nodes) {
        if (n.type === 'file' && n.path === path) return true;
        if (n.children && walk(n.children)) return true;
      }
      return false;
    };
    return walk(notesTree);
  }, [notesTree]);

  useUrlSync(state.notes.activeNote?.tabId ?? state.notes.activeNote?.path ?? null, {
    openNote: state.notes.openNote,
    openSharedNote: state.notes.openSharedNote,
    closeActiveNote: state.notes.closeActiveNote,
    noteExists,
  });

  const {
    toggleStar,
    toggleActiveNoteStar,
    handleNoteSelect,
    handleTabClose,
    handleLinkClick,
    handleCreateNoteFromLink,
    handleDailyNote,
    handleCreateFromTemplate,
    handleTemplateSelected,
    handleNewNote,
    handleRenameNote,
    handlePdfExport,
    enterEditMode,
    saveEdit,
    saveEditInPlace,
    cancelEdit,
    handleSidebarResize,
    handleRightPanelResize,
    handleShare,
  } = callbacks;

  useEffect(() => {
    if (!user) return;
    pluginManager.loadActivePlugins().catch((err) => {
      console.error('[plugins] Failed to load active plugins:', err);
    });
  }, [user]);

  const shortcutActions = useMemo(() => ({
    toggleSidebar: () => setSidebarOpen(prev => !prev),
    toggleEdit: () => { if (editing) cancelEdit(); else enterEditMode(); },
    openQuickSwitcher: () => setShowQuickSwitcher(true),
    focusSearch: () => searchInputRef.current?.focus(),
    createNote: handleNewNote,
    renameNote: handleRenameNote,
    toggleStar: toggleActiveNoteStar,
    openAllNotes: () => setView('all'),
    toggleGraph: () => setView(view === 'graph' ? 'note' : 'graph'),
  }), [handleNewNote, handleRenameNote, toggleActiveNoteStar, editing, cancelEdit, enterEditMode, setSidebarOpen, setShowQuickSwitcher, searchInputRef, setView, view]);

  useKeyboardShortcuts(shortcutActions);

  const { getCodeFenceRenderer } = usePluginSlots();

  const onShareActiveNote = useCallback(() => {
    if (notes.activeNote) handleShare(notes.activeNote.path, false);
  }, [notes.activeNote, handleShare]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div style={{ color: 'var(--fg-3)' }}>Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <Header
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        searchInputRef={searchInputRef}
        theme={themeCtx.theme}
        setTheme={themeCtx.setTheme}
        onNoteSelect={handleNoteSelect}
        onAdminClick={() => setShowAdmin(true)}
        onAccessRequestsClick={() => setShowAccessRequests(true)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(prev => !prev)}
        onOpenPalette={() => setShowQuickSwitcher(true)}
        activeNotePath={notes.activeNote?.path ?? null}
        onNewNote={handleNewNote}
      />

      <div className="flex-1 flex overflow-hidden relative">
        <SidebarLayout
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          mobileMenuOpen={mobileMenuOpen}
          setMobileMenuOpen={setMobileMenuOpen}
          sidebarWidth={sidebarWidth}
          onSidebarResize={handleSidebarResize}
          tree={notes.tree}
          activeNotePath={notes.activeNote?.path ?? null}
          starredPaths={starredPaths}
          sharedNotes={sharedNotes}
          onSelect={handleNoteSelect}
          onCreateNote={notes.createNote}
          onDeleteNote={notes.deleteNote}
          onRenameNote={notes.renameNote}
          onCreateFolder={notes.createFolder}
          onDeleteFolder={notes.deleteFolder}
          onRenameFolder={notes.renameFolder}
          onDailyNote={handleDailyNote}
          onCreateFromTemplate={handleCreateFromTemplate}
          onToggleStar={toggleStar}
          onShare={handleShare}
          onTagSelect={handleSidebarTagSelect}
        >
          <PluginSlot slot="sidebar" />
        </SidebarLayout>

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Plugin editor-toolbar buttons are rendered inline by the
              editor's own toolbar (see Editor/EditorToolbar.tsx), so
              they appear alongside the built-in H1/Bold/Table actions
              and only when the editor is mounted (Edit/Split modes). */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            {view === 'all' ? (
              <AllNotesView
                tree={notes.tree}
                starredPaths={starredPaths}
                onSelect={(p) => { handleNoteSelect(p); setView('note'); }}
                onToggleStar={toggleStar}
              />
            ) : view === 'graph' ? (
              <GraphPanel
                graphData={graphData}
                loading={graphLoading}
                activeNotePath={notes.activeNote?.path ?? null}
                starredPaths={starredPaths}
                onNoteSelect={(p) => { handleNoteSelect(p); setView('note'); }}
                fullscreen
              />
            ) : view === 'tags' ? (
              <TagsView
                // key remounts the view when the user picks a different tag
                // from the sidebar, so initialTag seeds fresh state without
                // requiring a sync-in-effect inside TagsView.
                key={pendingTag ?? '__none__'}
                initialTag={pendingTag}
                onNoteSelect={(p) => { handleNoteSelect(p); setView('note'); setPendingTag(null); }}
              />
            ) : notes.activeNote ? (
              editing ? (
                <EditModeView
                  activeNote={notes.activeNote}
                  editContent={editContent}
                  originalContent={originalContent}
                  isStarred={isActiveNoteStarred}
                  resolvedTheme={themeCtx.resolvedTheme}
                  allNotes={notes.tree}
                  previewRef={previewRef}
                  getCodeFenceRenderer={getCodeFenceRenderer}
                  onSave={saveEdit}
                  onAutoSave={saveEditInPlace}
                  onCancel={cancelEdit}
                  onToggleStar={toggleActiveNoteStar}
                  onPdfExport={handlePdfExport}
                  onContentChange={setEditContent}
                  onCursorStateChange={setCursorState}
                  onNoteSelect={handleNoteSelect}
                  onTabClose={handleTabClose}
                  onLinkClick={handleLinkClick}
                  onCreateNote={handleCreateNoteFromLink}
                />
              ) : (
                <PreviewModeView
                  activeNote={notes.activeNote}
                  isStarred={isActiveNoteStarred}
                  allNotes={notes.tree}
                  previewRef={previewRef}
                  onEdit={enterEditMode}
                  onShare={onShareActiveNote}
                  onToggleStar={toggleActiveNoteStar}
                  onPdfExport={handlePdfExport}
                  onNoteSelect={handleNoteSelect}
                  onTabClose={handleTabClose}
                  onLinkClick={handleLinkClick}
                  onCreateNote={handleCreateNoteFromLink}
                  getCodeFenceRenderer={getCodeFenceRenderer}
                />
              )
            ) : (
              <EmptyStateView />
            )}
          </div>
          {/* EditorMeta — per prototype, the editor pane's own bottom rail
             (28px, bg-1) so it shares the baseline with the sidebar
             AgentsFooter and the graph legend. */}
          <AppStatusBar
            notePath={notes.activeNote?.path ?? null}
            noteContent={notes.activeNote?.content ?? null}
          />
        </main>

        {/* Graph rail is shown in every view except the fullscreen graph view
            (matches prototype/app/main.jsx: graphPosition='right' && view!=='graph').
            Previously hidden during edit mode — that broke the 3-pane layout. */}
        {view !== 'graph' && view !== 'all' && view !== 'tags' && (
          <>
            <RightPanel
              rightPanelWidth={rightPanelWidth}
              graphData={graphData}
              graphLoading={graphLoading}
              activeNotePath={notes.activeNote?.path ?? null}
              starredPaths={starredPaths}
              onRightPanelResize={handleRightPanelResize}
              onNoteSelect={handleNoteSelect}
            />
            <MobileGraphOverlay
              graphData={graphData}
              loading={graphLoading}
              activeNotePath={notes.activeNote?.path ?? null}
              onNoteSelect={handleNoteSelect}
              starredPaths={starredPaths}
            />
          </>
        )}
      </div>

      <ErrorToast message={notes.error} onDismiss={() => notes.setError(null)} />

      <ToastContainer />

      <NoteHistoryPopover
        activePath={notes.activeNote?.path ?? null}
        onRestored={() => notes.activeNote && notes.openNote(notes.activeNote.path)}
      />

      <AppModals
        noteTree={notes.tree}
        onTemplateSelected={handleTemplateSelected}
        onNoteSelect={handleNoteSelect}
        onNewNote={callbacks.handleNewNote}
        onDailyNote={callbacks.handleDailyNote}
        onGraphView={() => setView('graph')}
      />
    </div>
  );
}
