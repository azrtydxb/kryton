# Editor Native iOS View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`).

**Goal:** Build the iOS editor surface as a React Native native module — a Swift `UITextView` subclass driven by the in-house `EditorState`, with `NSAttributedString` mapped from `DecorationSpec[]`. No WebView. Full native IME, autocorrect, voice input, suggestion strip, dictation, accessibility.

**Architecture:** A Swift class `KrytonEditor: UITextView` exposes a `setDecorationSpec(_:)` method called from JS. JS sends `(text, decorations[], selection)` whenever `EditorState` changes; the native side rebuilds an `NSAttributedString` from the runs and replaces the view's `attributedText`, preserving the selection. Local edits emit `onChange` events with text deltas that JS converts to `Operation`s and applies via `applyTransaction`.

**Tech Stack:** Swift, RCTViewManager, React Native bridge. Depends on `editor-state-core`.

**Spec:** [`docs/superpowers/specs/2026-05-08-editor-cross-platform.md`](../specs/2026-05-08-editor-cross-platform.md)

**Depends on:** [`2026-05-08-editor-state-core.md`](./2026-05-08-editor-state-core.md)

---

## File ownership

- `packages/ui/src/editor/view/native/EditorView.native.tsx` (new — RN React component)
- `packages/ui/src/editor/view/native/bridge.ts` (new — TS-side bridge types)
- `packages/ui/src/editor/view/native/ios/KrytonEditor.swift` (new)
- `packages/ui/src/editor/view/native/ios/KrytonEditorManager.swift` (new — RCTViewManager)
- `packages/ui/src/editor/view/native/ios/KrytonEditor.podspec` (new)
- `packages/ui/src/editor/view/native/ios/AttributedStringMapper.swift` (new)
- `packages/ui/src/editor/view/native/ios/__tests__/AttributedStringMapperTests.swift` (new)

Not touched: `editor/state/**`, `editor/view/web/**`, `editor/view/native/android/**`.

---

## Task EI-1: TS-side bridge types

**Files:**
- Create: `packages/ui/src/editor/view/native/bridge.ts`

- [ ] **Step 1: Write the bridge types**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/editor/view/native/bridge.ts
git commit -m "feat(editor/view/native): TS bridge types"
```

---

## Task EI-2: AttributedStringMapper.swift

**Files:**
- Create: `packages/ui/src/editor/view/native/ios/AttributedStringMapper.swift`

- [ ] **Step 1: Write the mapper**

```swift
// packages/ui/src/editor/view/native/ios/AttributedStringMapper.swift
import UIKit

public struct DecorationSpec {
    public let from: Int
    public let to: Int
    public let kind: String
    public let attrs: [String: String]?
}

public enum AttributedStringMapper {
    public static func attributedString(text: String, decorations: [DecorationSpec], baseFontSize: CGFloat = 16) -> NSAttributedString {
        let mut = NSMutableAttributedString(string: text, attributes: [
            .font: UIFont.systemFont(ofSize: baseFontSize),
            .foregroundColor: UIColor.label,
        ])
        let nsText = text as NSString
        for d in decorations {
            let from = clamp(d.from, 0, nsText.length)
            let to = clamp(d.to, from, nsText.length)
            let range = NSRange(location: from, length: to - from)
            if range.length == 0 { continue }
            apply(kind: d.kind, attrs: d.attrs, range: range, on: mut, baseFontSize: baseFontSize)
        }
        return mut
    }

