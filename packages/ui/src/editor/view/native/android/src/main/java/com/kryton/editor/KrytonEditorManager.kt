// packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditorManager.kt
package com.kryton.editor

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class KrytonEditorManager : SimpleViewManager<KrytonEditor>() {
    override fun getName() = "KrytonEditor"

    override fun createViewInstance(reactContext: ThemedReactContext): KrytonEditor =
        KrytonEditor(reactContext)

    @ReactProp(name = "text")
    fun setText(view: KrytonEditor, text: String?) {
        view.applyText(text ?: "")
    }

    @ReactProp(name = "decorations")
    fun setDecorations(view: KrytonEditor, decorations: ReadableArray?) {
        val list = mutableListOf<DecorationSpec>()
        decorations ?: run { view.applyDecorations(emptyList()); return }
        for (i in 0 until decorations.size()) {
            val m: ReadableMap = decorations.getMap(i) ?: continue
            val attrsMap = m.getMap("attrs")
            val attrs = if (attrsMap != null) {
                val it = attrsMap.keySetIterator()
                val map = mutableMapOf<String, String>()
                while (it.hasNextKey()) {
                    val k = it.nextKey()
                    map[k] = attrsMap.getString(k) ?: continue
                }
                map
            } else null
            list.add(DecorationSpec(
                from = m.getInt("from"),
                to = m.getInt("to"),
                kind = m.getString("kind") ?: continue,
                attrs = attrs,
            ))
        }
        view.applyDecorations(list)
    }

    @ReactProp(name = "selection")
    fun setSelection(view: KrytonEditor, sel: ReadableMap?) {
        sel ?: return
        view.applySelection(sel.getInt("anchor"), sel.getInt("head"))
    }

    override fun getExportedCustomBubblingEventTypeConstants(): MutableMap<String, Any> {
        val phasedRegistration = mapOf("bubbled" to "onChangeText", "captured" to "onChangeTextCapture")
        return mutableMapOf(
            "topChange" to mapOf("phasedRegistrationNames" to phasedRegistration),
            "topSelectionChange" to mapOf("phasedRegistrationNames" to mapOf("bubbled" to "onChangeSelection", "captured" to "onChangeSelectionCapture")),
            "topWikilinkPress" to mapOf("phasedRegistrationNames" to mapOf("bubbled" to "onWikilinkPress", "captured" to "onWikilinkPressCapture")),
        )
    }
}
