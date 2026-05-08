import { useCallback, type RefObject } from 'react';
import { EditorToolbar as UiEditorToolbar } from '@azrtydxb/ui';
import { api } from '../../lib/api';
import type { EditorHandle } from './Editor';

interface EditorToolbarProps {
  editorRef: RefObject<EditorHandle | null>;
}

/**
 * Thin adapter over @azrtydxb/ui EditorToolbar.
 * Maps the ui's string command tokens to imperative EditorHandle calls.
 * Undo/redo are handled natively by the new EditorView via Cmd-Z / Cmd-Shift-Z.
 */
export function EditorToolbar({ editorRef }: EditorToolbarProps) {
  const wrapSelection = (before: string, after: string) => {
    editorRef.current?.wrapSelection(before, after);
  };

  const insertAtLineStart = (prefix: string) => {
    editorRef.current?.insertAtLineStart(prefix);
  };

  const insertText = (text: string) => {
    editorRef.current?.insertText(text);
  };

  const handleCommand = useCallback((command: string) => {
    switch (command) {
      // undo/redo are handled by EditorView's built-in Cmd-Z / Cmd-Shift-Z;
      // no imperative call needed — the keyboard shortcut fires natively.
      case 'undo':
      case 'redo':
        editorRef.current?.focus();
        break;
      case 'bold':          wrapSelection('**', '**'); break;
      case 'italic':        wrapSelection('*', '*'); break;
      case 'strikethrough': wrapSelection('~~', '~~'); break;
      case 'code':          wrapSelection('`', '`'); break;
      case 'heading1':      insertAtLineStart('# '); break;
      case 'heading2':      insertAtLineStart('## '); break;
      case 'heading3':      insertAtLineStart('### '); break;
      case 'ul':            insertAtLineStart('- '); break;
      case 'ol':            insertAtLineStart('1. '); break;
      case 'checkbox':      insertAtLineStart('- [ ] '); break;
      case 'blockquote':    insertAtLineStart('> '); break;
      case 'hr':            insertText('\n---\n'); break;
      case 'table':
        insertText('\n| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |\n');
        break;
      case 'link':
        insertText('[[');
        break;
      case 'image':
        insertText('![alt](url)');
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorRef]);

  const handleUploadImage = useCallback(async (file: File) => {
    try {
      const result = await api.uploadFile(file);
      const markdown = `![image](${result.path})`;
      editorRef.current?.insertText(markdown);
    } catch (err) {
      console.error('Image upload failed:', err);
    }
  }, [editorRef]);

  return (
    <UiEditorToolbar
      onCommand={handleCommand}
      onUploadImage={handleUploadImage}
    />
  );
}
