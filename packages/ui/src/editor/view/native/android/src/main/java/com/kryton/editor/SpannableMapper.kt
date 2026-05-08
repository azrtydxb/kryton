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
