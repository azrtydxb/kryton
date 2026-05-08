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
