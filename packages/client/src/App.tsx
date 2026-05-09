import { useMemo, useEffect, useCallback, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import { PluginSlotRegistry, PluginProvider, usePluginSlots } from '@azrtydxb/ui';
import { ClientPluginManager } from './plugins/PluginManager';
import { PluginSlot } from './components/PluginSlot/PluginSlot';
import { useUIStore } from './stores/uiStore';
import { HttpAdapter } from './data/HttpAdapter';
import { HttpDataProvider } from './data/HttpDataProvider';

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

// Singleton HttpAdapter — implements KrytonDataAdapter for the web client.
// Wrap the app in HttpDataProvider so @azrtydxb/ui hooks (useUiNotes, etc.)
// can access data via useKrytonData().
const httpAdapter = new HttpAdapter({
  baseUrl: (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_BASE_URL ?? "",
});
import { useAppState } from './hooks/useAppState';
import { useAppCallbacks } from './hooks/useAppCallbacks';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
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
import { StatusBar } from './components/StatusBar/StatusBar';
import { FileNode } from './lib/api';
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

  // Derive outgoing-link and tag counts from the active note's content so the
  // status bar tracks the live document, not just file metadata. Strip
  // fenced code blocks first so wikilinks/hashtags inside snippets don't
  // inflate the counts.
  const { outgoing, tags, words } = useMemo(() => {
    if (!noteContent) return { outgoing: 0, tags: 0, words: 0 };
    const stripped = noteContent.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    const outgoingMatches = stripped.match(/\[\[[^\]]+\]\]/g) || [];
    const tagMatches = stripped.match(/(^|\s)#[A-Za-z][\w-]*/g) || [];
    const wordMatches = stripped.match(/\S+/g) || [];
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
        line={cursorState.line}
        col={cursorState.col}
        wordCount={cursorState.wordCount || words}
        outgoingCount={outgoing}
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
}: {
  noteTree: FileNode[];
  onTemplateSelected: (content: string) => void;
  onNoteSelect: (path: string) => void;
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
    />
  );
}

function AppContent() {
  const state = useAppState(pluginManager);
  const callbacks = useAppCallbacks(state);

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

  const {
    toggleStar,
    toggleActiveNoteStar,
    handleNoteSelect,
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
      <div className="h-screen flex items-center justify-center bg-white dark:bg-surface-950">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-surface-950">
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
          <div className="hidden md:block">
            <PluginSlot slot="editor-toolbar" />
          </div>
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
                mode="global"
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
                  onLinkClick={handleLinkClick}
                  onCreateNote={handleCreateNoteFromLink}
                  onRestored={() => notes.openNote(notes.activeNote!.path)}
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

      <AppModals
        noteTree={notes.tree}
        onTemplateSelected={handleTemplateSelected}
        onNoteSelect={handleNoteSelect}
      />
    </div>
  );
}
