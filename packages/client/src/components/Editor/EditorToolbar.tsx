import { useCallback, type MutableRefObject } from 'react';
import { EditorToolbar as UiEditorToolbar } from '@azrtydxb/ui';
import type { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { api } from '../../lib/api';

interface EditorToolbarProps {
  viewRef: MutableRefObject<EditorView | undefined>;
}

/**
 * Thin adapter over @azrtydxb/ui EditorToolbar.
 * Maps the ui's string command tokens to CodeMirror dispatch calls and
 * handles image upload via client's HTTP API.
 */
export function EditorToolbar({ viewRef }: EditorToolbarProps) {
  const wrapSelection = (before: string, after: string) => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    view.dispatch({
      changes: { from, to, insert: `${before}${selected || 'text'}${after}` },
      selection: { anchor: from + before.length, head: from + before.length + (selected.length || 4) },
    });
    view.focus();
  };

  const insertAtLineStart = (prefix: string) => {
    const view = viewRef.current;
    if (!view) return;
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    view.dispatch({ changes: { from: line.from, to: line.from, insert: prefix } });
    view.focus();
  };

  const insertText = (text: string) => {
    const view = viewRef.current;
    if (!view) return;
    const { from } = view.state.selection.main;
    view.dispatch({ changes: { from, to: from, insert: text }, selection: { anchor: from + text.length } });
    view.focus();
  };

  const handleCommand = useCallback((command: string) => {
    const view = viewRef.current;
    switch (command) {
      case 'undo':
        if (view) { undo(view); view.focus(); }
        break;
      case 'redo':
        if (view) { redo(view); view.focus(); }
        break;
      case 'bold':         wrapSelection('**', '**'); break;
      case 'italic':       wrapSelection('*', '*'); break;
      case 'strikethrough': wrapSelection('~~', '~~'); break;
      case 'code':         wrapSelection('`', '`'); break;
      case 'heading1':     insertAtLineStart('# '); break;
      case 'heading2':     insertAtLineStart('## '); break;
      case 'heading3':     insertAtLineStart('### '); break;
      case 'ul':           insertAtLineStart('- '); break;
      case 'ol':           insertAtLineStart('1. '); break;
      case 'checkbox':     insertAtLineStart('- [ ] '); break;
      case 'blockquote':   insertAtLineStart('> '); break;
      case 'hr':           insertText('\n---\n'); break;
      case 'table':
        insertText('\n| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |\n');
        break;
      case 'link': {
        if (!view) break;
        const { from, to } = view.state.selection.main;
        const selected = view.state.sliceDoc(from, to);
        if (selected) {
          view.dispatch({
            changes: { from, to, insert: `[${selected}](url)` },
            selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
          });
        } else {
          view.dispatch({ changes: { from, to: from, insert: '[[' }, selection: { anchor: from + 2 } });
        }
        view.focus();
        break;
      }
      case 'image':
        insertText('![alt](url)');
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRef]);

  const handleUploadImage = useCallback(async (file: File) => {
    try {
      const result = await api.uploadFile(file);
      const view = viewRef.current;
      if (!view) return;
      const { from } = view.state.selection.main;
      const markdown = `![image](${result.path})`;
      view.dispatch({ changes: { from, to: from, insert: markdown }, selection: { anchor: from + markdown.length } });
      view.focus();
    } catch (err) {
      console.error('Image upload failed:', err);
    }
  }, [viewRef]);

  return (
    <UiEditorToolbar
      onCommand={handleCommand}
      onUploadImage={handleUploadImage}
    />
  );
}
