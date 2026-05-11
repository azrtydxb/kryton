# Editor Native Android View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`).

**Goal:** Build the Android editor surface as a React Native native module — a Kotlin `EditText` subclass driven by the in-house `EditorState`, with `SpannableStringBuilder` mapped from `DecorationSpec[]`. No WebView. Full native IME, autocorrect, voice input, suggestion strip, accessibility.

**Architecture:** A Kotlin class `KrytonEditor: AppCompatEditText` exposes `setText`, `setDecorations`, `setSelection` via a `ViewManager`. JS sends `(text, decorations[], selection)` whenever `EditorState` changes; the native side rebuilds a `SpannableStringBuilder` and applies it via `setText(spannable, BufferType.SPANNABLE)`, preserving the selection. Local edits emit `onChangeText` events that JS reconciles to `Operation`s.

**Tech Stack:** Kotlin, React Native bridge (`SimpleViewManager`). Depends on `editor-state-core`.

**Spec:** [`docs/superpowers/specs/2026-05-08-editor-cross-platform.md`](../specs/2026-05-08-editor-cross-platform.md)

**Depends on:** [`2026-05-08-editor-state-core.md`](./2026-05-08-editor-state-core.md)

---

## File ownership

- `packages/ui/src/editor/view/native/android/build.gradle` (new)
- `packages/ui/src/editor/view/native/android/src/main/AndroidManifest.xml` (new)
- `packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditor.kt` (new)
- `packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditorManager.kt` (new)
- `packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditorPackage.kt` (new)
- `packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/SpannableMapper.kt` (new)
- `packages/ui/src/editor/view/native/android/src/test/java/com/kryton/editor/SpannableMapperTest.kt` (new)
- The TS-side `EditorView.native.tsx` and `bridge.ts` already exist (created in `editor-native-ios-view`); this plan does not modify them — the native module name `KrytonEditor` is shared.

Not touched: any non-Android files except shared TS types (already in place).

---

## Task EA-1: Gradle module scaffolding

**Files:**
- Create: `packages/ui/src/editor/view/native/android/build.gradle`
- Create: `packages/ui/src/editor/view/native/android/src/main/AndroidManifest.xml`

- [ ] **Step 1: Write build.gradle**

```groovy
// packages/ui/src/editor/view/native/android/build.gradle
apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'

android {
    namespace "com.kryton.editor"
    compileSdkVersion 34
    defaultConfig {
        minSdkVersion 24
        targetSdkVersion 34
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation 'com.facebook.react:react-android'
    implementation 'androidx.appcompat:appcompat:1.6.1'
    testImplementation 'junit:junit:4.13.2'
    testImplementation 'org.robolectric:robolectric:4.11.1'
}
```

- [ ] **Step 2: Write the manifest stub**

```xml
<!-- packages/ui/src/editor/view/native/android/src/main/AndroidManifest.xml -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android" />
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/editor/view/native/android/build.gradle packages/ui/src/editor/view/native/android/src/main/AndroidManifest.xml
git commit -m "build(editor/view/android): gradle module scaffolding"
```

---

## Task EA-2: SpannableMapper.kt

**Files:**
- Create: `packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/SpannableMapper.kt`

- [ ] **Step 1: Write the mapper**

