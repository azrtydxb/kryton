import * as React from "react";
import { useEffect, useRef, useCallback } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  placeholder,
  type ViewUpdate,
} from "@codemirror/view";
import {
  defaultKeymap,
  indentWithTab,
  history,
  historyKeymap,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching } from "@codemirror/language";
import { krytonCmTheme } from "./krytonCmTheme";
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { search as cmSearch, searchKeymap } from "@codemirror/search";

export interface EditorCursorState {
  line: number;
  col: number;
  wordCount: number;
}

/** Flat list of note path strings used for [[wiki-link]] autocomplete. */
export type NotePath = string;

export interface NoteEditorReactProps {
  /** Current note content (controlled externally; changes are emitted via `onChange`). */
  content: string;
  /** Called on every doc change with the full new content. */
  onChange: (content: string) => void;
  /** When true, applies the oneDark theme. */
  darkMode?: boolean;
  /** Flat list of note paths for [[wiki-link]] autocomplete. */
  notePaths?: NotePath[];
  /** Called when the cursor moves or word count changes. */
  onCursorStateChange?: (state: EditorCursorState) => void;
  /** Exposes the underlying EditorView instance for toolbar use. */
  viewRef?: React.MutableRefObject<EditorView | undefined>;
  /** Additional CodeMirror extensions (e.g. from plugins). */
  pluginExtensions?: Extension[];
  className?: string;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * NoteEditorReact — CodeMirror Markdown editor rendered directly in React.
 *
 * This is the "React" variant, parallel to the iframe-based `NoteEditor`.
 * The web client uses this; Electron/Tauri builds may use `NoteEditor` instead.
 *
 * The editor instance is reconstructed only when `darkMode` or
 * `pluginExtensions` change; content changes are applied as incremental updates.
 */
export function NoteEditorReact({
  content,
  onChange,
  darkMode = false,
  notePaths = [],
  onCursorStateChange,
  viewRef: externalViewRef,
  pluginExtensions = [],
  className,
}: NoteEditorReactProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const notePathsRef = useRef(notePaths);
  const onCursorRef = useRef(onCursorStateChange);

  onChangeRef.current = onChange;
  notePathsRef.current = notePaths;
  onCursorRef.current = onCursorStateChange;

  const wikiLinkCompletion = useCallback(
    (context: CompletionContext): CompletionResult | null => {
      const before = context.matchBefore(/\[\[([^\]]*)/);
      if (!before) return null;

      const query = before.text.slice(2).toLowerCase();
      const options = notePathsRef.current
        .filter((p) => p.toLowerCase().includes(query))
        .map((p) => ({
          label: p,
          apply: `${p}]]`,
          type: "text" as const,
        }));

      return { from: before.from + 2, options, validFor: /^[^\]]*$/ };
    },
    [],
  );

  // Create/recreate the editor when darkMode or pluginExtensions change.
  useEffect(() => {
    if (!containerRef.current) return;

    const emitCursorState = (view: EditorView) => {
      if (!onCursorRef.current) return;
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      onCursorRef.current({
        line: line.number,
        col: pos - line.from + 1,
        wordCount: countWords(view.state.doc.toString()),
      });
    };

    const updateListener = EditorView.updateListener.of(
      (update: ViewUpdate) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
        emitCursorState(update.view);
      },
    );

    const state = EditorState.create({
      doc: content,
      extensions: [
        ...pluginExtensions,
        // Kryton design-token theme — see krytonCmTheme.ts. Light/dark
        // is driven by data-theme on <html>, so a single theme works
        // for both modes (the `darkMode` prop is now informational only).
        ...krytonCmTheme,
        lineNumbers(),
        markdown({ base: markdownLanguage }),
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
        placeholder("Start writing…"),
        updateListener,
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    if (externalViewRef) externalViewRef.current = view;

    if (onCursorRef.current) {
      onCursorRef.current({
        line: 1,
        col: 1,
        wordCount: countWords(content),
      });
    }

    return () => {
      view.destroy();
    };
    // Only recreate on dark-mode or plugin-extensions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [darkMode, wikiLinkCompletion, pluginExtensions]);

  // Sync content from parent when switched externally (e.g. different note).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
      });
    }
  }, [content]);

  return <div ref={containerRef} className={className ?? "h-full w-full"} />;
}
