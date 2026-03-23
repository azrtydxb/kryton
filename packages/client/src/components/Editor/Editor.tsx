import { useEffect, useRef, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder, ViewUpdate } from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { search as cmSearch, searchKeymap } from '@codemirror/search';
import { FileNode } from '../../lib/api';

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  darkMode: boolean;
  allNotes: FileNode[];
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

export function Editor({ content, onChange, darkMode, allNotes }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>();
  const onChangeRef = useRef(onChange);
  const allNotesRef = useRef(allNotes);

  onChangeRef.current = onChange;
  allNotesRef.current = allNotes;

  const wikiLinkCompletion = useCallback((context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(/\[\[([^\]]*)$/);
    if (!before) return null;

    const query = before.text.slice(2).toLowerCase();
    const paths = collectNotePaths(allNotesRef.current);

    const options = paths
      .filter(p => p.toLowerCase().includes(query))
      .map(p => {
        const label = p.includes('/') ? p : p;
        return {
          label,
          apply: `${p}]]`,
          type: 'text' as const,
        };
      });

    return {
      from: before.from + 2,
      options,
      validFor: /^[^\]]*$/,
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const themeExtensions = darkMode ? [oneDark] : [];

    const state = EditorState.create({
      doc: content,
      extensions: [
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
