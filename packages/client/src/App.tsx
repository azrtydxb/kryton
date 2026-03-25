import { useMemo, useEffect, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import { PluginSlotRegistry } from './plugins/PluginSlotRegistry';
import { ClientPluginManager } from './plugins/PluginManager';
import { PluginProvider, usePluginSlots } from './plugins/PluginContext';
import { PluginSlot } from './components/PluginSlot/PluginSlot';
import { useUIStore } from './stores/uiStore';

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
import { useAppState } from './hooks/useAppState';
import { useAppCallbacks } from './hooks/useAppCallbacks';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Header } from './components/Layout/Header';
import { SidebarLayout } from './components/Layout/SidebarLayout';
import { RightPanel } from './components/Layout/RightPanel';
import { EditModeView } from './components/Views/EditModeView';
import { PreviewModeView } from './components/Views/PreviewModeView';
import { EmptyStateView } from './components/Views/EmptyStateView';
import { ModalsContainer } from './components/Modals/ModalsContainer';
import { ErrorToast } from './components/Toast/ErrorToast';
import { StatusBar } from './components/StatusBar/StatusBar';
import { FileNode } from './lib/api';
import LoginPage from './pages/LoginPage';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PluginProvider registry={pluginRegistry}>
          <AppContent />
        </PluginProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AppStatusBar({ notePath }: { notePath: string | null }) {
  const cursorState = useUIStore((s) => s.cursorState);

  return (
    <div className="flex items-center">
      <PluginSlot slot="statusbar-left" />
      <StatusBar
        notePath={notePath}
        line={cursorState.line}
        col={cursorState.col}
        wordCount={cursorState.wordCount}
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
  const state = useAppState();
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
    graphHeight,
    graphData, graphLoading,
    setCursorState,
    starredPaths,
    sharedNotes,
    isActiveNoteStarred,
    editorViewRef, searchInputRef, previewRef,
  } = state;

  const setShowAdmin = useUIStore((s) => s.setShowAdmin);
  const setShowAccessRequests = useUIStore((s) => s.setShowAccessRequests);
  const setShowQuickSwitcher = useUIStore((s) => s.setShowQuickSwitcher);
  const setEditContent = useUIStore((s) => s.setEditContent);

  const {
    toggleStar,
    toggleActiveNoteStar,
    handleNoteSelect,
    handleLinkClick,
    handleCreateNoteFromLink,
    handleDailyNote,
    handleCreateFromTemplate,
    handleTemplateSelected,
    handleOutlineJump,
    handleNewNote,
    handleRenameNote,
    handlePdfExport,
    enterEditMode,
    saveEdit,
    cancelEdit,
    handleSidebarResize,
    handleRightPanelResize,
    handleGraphResize,
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
  }), [handleNewNote, handleRenameNote, toggleActiveNoteStar, editing, cancelEdit, enterEditMode, setSidebarOpen, setShowQuickSwitcher, searchInputRef]);

  useKeyboardShortcuts(shortcutActions);

  const { editorExtensions, getCodeFenceRenderer } = usePluginSlots();

  const onShareActiveNote = useCallback(() => {
    if (notes.activeNote) handleShare(notes.activeNote.path, false);
  }, [notes.activeNote, handleShare]);

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
      <Header
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        searchInputRef={searchInputRef}
        theme={themeCtx.theme}
        setTheme={themeCtx.setTheme}
        onNoteSelect={handleNoteSelect}
        onAdminClick={() => setShowAdmin(true)}
        onAccessRequestsClick={() => setShowAccessRequests(true)}
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
        >
          <PluginSlot slot="sidebar" />
        </SidebarLayout>

        <main className="flex-1 flex flex-col overflow-hidden">
          <PluginSlot slot="editor-toolbar" />
          <div className="flex-1 flex overflow-hidden">
            {notes.activeNote ? (
              editing ? (
                <EditModeView
                  activeNote={notes.activeNote}
                  editContent={editContent}
                  originalContent={originalContent}
                  isStarred={isActiveNoteStarred}
                  resolvedTheme={themeCtx.resolvedTheme}
                  allNotes={notes.tree}
                  editorViewRef={editorViewRef}
                  previewRef={previewRef}
                  pluginExtensions={editorExtensions}
                  getCodeFenceRenderer={getCodeFenceRenderer}
                  onSave={saveEdit}
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
                  getCodeFenceRenderer={getCodeFenceRenderer}
                />
              )
            ) : (
              <EmptyStateView />
            )}
          </div>
        </main>

        {!editing && (
          <RightPanel
            rightPanelWidth={rightPanelWidth}
            graphHeight={graphHeight}
            graphData={graphData}
            graphLoading={graphLoading}
            activeNotePath={notes.activeNote?.path ?? null}
            activeNoteContent={notes.activeNote?.content ?? null}
            starredPaths={starredPaths}
            onRightPanelResize={handleRightPanelResize}
            onGraphResize={handleGraphResize}
            onNoteSelect={handleNoteSelect}
            onOutlineJump={handleOutlineJump}
          />
        )}
      </div>

      <AppStatusBar notePath={notes.activeNote?.path ?? null} />

      {notes.error && (
        <ErrorToast message={notes.error} onDismiss={() => notes.setError(null)} />
      )}

      <AppModals
        noteTree={notes.tree}
        onTemplateSelected={handleTemplateSelected}
        onNoteSelect={handleNoteSelect}
      />
    </div>
  );
}