```kotlin
// packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/SpannableMapper.kt
package com.kryton.editor

import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.text.style.UnderlineSpan

data class DecorationSpec(
    val from: Int,
    val to: Int,
    val kind: String,
    val attrs: Map<String, String>?,
)

object SpannableMapper {
    fun spannable(text: String, decorations: List<DecorationSpec>): SpannableStringBuilder {
        val s = SpannableStringBuilder(text)
        for (d in decorations) {
            val from = clamp(d.from, 0, text.length)
            val to = clamp(d.to, from, text.length)
            if (from == to) continue
            apply(d.kind, d.attrs, from, to, s)
        }
        return s
    }

    private fun apply(kind: String, attrs: Map<String, String>?, from: Int, to: Int, s: SpannableStringBuilder) {
        val flag = Spanned.SPAN_INCLUSIVE_EXCLUSIVE
        when (kind) {
            "bold" -> s.setSpan(StyleSpan(Typeface.BOLD), from, to, flag)
            "italic" -> s.setSpan(StyleSpan(Typeface.ITALIC), from, to, flag)
            "strikethrough" -> s.setSpan(StrikethroughSpan(), from, to, flag)
            "code-inline", "code-block" -> {
                s.setSpan(TypefaceSpan("monospace"), from, to, flag)
                s.setSpan(BackgroundColorSpan(Color.parseColor("#22808080")), from, to, flag)
            }
            "heading-1" -> s.setSpan(RelativeSizeSpan(1.8f), from, to, flag)
                .also { s.setSpan(StyleSpan(Typeface.BOLD), from, to, flag) }
            "heading-2" -> s.setSpan(RelativeSizeSpan(1.5f), from, to, flag)
                .also { s.setSpan(StyleSpan(Typeface.BOLD), from, to, flag) }
            "heading-3" -> s.setSpan(RelativeSizeSpan(1.25f), from, to, flag)
                .also { s.setSpan(StyleSpan(Typeface.BOLD), from, to, flag) }
            "link" -> {
                s.setSpan(ForegroundColorSpan(Color.parseColor("#1E88E5")), from, to, flag)
                s.setSpan(UnderlineSpan(), from, to, flag)
            }
            "wikilink" -> {
                s.setSpan(ForegroundColorSpan(Color.parseColor("#8E24AA")), from, to, flag)
                s.setSpan(UnderlineSpan(), from, to, flag)
                attrs?.get("target")?.let { target ->
                    s.setSpan(WikilinkTargetSpan(target), from, to, flag)
                }
            }
            "tag" -> s.setSpan(ForegroundColorSpan(Color.parseColor("#00897B")), from, to, flag)
            "blockquote" -> s.setSpan(ForegroundColorSpan(Color.parseColor("#9E9E9E")), from, to, flag)
            else -> { /* no-op */ }
        }
    }

    private fun clamp(v: Int, lo: Int, hi: Int): Int = maxOf(lo, minOf(hi, v))
}

class WikilinkTargetSpan(val target: String)
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/SpannableMapper.kt
git commit -m "feat(editor/view/android): DecorationSpec → SpannableStringBuilder mapper"
```

---

## Task EA-3: SpannableMapper test (Robolectric)

**Files:**
- Create: `packages/ui/src/editor/view/native/android/src/test/java/com/kryton/editor/SpannableMapperTest.kt`

- [ ] **Step 1: Write the test**

```kotlin
// packages/ui/src/editor/view/native/android/src/test/java/com/kryton/editor/SpannableMapperTest.kt
package com.kryton.editor

import android.text.style.StyleSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SpannableMapperTest {

    @Test
    fun bold_span_applied_on_range() {
        val s = SpannableMapper.spannable("hello world", listOf(
            DecorationSpec(6, 11, "bold", null),
        ))
        val spans = s.getSpans(6, 11, StyleSpan::class.java)
        assertTrue(spans.any { it.style == android.graphics.Typeface.BOLD })
    }

    @Test
    fun wikilink_carries_target() {
        val s = SpannableMapper.spannable("see [[Other]]!", listOf(
            DecorationSpec(4, 13, "wikilink", mapOf("target" to "Other")),
        ))
        val spans = s.getSpans(4, 13, WikilinkTargetSpan::class.java)
        assertEquals("Other", spans[0].target)
    }

    @Test
    fun out_of_range_decoration_is_clamped() {
        val s = SpannableMapper.spannable("hi", listOf(DecorationSpec(0, 999, "bold", null)))
        assertEquals("hi", s.toString())
    }
}
```

- [ ] **Step 2: Document the test runner expectation**

> **Note:** The Robolectric runner needs the gradle module wired into a host Android project. The `kryton-mobile` scaffold plan integrates the test target. This task delivers test sources; the runner is set up there.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/editor/view/native/android/src/test/java/com/kryton/editor/SpannableMapperTest.kt
git commit -m "test(editor/view/android): Robolectric tests for SpannableMapper"
```

---

## Task EA-4: KrytonEditor.kt — EditText subclass

**Files:**
- Create: `packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditor.kt`

- [ ] **Step 1: Write the subclass**

```kotlin
// packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditor.kt
package com.kryton.editor

import android.content.Context
import android.text.Editable
import android.text.TextWatcher
import android.util.AttributeSet
import android.view.MotionEvent
import androidx.appcompat.widget.AppCompatEditText
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter

