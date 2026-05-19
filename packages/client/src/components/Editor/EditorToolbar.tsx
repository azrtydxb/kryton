import { useCallback, type RefObject } from 'react';
import { EditorToolbar as UiEditorToolbar } from '@azrtydxb/ui';
import { api } from '../../lib/api';
import type { EditorHandle } from './Editor';
import { PluginSlot } from '../PluginSlot/PluginSlot';

interface EditorToolbarProps {
  editorRef: RefObject<EditorHandle | null>;
}

/**
 * Thin adapter over @azrtydxb/ui EditorToolbar.
 * Maps the ui's string command tokens to imperative EditorHandle calls.
 * Undo/redo are handled natively by the new EditorView via Cmd-Z / Cmd-Shift-Z.
 */
export function EditorToolbar({ editorRef }: EditorToolbarProps) {
  // Helpers defined inside useCallback so the lint rule's dependency check
  // resolves cleanly via the single editorRef closure — no eslint-disable
  // hack and no stale-closure traps.
  const handleCommand = useCallback((command: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const wrap = (b: string, a: string) => editor.wrapSelection(b, a);
    const prefix = (p: string) => editor.insertAtLineStart(p);
    const insert = (t: string) => editor.insertText(t);
    switch (command) {
      // undo/redo are handled by EditorView's built-in Cmd-Z / Cmd-Shift-Z;
      // no imperative call needed — the keyboard shortcut fires natively.
      case 'undo':
      case 'redo':
        editor.focus();
        break;
      case 'bold':          wrap('**', '**'); break;
      case 'italic':        wrap('*', '*'); break;
      case 'strikethrough': wrap('~~', '~~'); break;
      case 'code':          wrap('`', '`'); break;
      case 'heading1':      prefix('# '); break;
      case 'heading2':      prefix('## '); break;
      case 'heading3':      prefix('### '); break;
      case 'ul':            prefix('- '); break;
      case 'ol':            prefix('1. '); break;
      case 'checkbox':      prefix('- [ ] '); break;
      case 'blockquote':    prefix('> '); break;
      case 'hr':            insert('\n---\n'); break;
      case 'table':
        insert('\n| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |\n');
        break;
      case 'link':          insert('[['); break;
      case 'image':         insert('![alt](url)'); break;
    }
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
      pluginButtons={<PluginSlot slot="editor-toolbar" />}
    />
  );
}
