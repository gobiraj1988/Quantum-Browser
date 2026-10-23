package com.quantum.browser.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView

/** Programmatic view helpers and the app palette (no XML layouts, no extra libraries). */
object Ui {
    val BG = Color.parseColor("#17171b")
    val SURFACE = Color.parseColor("#24242a")
    val SURFACE_2 = Color.parseColor("#303038")
    val TEXT = Color.parseColor("#f0f0f3")
    val MUTED = Color.parseColor("#9a9aa6")
    val ACCENT = Color.parseColor("#fb542b")
    val PRIVATE = Color.parseColor("#4c2a99")
    val PRIVATE_ACCENT = Color.parseColor("#8b5cf6")
    val GOOD = Color.parseColor("#2fbf71")

    fun Context.dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    fun rounded(color: Int, radiusPx: Float) = GradientDrawable().apply { setColor(color); cornerRadius = radiusPx }

    fun ripple(ctx: Context, base: Int, radiusDp: Int) =
        RippleDrawable(ColorStateList.valueOf(Color.parseColor("#33ffffff")), rounded(base, ctx.dp(radiusDp).toFloat()), null)

    /** Square icon-style button with a glyph. 48dp minimum touch target for accessibility. */
    fun iconButton(ctx: Context, glyph: String, description: String, onClick: (View) -> Unit) = TextView(ctx).apply {
        text = glyph
        contentDescription = description
        setTextColor(TEXT)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        gravity = Gravity.CENTER
        minWidth = ctx.dp(48); minHeight = ctx.dp(48)
        background = ripple(ctx, Color.TRANSPARENT, 24)
        setOnClickListener(onClick)
    }

    fun text(ctx: Context, s: CharSequence, sizeSp: Float = 15f, color: Int = TEXT, bold: Boolean = false) = TextView(ctx).apply {
        text = s
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    fun vertical(ctx: Context, padDp: Int = 0) = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        val p = ctx.dp(padDp); setPadding(p, p, p, p)
    }

    /** A settings-style row: title + optional subtitle + switch. */
    fun switchRow(ctx: Context, title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit): View {
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(ctx.dp(18), ctx.dp(10), ctx.dp(14), ctx.dp(10))
            minimumHeight = ctx.dp(56)
        }
        val labels = vertical(ctx)
        labels.addView(text(ctx, title, 16f))
        if (subtitle != null) labels.addView(text(ctx, subtitle, 12f, MUTED))
        row.addView(labels, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val sw = Switch(ctx).apply {
            isChecked = checked
            contentDescription = title
            setOnCheckedChangeListener { _, v -> onChange(v) }
        }
        row.addView(sw)
        row.setOnClickListener { sw.toggle() }
        return row
    }

    /** A tappable settings row with title + current value. */
    fun valueRow(ctx: Context, title: String, value: String, onClick: (TextView) -> Unit): View {
        val row = vertical(ctx).apply {
            setPadding(ctx.dp(18), ctx.dp(12), ctx.dp(18), ctx.dp(12))
            minimumHeight = ctx.dp(56)
            background = ripple(ctx, Color.TRANSPARENT, 0)
        }
        row.addView(text(ctx, title, 16f))
        val v = text(ctx, value, 13f, ACCENT)
        row.addView(v)
        row.setOnClickListener { onClick(v) }
        return row
    }

    fun header(ctx: Context, title: String) = text(ctx, title.uppercase(), 12f, ACCENT, bold = true).apply {
        setPadding(ctx.dp(18), ctx.dp(20), ctx.dp(18), ctx.dp(6))
        letterSpacing = 0.08f
    }
}