class KrytonEditor @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null,
) : AppCompatEditText(context, attrs) {

    private var lastText: String = ""
    private var pendingDecorations: List<DecorationSpec> = emptyList()
    private var suppressJsEcho = false

    init {
        isSingleLine = false
        gravity = android.view.Gravity.TOP or android.view.Gravity.START
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                if (suppressJsEcho) return
                val newText = s?.toString() ?: ""
                val (changedFrom, changedTo, inserted) = diff(lastText, newText)
                lastText = newText
                emit("topChange", Arguments.createMap().apply {
                    putString("text", newText)
                    putInt("changedFrom", changedFrom)
                    putInt("changedTo", changedTo)
                    putString("insertedText", inserted)
                })
            }
        })
    }

    fun applyText(text: String) {
        if (text == lastText) return
        suppressJsEcho = true
        try {
            val savedSel = selectionStart to selectionEnd
            setText(SpannableMapper.spannable(text, pendingDecorations), BufferType.SPANNABLE)
            setSelection(
                clamp(savedSel.first, 0, text.length),
                clamp(savedSel.second, 0, text.length),
            )
            lastText = text
        } finally { suppressJsEcho = false }
    }

    fun applyDecorations(decorations: List<DecorationSpec>) {
        pendingDecorations = decorations
        // Re-render current text with new decorations.
        val savedSel = selectionStart to selectionEnd
        suppressJsEcho = true
        try {
            setText(SpannableMapper.spannable(lastText, pendingDecorations), BufferType.SPANNABLE)
            setSelection(
                clamp(savedSel.first, 0, lastText.length),
                clamp(savedSel.second, 0, lastText.length),
            )
        } finally { suppressJsEcho = false }
    }

    fun applySelection(anchor: Int, head: Int) {
        val lo = minOf(anchor, head); val hi = maxOf(anchor, head)
        setSelection(clamp(lo, 0, length()), clamp(hi, 0, length()))
    }

    override fun onSelectionChanged(selStart: Int, selEnd: Int) {
        super.onSelectionChanged(selStart, selEnd)
        emit("topSelectionChange", Arguments.createMap().apply {
            putInt("anchor", selStart); putInt("head", selEnd)
        })
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_UP) {
            val x = event.x.toInt() - totalPaddingLeft + scrollX
            val y = event.y.toInt() - totalPaddingTop + scrollY
            val line = layout?.getLineForVertical(y) ?: -1
            if (line >= 0) {
                val offset = layout!!.getOffsetForHorizontal(line, x.toFloat())
                val spans = (text as? android.text.Spanned)?.getSpans(offset, offset, WikilinkTargetSpan::class.java)
                spans?.firstOrNull()?.let { span ->
                    emit("topWikilinkPress", Arguments.createMap().apply { putString("target", span.target) })
                }
            }
        }
        return super.onTouchEvent(event)
    }

    private fun emit(eventName: String, payload: com.facebook.react.bridge.WritableMap) {
        val ctx = context as? ReactContext ?: return
        ctx.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, eventName, payload)
    }

    private fun diff(a: String, b: String): Triple<Int, Int, String> {
        var i = 0
        while (i < a.length && i < b.length && a[i] == b[i]) i++
        var j = 0
        while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] == b[b.length - 1 - j]) j++
        return Triple(i, a.length - j, b.substring(i, b.length - j))
    }

    private fun clamp(v: Int, lo: Int, hi: Int): Int = maxOf(lo, minOf(hi, v))
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditor.kt
git commit -m "feat(editor/view/android): EditText subclass with span + selection bridge"
```

---

## Task EA-5: KrytonEditorManager.kt + KrytonEditorPackage.kt

**Files:**
- Create: `packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditorManager.kt`
- Create: `packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditorPackage.kt`

- [ ] **Step 1: Write the view manager**

```kotlin
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
```

- [ ] **Step 2: Write the package**

```kotlin
// packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditorPackage.kt
package com.kryton.editor

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class KrytonEditorPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = emptyList()
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(KrytonEditorManager())
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditorManager.kt packages/ui/src/editor/view/native/android/src/main/java/com/kryton/editor/KrytonEditorPackage.kt
git commit -m "feat(editor/view/android): RN view manager + ReactPackage"
```

---

## Task EA-6: Acceptance — Kotlin unit tests + TS compile

**Files:** none modified — verification only.

- [ ] **Step 1: Run Kotlin tests (when host project wired)**

Run (from a host project that includes the gradle module): `./gradlew :ui-editor-android:test`
Expected: 3 Robolectric tests PASS.

> Until `kryton-mobile` provides the host project, this step is documented; `editor-state-core` and the TS compile remain the gating tests at this stage.

- [ ] **Step 2: TS compile-check**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit (no-op final marker)**

```bash
git commit --allow-empty -m "feat(editor/view/native/android): native Android editor module ready for kryton-mobile integration"
```
