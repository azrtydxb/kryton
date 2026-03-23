import { useEffect, useRef, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder, ViewUpdate } from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { search as cmSearch, searchKeymap } from '@codemirror/search';
import { vim, getCM } from '@replit/codemirror-vim';
import { FileNode } from '../../lib/api';

export interface EditorCursorState {
  line: number;
  col: number;
  vimMode: string;
  wordCount: number;
}

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  darkMode: boolean;
  allNotes: FileNode[];
  onCursorStateChange?: (state: EditorCursorState) => void;
  viewRef?: React.MutableRefObject<EditorView | undefined>;
}

function collectNotePaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      paths.push(node.path.replace(/\.md$/, ''));
    }
    if (node.children) {
      paths.push(...collectNotePaths(node.children));
    }
  }
  return paths;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function getVimMode(view: EditorView): string {
  const cm = getCM(view);
  if (!cm) return '-- NORMAL --';
  const vimState = cm.state.vim;
  if (!vimState) return '-- NORMAL --';
  if (vimState.insertMode) return '-- INSERT --';
  if (vimState.visualMode) {
    if (vimState.visualLine) return '-- VISUAL LINE --';
    if (vimState.visualBlock) return '-- VISUAL BLOCK --';
    return '-- VISUAL --';
  }
  return '-- NORMAL --';
}

export function Editor({ content, onChange, darkMode, allNotes, onCursorStateChange, viewRef: externalViewRef }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(undefined);
  const onChangeRef = useRef(onChange);
  const allNotesRef = useRef(allNotes);
  const onCursorStateChangeRef = useRef(onCursorStateChange);

  onChangeRef.current = onChange;
  allNotesRef.current = allNotes;
  onCursorStateChangeRef.current = onCursorStateChange;

  const wikiLinkCompletion = useCallback((context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(/\[\[([^\]]*)$/);
    if (!before) return null;

    const query = before.text.slice(2).toLowerCase();
    const paths = collectNotePaths(allNotesRef.current);

    const options = paths
      .filter(p => p.toLowerCase().includes(query))
      .map(p => ({
        label: p,
        apply: `${p}]]`,
        type: 'text' as const,
      }));

    return {
      from: before.from + 2,
      options,
      validFor: /^[^\]]*$/,
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const emitCursorState = (view: EditorView) => {
      if (!onCursorStateChangeRef.current) return;
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      onCursorStateChangeRef.current({
        line: line.number,
        col: pos - line.from + 1,
        vimMode: getVimMode(view),
        wordCount: countWords(view.state.doc.toString()),
      });
    };

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
      emitCursorState(update.view);
    });

    const themeExtensions = darkMode ? [oneDark] : [];

    const state = EditorState.create({
      doc: content,
      extensions: [
        vim(),
        ...themeExtensions,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        history(),
        cmSearch(),
        autocompletion({
          override: [wikiLinkCompletion],
          activateOnTyping: true,
        }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        placeholder('Start writing...'),
        updateListener,
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    if (externalViewRef) externalViewRef.current = view;

    // Start in insert mode so beginners can type immediately
    const cm = getCM(view) as { processKey?: (key: string) => void };
    if (cm?.processKey) {
      cm.processKey('i');
    }

    // Fire initial cursor state
    if (onCursorStateChangeRef.current) {
      onCursorStateChangeRef.current({
        line: 1,
        col: 1,
        vimMode: '-- INSERT --',
        wordCount: countWords(content),
      });
    }

    return () => {
      view.destroy();
    };
    // Only re-create editor when darkMode changes, not on every content change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [darkMode, wikiLinkCompletion]);

  // Sync content from parent when it changes externally (e.g., switching notes)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      });
    }
  }, [content]);

  return <div ref={containerRef} className="h-full w-full" />;
}
