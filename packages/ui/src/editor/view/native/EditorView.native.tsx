// packages/ui/src/editor/view/native/EditorView.native.tsx
import * as React from "react";
import { requireNativeComponent, UIManager, findNodeHandle } from "react-native";
import {
  applyTransaction, createEditorState, createHistory, emitDecorations,
  collectDecorations, transactionFromOps,
  type EditorPlugin, type EditorState,
} from "../../state";
import { NATIVE_EDITOR_NAME, type NativeEditorProps } from "./bridge";

const NativeKrytonEditor = requireNativeComponent<NativeEditorProps>(NATIVE_EDITOR_NAME);

export interface EditorViewProps {
  initialDoc?: string;
  plugins?: readonly EditorPlugin[];
  onChange?: (state: EditorState) => void;
  onWikilinkPress?: (target: string) => void;
  style?: object;
}

export function EditorView({ initialDoc = "", plugins = [], onChange, onWikilinkPress, style }: EditorViewProps) {
  const ref = React.useRef<unknown>(null);
  const stateRef = React.useRef<EditorState>(createEditorState(initialDoc));
  const historyRef = React.useRef(createHistory());
  const [, forceRender] = React.useReducer((n) => n + 1, 0);

  const setState = React.useCallback((next: EditorState) => {
    stateRef.current = next;
    onChange?.(next);
    forceRender();
  }, [onChange]);

  const onChangeText = (e: { nativeEvent: { text: string; changedFrom: number; changedTo: number; insertedText: string } }) => {
    const { changedFrom, changedTo, insertedText } = e.nativeEvent;
    const tr = {
      ops: [{ kind: "replace" as const, from: changedFrom, to: changedTo, text: insertedText }],
      selection: { anchor: changedFrom + insertedText.length, head: changedFrom + insertedText.length },
    };
    historyRef.current.record(stateRef.current, tr);
    setState(applyTransaction(stateRef.current, transactionFromOps(tr.ops, tr.selection)));
  };

  const onChangeSelection = (e: { nativeEvent: { anchor: number; head: number } }) => {
    const { anchor, head } = e.nativeEvent;
    if (anchor !== stateRef.current.selection.anchor || head !== stateRef.current.selection.head) {
      stateRef.current = { ...stateRef.current, selection: { anchor, head } };
      onChange?.(stateRef.current);
    }
  };

  const decorations = [
    ...emitDecorations(stateRef.current.doc, stateRef.current.tree),
    ...collectDecorations(plugins, stateRef.current),
  ];

  return (
    <NativeKrytonEditor
      ref={ref as never}
      text={stateRef.current.doc}
      selection={stateRef.current.selection}
      decorations={decorations}
      onChangeText={onChangeText}
      onChangeSelection={onChangeSelection}
      onWikilinkPress={onWikilinkPress ? (e) => onWikilinkPress(e.nativeEvent.target) : undefined}
      style={style}
    />
  );
}

void UIManager; void findNodeHandle; // referenced for future imperative commands
