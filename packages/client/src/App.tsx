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

  const {
    user, loading,
    themeCtx,
    notes,
    editing,
    editContent, setEditContent,
    originalContent,
    vimEnabled,
    showAdmin, setShowAdmin,
    sidebarOpen, setSidebarOpen,
    mobileMenuOpen, setMobileMenuOpen,
    showTemplatePicker, setShowTemplatePicker,
    showQuickSwitcher, setShowQuickSwitcher,
    showShareDialog, setShowShareDialog,
    showAccessRequests, setShowAccessRequests,
    shareTarget,
    sidebarWidth,
    rightPanelWidth,
    graphHeight,
    graphData, graphLoading,
    cursorState, setCursorState,
    starredPaths,
    sharedNotes,
    isActiveNoteStarred,
    editorViewRef, searchInputRef, previewRef,
  } = state;

  const {
    toggleStar,
    handleVimToggle,
    toggleActiveNoteStar,
    handleNoteSelect,
    handleLinkClick,
    handleCreateNoteFromLink,
    handleDailyNote,
    handleCreateFromTemplate,
    handleTemplateSelected,
    handleOutlineJump,
    handlePdfExport,
    enterEditMode,
    saveEdit,
    cancelEdit,
    handleSidebarResize,
    handleRightPanelResize,
    handleGraphResize,
    handleShare,
  } = callbacks;

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
        />

        <main className="flex-1 flex overflow-hidden">
          {notes.activeNote ? (
            editing ? (
              <EditModeView
                activeNote={notes.activeNote}
                editContent={editContent}
                originalContent={originalContent}
                vimEnabled={vimEnabled}
                isStarred={isActiveNoteStarred}
                resolvedTheme={themeCtx.resolvedTheme}
                allNotes={notes.tree}
                editorViewRef={editorViewRef}
                previewRef={previewRef}
                onSave={saveEdit}
                onCancel={cancelEdit}
                onToggleStar={toggleActiveNoteStar}
                onPdfExport={handlePdfExport}
                onVimToggle={handleVimToggle}
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
                onShare={() => handleShare(notes.activeNote!.path, false)}
                onToggleStar={toggleActiveNoteStar}
                onPdfExport={handlePdfExport}
                onNoteSelect={handleNoteSelect}
                onLinkClick={handleLinkClick}
                onCreateNote={handleCreateNoteFromLink}
              />
            )
          ) : (
            <EmptyStateView />
          )}
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

      <StatusBar
        notePath={notes.activeNote?.path ?? null}
        vimMode={cursorState.vimMode}
        line={cursorState.line}
        col={cursorState.col}
        wordCount={cursorState.wordCount}
      />

      {notes.error && (
        <ErrorToast message={notes.error} onDismiss={() => notes.setError(null)} />
      )}

      <ModalsContainer
        showTemplatePicker={showTemplatePicker}
        showQuickSwitcher={showQuickSwitcher}
        showAdmin={showAdmin}
        showShareDialog={showShareDialog}
        showAccessRequests={showAccessRequests}
        shareTarget={shareTarget}
        noteTree={notes.tree}
        onTemplateSelected={handleTemplateSelected}
        onCloseTemplatePicker={() => setShowTemplatePicker(false)}
        onNoteSelect={handleNoteSelect}
        onCloseQuickSwitcher={() => setShowQuickSwitcher(false)}
        onCloseAdmin={() => setShowAdmin(false)}
        onCloseShareDialog={() => setShowShareDialog(false)}
        onCloseAccessRequests={() => setShowAccessRequests(false)}
      />
    </div>
  );
}