    private static func apply(kind: String, attrs: [String: String]?, range: NSRange, on s: NSMutableAttributedString, baseFontSize: CGFloat) {
        switch kind {
        case "bold":
            s.addAttribute(.font, value: UIFont.boldSystemFont(ofSize: baseFontSize), range: range)
        case "italic":
            s.addAttribute(.font, value: UIFont.italicSystemFont(ofSize: baseFontSize), range: range)
        case "strikethrough":
            s.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: range)
        case "code-inline", "code-block":
            s.addAttribute(.font, value: UIFont.monospacedSystemFont(ofSize: baseFontSize - 1, weight: .regular), range: range)
            s.addAttribute(.backgroundColor, value: UIColor.secondarySystemBackground, range: range)
        case "heading-1":
            s.addAttribute(.font, value: UIFont.boldSystemFont(ofSize: baseFontSize + 12), range: range)
        case "heading-2":
            s.addAttribute(.font, value: UIFont.boldSystemFont(ofSize: baseFontSize + 8), range: range)
        case "heading-3":
            s.addAttribute(.font, value: UIFont.boldSystemFont(ofSize: baseFontSize + 4), range: range)
        case "link":
            s.addAttribute(.foregroundColor, value: UIColor.systemBlue, range: range)
            s.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range)
        case "wikilink":
            s.addAttribute(.foregroundColor, value: UIColor.systemPurple, range: range)
            s.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range)
            if let target = attrs?["target"] {
                s.addAttribute(.init("krytonWikilinkTarget"), value: target, range: range)
            }
        case "tag":
            s.addAttribute(.foregroundColor, value: UIColor.systemTeal, range: range)
        case "blockquote":
            s.addAttribute(.foregroundColor, value: UIColor.secondaryLabel, range: range)
        default:
            break
        }
    }

    private static func clamp(_ v: Int, _ lo: Int, _ hi: Int) -> Int {
        return max(lo, min(hi, v))
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/editor/view/native/ios/AttributedStringMapper.swift
git commit -m "feat(editor/view/ios): DecorationSpec → NSAttributedString mapper"
```

---

## Task EI-3: AttributedStringMapper tests (XCTest)

**Files:**
- Create: `packages/ui/src/editor/view/native/ios/__tests__/AttributedStringMapperTests.swift`

- [ ] **Step 1: Write the tests**

```swift
// packages/ui/src/editor/view/native/ios/__tests__/AttributedStringMapperTests.swift
import XCTest
@testable import KrytonEditor

final class AttributedStringMapperTests: XCTestCase {
    func testBoldAttributeAppliedOnRange() {
        let result = AttributedStringMapper.attributedString(
            text: "hello world",
            decorations: [DecorationSpec(from: 6, to: 11, kind: "bold", attrs: nil)],
        )
        var effective = NSRange(location: 0, length: 0)
        let font = result.attribute(.font, at: 6, effectiveRange: &effective) as? UIFont
        XCTAssertTrue(font?.fontDescriptor.symbolicTraits.contains(.traitBold) ?? false)
    }

    func testWikilinkCarriesTargetAttribute() {
        let text = "see [[Other]]!"
        let result = AttributedStringMapper.attributedString(
            text: text,
            decorations: [DecorationSpec(from: 4, to: 13, kind: "wikilink", attrs: ["target": "Other"])],
        )
        let target = result.attribute(.init("krytonWikilinkTarget"), at: 5, effectiveRange: nil) as? String
        XCTAssertEqual(target, "Other")
    }

    func testOutOfRangeDecorationIsClamped() {
        let result = AttributedStringMapper.attributedString(
            text: "hi",
            decorations: [DecorationSpec(from: 0, to: 999, kind: "bold", attrs: nil)],
        )
        XCTAssertEqual(result.length, 2)
    }
}
```

- [ ] **Step 2: Add the iOS test target wiring**

> **Note:** an iOS test target / xcworkspace must exist in the `kryton-mobile` (or `packages/ui/ios`) project to run XCTest. The test target setup is part of the `kryton-mobile` scaffold plan; this task delivers the test source — the runner is wired up there.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/editor/view/native/ios/__tests__/AttributedStringMapperTests.swift
git commit -m "test(editor/view/ios): XCTest for AttributedStringMapper"
```

---

## Task EI-4: KrytonEditor.swift — UITextView subclass

**Files:**
- Create: `packages/ui/src/editor/view/native/ios/KrytonEditor.swift`

- [ ] **Step 1: Write the subclass**

```swift
// packages/ui/src/editor/view/native/ios/KrytonEditor.swift
import UIKit
import React

@objc(KrytonEditor)
public final class KrytonEditor: UITextView, UITextViewDelegate {
    @objc public var onChangeText: RCTBubblingEventBlock?
    @objc public var onChangeSelection: RCTBubblingEventBlock?
    @objc public var onWikilinkPress: RCTBubblingEventBlock?

    private var lastText: String = ""
    private var pendingDecorations: [DecorationSpec] = []
    private var suppressJsEcho = false

    public override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        self.delegate = self
        self.font = UIFont.systemFont(ofSize: 16)
        self.alwaysBounceVertical = true
        self.autocorrectionType = .yes
        self.autocapitalizationType = .sentences
        self.smartDashesType = .yes
        self.smartQuotesType = .yes
        self.smartInsertDeleteType = .yes
        self.isAccessibilityElement = true
        addTapRecognizer()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not implemented") }

    @objc public func setText(_ text: String) {
        guard !suppressJsEcho else { return }
        if text == lastText { return }
        let savedRange = self.selectedRange
        self.attributedText = AttributedStringMapper.attributedString(text: text, decorations: pendingDecorations)
        self.selectedRange = clamp(savedRange, length: (text as NSString).length)
        lastText = text
    }

    @objc public func setDecorations(_ decorations: NSArray) {
        var parsed: [DecorationSpec] = []
        for case let dict as NSDictionary in decorations {
            guard let from = dict["from"] as? Int, let to = dict["to"] as? Int, let kind = dict["kind"] as? String else { continue }
            let attrs = dict["attrs"] as? [String: String]
            parsed.append(DecorationSpec(from: from, to: to, kind: kind, attrs: attrs))
        }
        pendingDecorations = parsed
        // Re-apply on the current text without changing selection.
        let savedRange = self.selectedRange
        self.attributedText = AttributedStringMapper.attributedString(text: lastText, decorations: pendingDecorations)
        self.selectedRange = clamp(savedRange, length: (lastText as NSString).length)
    }

    @objc public func setSelection(_ anchor: Int, _ head: Int) {
        let lo = min(anchor, head), hi = max(anchor, head)
        let length = (self.text as NSString).length
        self.selectedRange = NSRange(location: clamp1(lo, length), length: clamp1(hi, length) - clamp1(lo, length))
    }

    public func textViewDidChange(_ textView: UITextView) {
        let newText = textView.text ?? ""
        let (changedFrom, changedTo, inserted) = diff(lastText, newText)
        lastText = newText
        suppressJsEcho = true
        defer { suppressJsEcho = false }
        onChangeText?(["text": newText, "changedFrom": changedFrom, "changedTo": changedTo, "insertedText": inserted])
    }

    public func textViewDidChangeSelection(_ textView: UITextView) {
        let r = textView.selectedRange
        onChangeSelection?(["anchor": r.location, "head": r.location + r.length])
    }

    private func addTapRecognizer() {
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tap.cancelsTouchesInView = false
        addGestureRecognizer(tap)
    }

    @objc private func handleTap(_ gr: UITapGestureRecognizer) {
        let p = gr.location(in: self)
        guard let pos = closestPosition(to: p) else { return }
        let idx = offset(from: beginningOfDocument, to: pos)
        if idx >= 0, idx < (attributedText?.length ?? 0),
           let target = attributedText?.attribute(.init("krytonWikilinkTarget"), at: idx, effectiveRange: nil) as? String {
            onWikilinkPress?(["target": target])
        }
    }

    // MARK: - helpers
    private func clamp(_ r: NSRange, length: Int) -> NSRange {
        let lo = max(0, min(length, r.location))
        let hi = max(lo, min(length, r.location + r.length))
        return NSRange(location: lo, length: hi - lo)
    }
    private func clamp1(_ v: Int, _ length: Int) -> Int { return max(0, min(length, v)) }

    private func diff(_ a: String, _ b: String) -> (Int, Int, String) {
        // Find common prefix.
        let aChars = Array(a), bChars = Array(b)
        var i = 0
        while i < aChars.count && i < bChars.count && aChars[i] == bChars[i] { i += 1 }
        // Find common suffix.
        var j = 0
        while j < aChars.count - i && j < bChars.count - i && aChars[aChars.count - 1 - j] == bChars[bChars.count - 1 - j] { j += 1 }
        let changedFrom = i
        let changedTo = aChars.count - j
        let inserted = String(bChars[i..<bChars.count - j])
        return (changedFrom, changedTo, inserted)
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/editor/view/native/ios/KrytonEditor.swift
git commit -m "feat(editor/view/ios): UITextView subclass with decoration + selection bridge"
```

---

## Task EI-5: KrytonEditorManager.swift

**Files:**
- Create: `packages/ui/src/editor/view/native/ios/KrytonEditorManager.swift`
- Create: `packages/ui/src/editor/view/native/ios/KrytonEditor.podspec`

- [ ] **Step 1: Write the view manager**

```swift
// packages/ui/src/editor/view/native/ios/KrytonEditorManager.swift
import React

@objc(KrytonEditorManager)
public final class KrytonEditorManager: RCTViewManager {
    public override func view() -> UIView! {
        return KrytonEditor(frame: .zero, textContainer: nil)
    }

    public override static func requiresMainQueueSetup() -> Bool { return true }

    @objc public func updateText(_ reactTag: NSNumber, text: NSString) {
        bridge?.uiManager.addUIBlock { (_, viewRegistry) in
            if let view = viewRegistry?[reactTag] as? KrytonEditor {
                view.setText(text as String)
            }
        }
    }

    @objc public func updateDecorations(_ reactTag: NSNumber, decorations: NSArray) {
        bridge?.uiManager.addUIBlock { (_, viewRegistry) in
            if let view = viewRegistry?[reactTag] as? KrytonEditor {
                view.setDecorations(decorations)
            }
        }
    }

    @objc public func updateSelection(_ reactTag: NSNumber, anchor: NSNumber, head: NSNumber) {
        bridge?.uiManager.addUIBlock { (_, viewRegistry) in
            if let view = viewRegistry?[reactTag] as? KrytonEditor {
                view.setSelection(anchor.intValue, head.intValue)
            }
        }
    }
}
```

- [ ] **Step 2: Write the podspec**

```ruby
# packages/ui/src/editor/view/native/ios/KrytonEditor.podspec
Pod::Spec.new do |s|
  s.name         = "KrytonEditor"
  s.version      = "0.1.0"
  s.summary      = "Native iOS editor for Kryton (UITextView + RN bridge)"
  s.homepage     = "https://github.com/azrtydxb/kryton"
  s.license      = { :type => "MIT" }
  s.authors      = { "kryton" => "noreply@kryton.local" }
  s.platforms    = { :ios => "13.0" }
  s.source       = { :path => "." }
  s.source_files = "*.swift"
  s.dependency "React-Core"
  s.swift_version = "5.0"
end
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/editor/view/native/ios/KrytonEditorManager.swift packages/ui/src/editor/view/native/ios/KrytonEditor.podspec
git commit -m "feat(editor/view/ios): RN view manager + podspec"
```

---

## Task EI-6: RN React component with state reconciliation

**Files:**
- Create: `packages/ui/src/editor/view/native/EditorView.native.tsx`

- [ ] **Step 1: Write the component**

```tsx
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
```

- [ ] **Step 2: Compile-check**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/editor/view/native/EditorView.native.tsx
git commit -m "feat(editor/view/native): RN EditorView (iOS) with state reconciliation"
```

---

## Task EI-7: Wire native variant into the platform-resolved entry

**Files:**
- Modify: `packages/ui/src/editor/view/EditorView.ts`

- [ ] **Step 1: Confirm the type stub still resolves correctly**

The stub already imports from `./web/EditorView.web` for type purposes. Metro will substitute `./web/EditorView.web` → no, Metro substitutes by extension at the actual resolution site. Update the stub to delegate via a bare specifier:

```ts
// packages/ui/src/editor/view/EditorView.ts
// Bare specifier — bundlers resolve `EditorView.web.tsx` (Webpack/Vite) or
// `EditorView.native.tsx` (Metro). The web file lives under ./web/, native
// under ./native/, so use a wrapper folder per platform that re-exports.
export { EditorView } from "./EditorView.platform";
export type { EditorViewProps } from "./EditorView.platform";
```

Create the per-platform wrappers:

```ts
// packages/ui/src/editor/view/EditorView.platform.web.ts
export { EditorView } from "./web/EditorView.web";
export type { EditorViewProps } from "./web/EditorView.web";
```

```ts
// packages/ui/src/editor/view/EditorView.platform.native.ts
export { EditorView } from "./native/EditorView.native";
export type { EditorViewProps } from "./native/EditorView.native";
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/editor/view/EditorView.ts packages/ui/src/editor/view/EditorView.platform.web.ts packages/ui/src/editor/view/EditorView.platform.native.ts
git commit -m "feat(editor/view): platform-resolved EditorView entry"
```

---

## Task EI-8: Acceptance — build the iOS native module standalone

**Files:** none modified — verification only.

- [ ] **Step 1: Compile-check the TS bridge**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Document iOS build expectation**

> **Note:** A full iOS build requires the `kryton-mobile` scaffold (Pod install, Xcode workspace). At this stage, the Swift sources compile-check via Xcode in any host project that adds `KrytonEditor.podspec`. The `kryton-mobile` integration plan picks up the integration tests on simulator.

- [ ] **Step 3: Commit (no-op final marker)**

```bash
git commit --allow-empty -m "feat(editor/view/native/ios): native iOS editor module ready for kryton-mobile integration"
```
