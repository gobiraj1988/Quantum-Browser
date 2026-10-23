package com.quantum.browser.data

import android.content.Context
import android.content.SharedPreferences
import com.quantum.browser.shields.FilterMatcher

/** All user settings. Backed by SharedPreferences so it survives process death. */
class Prefs(context: Context) {

    val sp: SharedPreferences = context.getSharedPreferences("quantum_prefs", Context.MODE_PRIVATE)

    enum class SearchEngine(val label: String, val url: String, val param: String) {
        BRAVE("Brave Search", "https://search.brave.com/search", "q"),
        DUCKDUCKGO("DuckDuckGo", "https://duckduckgo.com/", "q"),
        STARTPAGE("Startpage", "https://www.startpage.com/sp/search", "query"),
        GOOGLE("Google", "https://www.google.com/search", "q"),
        BING("Bing", "https://www.bing.com/search", "q");

        fun queryUrl(q: String) = "$url?$param=" + java.net.URLEncoder.encode(q, "UTF-8")
    }

    var searchEngine: SearchEngine
        get() = runCatching { SearchEngine.valueOf(sp.getString("search", null)!!) }.getOrDefault(SearchEngine.BRAVE)
        set(v) = sp.edit().putString("search", v.name).apply()

    var adBlockMode: FilterMatcher.Mode
        get() = runCatching { FilterMatcher.Mode.valueOf(sp.getString("adblock_mode", null)!!) }.getOrDefault(FilterMatcher.Mode.STANDARD)
        set(v) = sp.edit().putString("adblock_mode", v.name).apply()

    var httpsUpgrade by bool("https_upgrade", true)
    var fingerprintProtection by bool("fingerprint", true)
    var blockThirdPartyCookies by bool("block_3p_cookies", true)
    var blockWebRtcLeak by bool("webrtc", true)
    var hideCookieBanners by bool("cookie_banners", true)
    var cosmeticFiltering by bool("cosmetic", true)
    var blockPopups by bool("popups", true)
    var nightMode by bool("night", false)
    var desktopModeDefault by bool("desktop_default", false)
    var clearOnExit by bool("clear_on_exit", false)
    var restoreTabs by bool("restore_tabs", true)
    var sendGpc by bool("gpc", true)
    var aiApiKey by string("ai_key", "")
    var lastListUpdate by long("list_update", 0L)

    // Per-site Shields overrides --------------------------------------------------------------
    fun shieldsUp(host: String) = !sp.getBoolean("site_down_" + site(host), false)
    fun setShieldsUp(host: String, up: Boolean) = sp.edit().putBoolean("site_down_" + site(host), !up).apply()
    fun blockScripts(host: String) = sp.getBoolean("site_noscript_" + site(host), false)
    fun setBlockScripts(host: String, block: Boolean) = sp.edit().putBoolean("site_noscript_" + site(host), block).apply()

    private fun site(host: String) = FilterMatcher.registrableDomain(host)

    // Delegates --------------------------------------------------------------------------------
    private fun bool(key: String, def: Boolean) = object : kotlin.properties.ReadWriteProperty<Any?, Boolean> {
        override fun getValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>) = sp.getBoolean(key, def)
        override fun setValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>, value: Boolean) = sp.edit().putBoolean(key, value).apply()
    }

    private fun string(key: String, def: String) = object : kotlin.properties.ReadWriteProperty<Any?, String> {
        override fun getValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>) = sp.getString(key, def) ?: def
        override fun setValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>, value: String) = sp.edit().putString(key, value).apply()
    }

    private fun long(key: String, def: Long) = object : kotlin.properties.ReadWriteProperty<Any?, Long> {
        override fun getValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>) = sp.getLong(key, def)
        override fun setValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>, value: Long) = sp.edit().putLong(key, value).apply()
    }
}
