// packages/ui/src/editor/view/native/ios/__tests__/AttributedStringMapperTests.swift
import XCTest
@testable import KrytonEditor

final class AttributedStringMapperTests: XCTestCase {
    func testBoldAttributeAppliedOnRange() {
        let result = AttributedStringMapper.attributedString(
            text: "hello world",
            decorations: [DecorationSpec(from: 6, to: 11, kind: "bold", attrs: nil)]
        )
        var effective = NSRange(location: 0, length: 0)
        let font = result.attribute(.font, at: 6, effectiveRange: &effective) as? UIFont
        XCTAssertTrue(font?.fontDescriptor.symbolicTraits.contains(.traitBold) ?? false)
    }

    func testWikilinkCarriesTargetAttribute() {
        let text = "see [[Other]]!"
        let result = AttributedStringMapper.attributedString(
            text: text,
            decorations: [DecorationSpec(from: 4, to: 13, kind: "wikilink", attrs: ["target": "Other"])]
        )
        let target = result.attribute(.init("krytonWikilinkTarget"), at: 5, effectiveRange: nil) as? String
        XCTAssertEqual(target, "Other")
    }

    func testOutOfRangeDecorationIsClamped() {
        let result = AttributedStringMapper.attributedString(
            text: "hi",
            decorations: [DecorationSpec(from: 0, to: 999, kind: "bold", attrs: nil)]
        )
        XCTAssertEqual(result.length, 2)
    }
}
