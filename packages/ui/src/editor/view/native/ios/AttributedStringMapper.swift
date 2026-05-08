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
