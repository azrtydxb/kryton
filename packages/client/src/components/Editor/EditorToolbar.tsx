import { useCallback } from 'react';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import {
  Bold, Italic, Strikethrough, Code, Link, Image,
  Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare,
  Quote, Minus, Table,
  Undo2, Redo2,
} from 'lucide-react';

interface EditorToolbarProps {
  viewRef: React.MutableRefObject<EditorView | undefined>;
  vimEnabled: boolean;
  onVimToggle: (enabled: boolean) => void;
}

function ToolbarButton({ icon: Icon, title, onClick }: { icon: React.ComponentType<{ size?: number }>; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors"
      title={title}
    >
      <Icon size={15} />
    </button>
  );
}

function ToolbarSep() {
  return <div className="w-px h-4 bg-gray-700/50 mx-0.5" />;
}

export function EditorToolbar({ viewRef, vimEnabled, onVimToggle }: EditorToolbarProps) {
  const wrapSelection = useCallback((before: string, after: string) => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    view.dispatch({
      changes: { from, to, insert: `${before}${selected || 'text'}${after}` },
      selection: { anchor: from + before.length, head: from + before.length + (selected.length || 4) },
    });
    view.focus();
  }, [viewRef]);

  const insertAtLineStart = useCallback((prefix: string) => {
    const view = viewRef.current;
    if (!view) return;
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: prefix },
    });
    view.focus();
  }, [viewRef]);

  const insertText = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view) return;
    const { from } = view.state.selection.main;
    view.dispatch({
      changes: { from, to: from, insert: text },
      selection: { anchor: from + text.length },
    });
    view.focus();
  }, [viewRef]);

  const insertLink = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    if (selected) {
      view.dispatch({
        changes: { from, to, insert: `[${selected}](url)` },
        selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
      });
    } else {
      view.dispatch({
        changes: { from, to: from, insert: '[[' },
        selection: { anchor: from + 2 },
      });
    }
    view.focus();
  }, [viewRef]);

  const insertImage = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { from } = view.state.selection.main;
    view.dispatch({
      changes: { from, to: from, insert: '![alt](url)' },
      selection: { anchor: from + 2, head: from + 5 },
    });
    view.focus();
  }, [viewRef]);

  const insertTable = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { from } = view.state.selection.main;
    const table = '\n| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |\n';
    view.dispatch({
      changes: { from, to: from, insert: table },
      selection: { anchor: from + 3, head: from + 9 },
    });
    view.focus();
  }, [viewRef]);

  const handleUndo = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    undo(view);
    view.focus();
  }, [viewRef]);

  const handleRedo = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    redo(view);
    view.focus();
  }, [viewRef]);

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-gray-700/50 bg-surface-900/80 flex-shrink-0 flex-wrap">
      <ToolbarButton icon={Undo2} title="Undo (Ctrl+Z)" onClick={handleUndo} />
      <ToolbarButton icon={Redo2} title="Redo (Ctrl+Shift+Z)" onClick={handleRedo} />
      <ToolbarSep />
      <ToolbarButton icon={Heading1} title="Heading 1" onClick={() => insertAtLineStart('# ')} />
      <ToolbarButton icon={Heading2} title="Heading 2" onClick={() => insertAtLineStart('## ')} />
      <ToolbarButton icon={Heading3} title="Heading 3" onClick={() => insertAtLineStart('### ')} />
      <ToolbarSep />
      <ToolbarButton icon={Bold} title="Bold (Ctrl+B)" onClick={() => wrapSelection('**', '**')} />
      <ToolbarButton icon={Italic} title="Italic (Ctrl+I)" onClick={() => wrapSelection('*', '*')} />
      <ToolbarButton icon={Strikethrough} title="Strikethrough" onClick={() => wrapSelection('~~', '~~')} />
      <ToolbarButton icon={Code} title="Inline code" onClick={() => wrapSelection('`', '`')} />
      <ToolbarSep />
      <ToolbarButton icon={Link} title="Wiki link" onClick={insertLink} />
      <ToolbarButton icon={Image} title="Image" onClick={insertImage} />
      <ToolbarSep />
      <ToolbarButton icon={List} title="Bullet list" onClick={() => insertAtLineStart('- ')} />
      <ToolbarButton icon={ListOrdered} title="Numbered list" onClick={() => insertAtLineStart('1. ')} />
      <ToolbarButton icon={CheckSquare} title="Checkbox" onClick={() => insertAtLineStart('- [ ] ')} />
      <ToolbarSep />
      <ToolbarButton icon={Quote} title="Blockquote" onClick={() => insertAtLineStart('> ')} />
      <ToolbarButton icon={Minus} title="Horizontal rule" onClick={() => insertText('\n---\n')} />
      <ToolbarButton icon={Table} title="Table" onClick={insertTable} />
      <div className="flex-1" />
      <button
        onClick={() => onVimToggle(!vimEnabled)}
        className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
          vimEnabled
            ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
            : 'bg-gray-700/30 text-gray-500 hover:bg-gray-700/50'
        }`}
        title={vimEnabled ? 'Vim mode enabled — click to disable' : 'Vim mode disabled — click to enable'}
      >
        VIM
      </button>
    </div>
  );
}
