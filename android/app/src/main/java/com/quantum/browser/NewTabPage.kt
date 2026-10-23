package com.quantum.browser

import android.content.Context
import android.text.Html
import com.quantum.browser.data.Prefs
import com.quantum.browser.shields.Shields

/** Brave-style new tab page: privacy stats, search box and speed dial. */
object NewTabPage {

    private val DEFAULT_DIALS = listOf(
        "YouTube" to "https://m.youtube.com/",
        "Wikipedia" to "https://en.m.wikipedia.org/",
        "GitHub" to "https://github.com/",
        "Reddit" to "https://www.reddit.com/",
        "News" to "https://news.ycombinator.com/",
        "Maps" to "https://www.openstreetmap.org/",
        "X" to "https://x.com/",
        "Amazon" to "https://www.amazon.com/",
    )

    private fun esc(s: String) = Html.escapeHtml(s)

    fun formatBytes(b: Long): String = when {
        b >= 1L shl 30 -> String.format("%.1f GB", b / (1L shl 30).toDouble())
        b >= 1L shl 20 -> String.format("%.1f MB", b / (1L shl 20).toDouble())
        b >= 1L shl 10 -> "${b / 1024} KB"
        else -> "$b B"
    }

    fun formatSeconds(s: Long): String = when {
        s >= 86_400 -> "${s / 86_400}d ${(s % 86_400) / 3600}h"
        s >= 3600 -> "${s / 3600}h ${(s % 3600) / 60}m"
        s >= 60 -> "${s / 60}m"
        else -> "${s}s"
    }

    fun html(ctx: Context, prefs: Prefs, private: Boolean): String {
        val stats = QuantumApp.stats
        val engine = prefs.searchEngine
        val bm = QuantumApp.bookmarks.all().take(8).map { (it.title.ifBlank { it.url }) to it.url }
        val dials = (bm + DEFAULT_DIALS).distinctBy { it.second }.take(8)
        val accent = if (private) "#8b5cf6" else "#fb542b"
        val dialHtml = dials.joinToString("") { (t, u) ->
            val letter = esc(t.trim().take(1).uppercase())
            "<a class='dial' href='${esc(u)}'><span class='ic'>$letter</span><span class='lb'>${esc(t.take(14))}</span></a>"
        }
        val header = if (private)
            "<div class='priv'><b>Private tab</b><br>Pages you visit here aren't saved to history, cache or form data. Shields stay up. Note: on Android, cookies are shared with normal tabs.</div>"
        else """
            <div class='stats'>
              <div><b>${stats.blocked}</b><span>Trackers &amp; ads blocked</span></div>
              <div><b>${formatBytes(stats.bytesSaved)}</b><span>Bandwidth saved</span></div>
              <div><b>${formatSeconds(stats.secondsSaved)}</b><span>Time saved</span></div>
            </div>"""
        return """<!doctype html><html><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'><title>${if (private) "Private tab" else "New tab"}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:28px 18px;font-family:sans-serif;color:#eee;min-height:100vh;
background:radial-gradient(circle at 20% 0%,${accent}55,transparent 55%),radial-gradient(circle at 100% 100%,#2b2dff33,transparent 50%),#17171b}
h1{font-size:26px;margin:8px 0 22px;text-align:center;letter-spacing:.5px}h1 span{color:$accent}
.stats{display:flex;gap:8px;margin-bottom:22px}.stats div{flex:1;background:#ffffff10;border-radius:14px;padding:12px 8px;text-align:center}
.stats b{display:block;font-size:20px;color:$accent}.stats span{font-size:11px;color:#bbb}
.priv{background:#8b5cf622;border:1px solid #8b5cf6;border-radius:14px;padding:14px;font-size:14px;line-height:1.5;margin-bottom:22px}
form{display:flex;background:#fff;border-radius:26px;overflow:hidden;margin-bottom:26px}
input{flex:1;border:0;padding:14px 18px;font-size:16px;outline:none;color:#111}button{border:0;background:$accent;color:#fff;padding:0 18px;font-size:15px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.dial{display:flex;flex-direction:column;align-items:center;text-decoration:none;color:#ddd}
.ic{width:52px;height:52px;border-radius:16px;background:#ffffff14;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:$accent}
.lb{font-size:11px;margin-top:6px;text-align:center;overflow:hidden;white-space:nowrap;max-width:72px}
.foot{margin-top:30px;text-align:center;font-size:11px;color:#888}
</style></head><body>
<h1>Quantum <span>Browser</span></h1>
$header
<form action='${esc(engine.url)}' method='get'><input name='${engine.param}' placeholder='Search ${esc(engine.label)} or type a URL' autocomplete='off'><button>Go</button></form>
<div class='grid'>$dialHtml</div>
<div class='foot'>🛡 Shields: ${Shields.ruleCount} filter rules active · ${stats.httpsUpgrades} HTTPS upgrades</div>
</body></html>"""
    }
}
