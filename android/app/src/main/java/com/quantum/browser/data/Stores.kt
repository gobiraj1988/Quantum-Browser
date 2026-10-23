package com.quantum.browser.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class PageEntry(val title: String, val url: String, val time: Long = System.currentTimeMillis())

/** Small JSON-file list store; good enough for bookmarks and a capped history. */
open class PageStore(context: Context, fileName: String, private val cap: Int) {

    private val file = File(context.filesDir, fileName)
    private val items = ArrayList<PageEntry>()

    init {
        runCatching {
            if (file.exists()) {
                val arr = JSONArray(file.readText())
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    items.add(PageEntry(o.optString("t"), o.optString("u"), o.optLong("ts")))
                }
            }
        }
    }

    @Synchronized fun all(): List<PageEntry> = items.toList()

    @Synchronized fun contains(url: String) = items.any { it.url == url }

    @Synchronized fun add(entry: PageEntry, dedupe: Boolean = true) {
        if (dedupe) items.removeAll { it.url == entry.url }
        items.add(0, entry)
        while (items.size > cap) items.removeAt(items.size - 1)
        save()
    }

    @Synchronized fun remove(url: String) {
        items.removeAll { it.url == url }; save()
    }

    @Synchronized fun clear() {
        items.clear(); save()
    }

    @Synchronized fun search(q: String, limit: Int = 8): List<PageEntry> {
        val s = q.lowercase()
        return items.asSequence().filter { it.url.lowercase().contains(s) || it.title.lowercase().contains(s) }.take(limit).toList()
    }

    private fun save() {
        val arr = JSONArray()
        items.forEach { arr.put(JSONObject().put("t", it.title).put("u", it.url).put("ts", it.time)) }
        runCatching { file.writeText(arr.toString()) }
    }
}

class Bookmarks(context: Context) : PageStore(context, "bookmarks.json", 5000)
class History(context: Context) : PageStore(context, "history.json", 3000)

/** Lifetime Shields counters shown on the new tab page, like Brave's stats widget. */
class Stats(context: Context) {
    private val sp = context.getSharedPreferences("quantum_stats", Context.MODE_PRIVATE)

    @Volatile var blocked = sp.getLong("blocked", 0); private set
    @Volatile var httpsUpgrades = sp.getLong("https", 0); private set

    @Synchronized fun addBlocked() { blocked++ ; if (blocked % 25 == 0L) flush() }
    @Synchronized fun addHttpsUpgrade() { httpsUpgrades++; flush() }

    /** Average blocked ad/tracker payload ≈ 50 KB and ≈ 50 ms of load time (Brave uses similar estimates). */
    val bytesSaved get() = blocked * 50_000L
    val secondsSaved get() = blocked * 50L / 1000L

    fun flush() = sp.edit().putLong("blocked", blocked).putLong("https", httpsUpgrades).apply()

    fun reset() { blocked = 0; httpsUpgrades = 0; flush() }
}
