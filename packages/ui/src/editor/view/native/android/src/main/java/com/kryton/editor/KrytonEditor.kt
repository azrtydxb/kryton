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
