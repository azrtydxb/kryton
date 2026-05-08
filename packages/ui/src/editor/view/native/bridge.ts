// packages/ui/src/editor/view/native/bridge.ts
import type { DecorationSpec, Selection } from "../../state/types";

export interface NativeEditorProps {
  /** Source of truth — full text. */
  text: string;
  /** Selection in document offsets. */
  selection: Selection;
  /** Flat decoration runs to paint. */
  decorations: readonly DecorationSpec[];
  /** Fired when the user edits the text. JS reconciles into Operation[] then applyTransaction. */
  onChangeText: (e: { nativeEvent: { text: string; changedFrom: number; changedTo: number; insertedText: string } }) => void;
  /** Fired when the user moves the caret/selection. */
  onChangeSelection: (e: { nativeEvent: { anchor: number; head: number } }) => void;
  /** Fired on tap of a wikilink-decorated range. */
  onWikilinkPress?: (e: { nativeEvent: { target: string } }) => void;
  style?: object;
}

/** The native module name; matches `KrytonEditor.swift` and Kotlin counterpart. */
export const NATIVE_EDITOR_NAME = "KrytonEditor";
