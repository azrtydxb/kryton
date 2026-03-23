import { useState, useCallback } from 'react';
import { useTheme } from './hooks/useTheme';
import { useNotes } from './hooks/useNotes';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Editor } from './components/Editor/Editor';
import { Preview } from './components/Preview/Preview';
import { SearchBar } from './components/Search/SearchBar';
import { GraphView } from './components/Graph/GraphView';
import { ThemeToggle } from './components/Layout/ThemeToggle';
import { PanelLeft, BookOpen, Network, X, Menu } from 'lucide-react';

type ViewMode = 'editor' | 'preview' | 'split';

export default function App() {
  const themeCtx = useTheme();
  const notes = useNotes();
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [showGraph, setShowGraph] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNoteSelect = useCallback((path: string) => {
    notes.openNote(path);
    setMobileMenuOpen(false);
  }, [notes]);

  const handleLinkClick = useCallback((noteName: string) => {
    // Find the note by matching end of path
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

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-surface-950">
      {/* Header */}
      <header className="h-13 flex-shrink-0 flex items-center justify-between px-3 border-b bg-gray-50/80 dark:bg-surface-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-1">
          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="btn-ghost p-2 md:hidden"
            aria-label="Toggle menu"
          >
            <Menu size={18} />
          </button>
          {/* Desktop sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="btn-ghost p-2 hidden md:flex"
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={18} />
          </button>
          <div className="flex items-center gap-2 ml-1">
            <div className="w-6 h-6 rounded bg-blue-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs">M</span>
            </div>
            <span className="font-semibold text-sm hidden sm:inline">Mnemo</span>
          </div>
        </div>

        <div className="flex-1 max-w-md mx-4">
          <SearchBar onSelect={handleNoteSelect} />
        </div>

        <div className="flex items-center gap-0.5">
          {/* View mode toggles */}
          <div className="hidden sm:flex items-center border rounded-md overflow-hidden mr-2">
            {(['editor', 'split', 'preview'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  viewMode === mode
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowGraph(true)}
            className="btn-ghost p-2"
            aria-label="Graph view"
            title="Graph view"
          >
            <Network size={18} />
          </button>
          <ThemeToggle theme={themeCtx.theme} setTheme={themeCtx.setTheme} />
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

        {/* Sidebar */}
        <aside
          className={`
            ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
            md:translate-x-0
            ${sidebarOpen ? 'md:w-64' : 'md:w-0 md:overflow-hidden'}
            fixed md:relative inset-y-0 left-0 z-40 md:z-0
            w-72 flex-shrink-0 transition-all duration-200 ease-in-out
            bg-gray-50 dark:bg-surface-900 border-r
          `}
        >
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
          />
        </aside>

        {/* Editor + Preview */}
        <main className="flex-1 flex overflow-hidden">
          {notes.activeNote ? (
            <>
              {(viewMode === 'editor' || viewMode === 'split') && (
                <div className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'} flex flex-col overflow-hidden border-r`}>
                  <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50/50 dark:bg-surface-900/50">
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">
                      {notes.activeNote.path}
                    </span>
                    <div className="flex items-center gap-2">
                      {notes.saving && (
                        <span className="text-xs text-gray-400">Saving...</span>
                      )}
                      {!notes.saving && (
                        <span className="text-xs text-green-500">Saved</span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <Editor
                      content={notes.activeNote.content}
                      onChange={notes.updateContent}
                      darkMode={themeCtx.resolvedTheme === 'dark'}
                      allNotes={notes.tree}
                    />
                  </div>
                </div>
              )}
              {(viewMode === 'preview' || viewMode === 'split') && (
                <div className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'} flex flex-col overflow-hidden`}>
                  <div className="flex items-center px-4 py-2 border-b bg-gray-50/50 dark:bg-surface-900/50">
                    <BookOpen size={14} className="text-gray-400 mr-2" />
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Preview</span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <Preview
                      content={notes.activeNote.content}
                      onLinkClick={handleLinkClick}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center p-8">
                <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                  <BookOpen size={28} className="text-blue-500" />
                </div>
                <h2 className="text-lg font-semibold mb-1">No note selected</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Select a note from the sidebar or create a new one
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Error toast */}
      {notes.error && (
        <div className="fixed bottom-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom">
          <span className="text-sm">{notes.error}</span>
          <button onClick={() => notes.setError(null)} className="hover:bg-red-600 rounded p-0.5">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Graph modal */}
      {showGraph && (
        <GraphView onClose={() => setShowGraph(false)} onNoteSelect={handleNoteSelect} />
      )}
    </div>
  );
}
