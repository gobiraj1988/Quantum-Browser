package com.quantum.browser.shields

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.quantum.browser.data.Prefs
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Owns the active filter set. The bundled starter list loads instantly; the full public lists
 * (the same ones Brave/uBlock build on) are downloaded in the background and refreshed daily.
 */
object Shields {

    private const val TAG = "Shields"
    private const val UPDATE_INTERVAL_MS = 24L * 60 * 60 * 1000

    /** Lists fetched over the network. Name is used as the cache file name. */
    val REMOTE_LISTS = linkedMapOf(
        "easylist" to "https://easylist.to/easylist/easylist.txt",
        "easyprivacy" to "https://easylist.to/easylist/easyprivacy.txt",
        "stevenblack" to "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
        "peterlowe" to "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext",
    )

    @Volatile var matcher = FilterMatcher(); private set
    @Volatile var ruleCount = 0; private set
    @Volatile var loading = false; private set

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    private fun listDir(ctx: Context) = File(ctx.filesDir, "filter-lists").apply { mkdirs() }

    fun init(ctx: Context) {
        val app = ctx.applicationContext
        io.execute { rebuild(app) }
        if (System.currentTimeMillis() - Prefs(app).lastListUpdate > UPDATE_INTERVAL_MS) updateNow(app, null)
    }

    /** Re-parses bundled + cached lists into a fresh matcher and swaps it in atomically. */
    private fun rebuild(ctx: Context) {
        loading = true
        val m = FilterMatcher()
        runCatching { ctx.assets.open("blocklist.txt").bufferedReader().use { m.addList(it.readText()) } }
            .onFailure { Log.w(TAG, "bundled list", it) }
        listDir(ctx).listFiles()?.forEach { f ->
            runCatching { f.bufferedReader().useLines { lines -> lines.forEach { m.addRule(it) } } }
        }
        matcher = m
        ruleCount = m.size
        loading = false
        Log.i(TAG, "Shields loaded $ruleCount domain rules")
    }

    /** Downloads every remote list, then rebuilds. [done] is called on the main thread with a status message. */
    fun updateNow(ctx: Context, done: ((String) -> Unit)?) {
        val app = ctx.applicationContext
        io.execute {
            var ok = 0
            REMOTE_LISTS.forEach { (name, url) ->
                runCatching {
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.connectTimeout = 15_000; conn.readTimeout = 30_000
                    conn.setRequestProperty("User-Agent", "QuantumBrowser-Android")
                    try {
                        if (conn.responseCode != 200) error("HTTP ${conn.responseCode}")
                        val tmp = File(listDir(app), "$name.tmp")
                        conn.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
                        tmp.renameTo(File(listDir(app), "$name.txt"))
                        ok++
                    } finally { conn.disconnect() }
                }.onFailure { Log.w(TAG, "update $name failed", it) }
            }
            if (ok > 0) Prefs(app).lastListUpdate = System.currentTimeMillis()
            rebuild(app)
            val msg = "Updated $ok/${REMOTE_LISTS.size} lists · $ruleCount rules active"
            done?.let { cb -> main.post { cb(msg) } }
        }
    }
}
