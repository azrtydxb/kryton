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
