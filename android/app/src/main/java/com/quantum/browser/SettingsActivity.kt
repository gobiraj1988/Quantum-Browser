package com.quantum.browser

import android.app.Activity
import android.app.AlertDialog
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.WindowInsets
import android.widget.EditText
import android.widget.ScrollView
import com.quantum.browser.data.Prefs
import com.quantum.browser.shields.FilterMatcher
import com.quantum.browser.shields.Shields
import com.quantum.browser.ui.Ui
import com.quantum.browser.ui.Ui.dp

class SettingsActivity : Activity() {

    private val prefs get() = QuantumApp.prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "Settings"
        val box = Ui.vertical(this).apply { setBackgroundColor(Ui.BG) }

        box.addView(Ui.text(this, "Quantum Browser", 24f, bold = true).apply { setPadding(dp(18), dp(18), dp(18), 0) })
        val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: ""
        box.addView(Ui.text(this, "Version $version · Private by default", 13f, Ui.MUTED).apply { setPadding(dp(18), 0, dp(18), dp(4)) })

        // General
        box.addView(Ui.header(this, "General"))
        val engines = Prefs.SearchEngine.values()
        box.addView(Ui.valueRow(this, "Search engine", prefs.searchEngine.label) { v ->
            AlertDialog.Builder(this).setTitle("Search engine")
                .setSingleChoiceItems(engines.map { it.label }.toTypedArray(), prefs.searchEngine.ordinal) { d, i ->
                    prefs.searchEngine = engines[i]; v.text = engines[i].label; d.dismiss()
                }.show()
        })
        box.addView(Ui.switchRow(this, "Restore tabs on launch", null, prefs.restoreTabs) { prefs.restoreTabs = it })
        box.addView(Ui.switchRow(this, "Request desktop sites by default", null, prefs.desktopModeDefault) { prefs.desktopModeDefault = it })
        box.addView(Ui.switchRow(this, "Night mode for web pages", "Darkens sites that have no dark theme", prefs.nightMode) { prefs.nightMode = it })

        // Shields
        box.addView(Ui.header(this, "Shields & privacy"))
        val modes = FilterMatcher.Mode.values()
        val modeNames = arrayOf("Off", "Standard (recommended)", "Aggressive")
        box.addView(Ui.valueRow(this, "Trackers & ads blocking", modeNames[prefs.adBlockMode.ordinal]) { v ->
            AlertDialog.Builder(this).setTitle("Trackers & ads blocking")
                .setSingleChoiceItems(modeNames, prefs.adBlockMode.ordinal) { d, i ->
                    prefs.adBlockMode = modes[i]; v.text = modeNames[i]; d.dismiss()
                }.show()
        })
        box.addView(Ui.switchRow(this, "Upgrade connections to HTTPS", "Falls back to HTTP only if the site has no HTTPS", prefs.httpsUpgrade) { prefs.httpsUpgrade = it })
        box.addView(Ui.switchRow(this, "Block fingerprinting", "Randomises canvas, WebGL, audio & hardware values", prefs.fingerprintProtection) { prefs.fingerprintProtection = it })
        box.addView(Ui.switchRow(this, "Block cross-site cookies", null, prefs.blockThirdPartyCookies) { prefs.blockThirdPartyCookies = it })
        box.addView(Ui.switchRow(this, "Prevent WebRTC IP leaks", "May break some video calls", prefs.blockWebRtcLeak) { prefs.blockWebRtcLeak = it })
        box.addView(Ui.switchRow(this, "Hide ad placeholders", "Cosmetic filtering of empty ad boxes", prefs.cosmeticFiltering) { prefs.cosmeticFiltering = it })
        box.addView(Ui.switchRow(this, "Hide cookie consent banners", null, prefs.hideCookieBanners) { prefs.hideCookieBanners = it })
        box.addView(Ui.switchRow(this, "Block pop-ups", null, prefs.blockPopups) { prefs.blockPopups = it })
        box.addView(Ui.switchRow(this, "Send Global Privacy Control", "Tells sites not to sell or share your data", prefs.sendGpc) { prefs.sendGpc = it })
        box.addView(Ui.switchRow(this, "Clear data when exiting", "History, cookies, cache and site data", prefs.clearOnExit) { prefs.clearOnExit = it })

        val listsRow = Ui.valueRow(this, "Update filter lists now", listStatus()) { v ->
            v.text = "Updating…"
            Shields.updateNow(this) { msg -> v.text = msg }
        }
        box.addView(listsRow)
        box.addView(Ui.valueRow(this, "Reset privacy stats", "${QuantumApp.stats.blocked} blocked so far") { v ->
            QuantumApp.stats.reset(); v.text = "0 blocked so far"
        })

        // AI
        box.addView(Ui.header(this, "Quantum AI"))
        box.addView(Ui.valueRow(this, "Anthropic API key", keyLabel()) { v ->
            val input = EditText(this).apply {
                hint = "sk-ant-…"
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                setText(prefs.aiApiKey)
                setPadding(dp(20), dp(12), dp(20), dp(12))
            }
            AlertDialog.Builder(this).setTitle("Anthropic API key")
                .setMessage("Stored only on this device. Page text is sent to Anthropic only when you use Quantum AI.")
                .setView(input)
                .setPositiveButton("Save") { _, _ -> prefs.aiApiKey = input.text.toString().trim(); v.text = keyLabel() }
                .setNeutralButton("Remove") { _, _ -> prefs.aiApiKey = ""; v.text = keyLabel() }
                .setNegativeButton("Cancel", null).show()
        })

        box.addView(Ui.header(this, "About"))
        box.addView(Ui.text(this,
            "Shields use EasyList, EasyPrivacy, StevenBlack hosts and Peter Lowe's list — the same public lists used by Brave and uBlock Origin.",
            13f, Ui.MUTED).apply { setPadding(dp(18), dp(4), dp(18), dp(40)) })

        val scroll = ScrollView(this).apply { setBackgroundColor(Ui.BG); addView(box) }
        @Suppress("DEPRECATION")
        scroll.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }
        setContentView(scroll)
    }

    private fun listStatus(): String {
        val last = prefs.lastListUpdate
        val ago = if (last == 0L) "never updated" else "updated " + android.text.format.DateUtils.getRelativeTimeSpanString(last)
        return "${Shields.ruleCount} rules · $ago"
    }

    private fun keyLabel() = if (prefs.aiApiKey.isBlank()) "Not set" else "Saved (…${prefs.aiApiKey.takeLast(4)})"
}
