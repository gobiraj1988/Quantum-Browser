package com.quantum.browser

import android.app.Application
import com.quantum.browser.data.Bookmarks
import com.quantum.browser.data.History
import com.quantum.browser.data.Prefs
import com.quantum.browser.data.Stats
import com.quantum.browser.shields.Shields

class QuantumApp : Application() {

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        stats = Stats(this)
        bookmarks = Bookmarks(this)
        history = History(this)
        Shields.init(this)
    }

    companion object {
        lateinit var prefs: Prefs; private set
        lateinit var stats: Stats; private set
        lateinit var bookmarks: Bookmarks; private set
        lateinit var history: History; private set
    }
}
