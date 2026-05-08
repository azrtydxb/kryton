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
