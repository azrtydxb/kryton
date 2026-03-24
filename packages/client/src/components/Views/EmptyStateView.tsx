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
