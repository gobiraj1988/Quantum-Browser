package com.quantum.browser

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Message
import android.text.InputType
import android.util.Patterns
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebStorage
import android.webkit.WebView
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.BaseAdapter
import android.widget.EditText
import android.widget.Filter
import android.widget.Filterable
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedDispatcher
import com.quantum.browser.ai.QuantumAi
import com.quantum.browser.data.PageEntry
import com.quantum.browser.shields.FilterMatcher
import com.quantum.browser.shields.PrivacyScripts
import com.quantum.browser.shields.Shields
import com.quantum.browser.ui.Ui
import com.quantum.browser.ui.Ui.dp

class MainActivity : Activity(), TabHost {

    private val prefs get() = QuantumApp.prefs
    private val tabs = ArrayList<BrowserTab>()
    private var current: BrowserTab? = null

    private lateinit var root: LinearLayout
    private lateinit var topBar: LinearLayout
    private lateinit var urlBar: AutoCompleteTextView
    private lateinit var siteIcon: TextView
    private lateinit var shieldsBtn: TextView
    private lateinit var progress: ProgressBar
    private lateinit var findBar: LinearLayout
    private lateinit var findInput: EditText
    private lateinit var findCount: TextView
    private lateinit var content: FrameLayout
    private lateinit var fullscreen: FrameLayout
    private lateinit var tabsBtn: TextView
    private lateinit var backBtn: TextView
    private lateinit var fwdBtn: TextView

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    private var pendingGeo: Pair<String, GeolocationPermissions.Callback>? = null

    // ── Lifecycle ────────────────────────────────────────────────────────────────────────────
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        setContentView(root)
        registerBack()

        if (!handleIntent(intent)) restoreTabsOrNew()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onPause() {
        super.onPause()
        current?.webView?.onPause()
        saveTabs()
        QuantumApp.stats.flush()
        CookieManager.getInstance().flush()
    }

    override fun onResume() {
        super.onResume()
        tabs.forEach { it.configure() }   // pick up changes made in Settings
        current?.webView?.onResume()
    }

    override fun onDestroy() {
        if (isFinishing && prefs.clearOnExit) clearBrowsingData(silent = true)
        tabs.forEach { it.destroy() }
        tabs.clear()
        super.onDestroy()
    }

    private fun handleIntent(i: Intent?): Boolean {
        val target = when (i?.action) {
            Intent.ACTION_VIEW -> i.dataString
            Intent.ACTION_SEND -> i.getStringExtra(Intent.EXTRA_TEXT)?.let { toUrl(it) }
            Intent.ACTION_WEB_SEARCH -> i.getStringExtra("query")?.let { prefs.searchEngine.queryUrl(it) }
            else -> null
        } ?: return false
        openInNewTab(target, false)
        return true
    }

    // ── UI construction ──────────────────────────────────────────────────────────────────────
    private fun buildUi() {
        root = Ui.vertical(this).apply { setBackgroundColor(Ui.BG) }

        // Top bar: site security icon · URL field · Shields button
        topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(6), dp(6), dp(6), dp(6))
            setBackgroundColor(Ui.BG)
        }
        siteIcon = Ui.iconButton(this, "🔍", "Site information") { showSiteInfo() }.apply { textSize = 16f }
        urlBar = AutoCompleteTextView(this).apply {
            hint = "Search or enter address"
            setHintTextColor(Ui.MUTED)
            setTextColor(Ui.TEXT)
            textSize = 15f
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_GO
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            background = Ui.rounded(Ui.SURFACE, dp(22).toFloat())
            setPadding(dp(16), dp(10), dp(16), dp(10))
            setSelectAllOnFocus(true)
            threshold = 1
            setDropDownBackgroundDrawable(Ui.rounded(Ui.SURFACE, dp(12).toFloat()))
            setAdapter(SuggestionAdapter())
            onItemClickListener = AdapterView.OnItemClickListener { parent, _, pos, _ ->
                val e = parent.getItemAtPosition(pos) as PageEntry
                navigate(e.url)
            }
            setOnEditorActionListener { v, actionId, event ->
                if (actionId == EditorInfo.IME_ACTION_GO || event?.keyCode == KeyEvent.KEYCODE_ENTER) {
                    navigate(v.text.toString()); true
                } else false
            }
            setOnFocusChangeListener { _, has ->
                if (!has) setText(current?.displayUrl ?: "", false)
            }
        }
        shieldsBtn = Ui.iconButton(this, "🛡", "Shields") { showShieldsPanel() }.apply {
            textSize = 15f
            setTextColor(Color.WHITE)
            setPadding(dp(10), 0, dp(10), 0)
        }
        topBar.addView(siteIcon)
        topBar.addView(urlBar, LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginStart = dp(2); marginEnd = dp(4) })
        topBar.addView(shieldsBtn)
        root.addView(topBar)

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = android.content.res.ColorStateList.valueOf(Ui.ACCENT)
            visibility = View.GONE
        }
        root.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))

        buildFindBar()
        root.addView(findBar)

        val stack = FrameLayout(this)
        content = FrameLayout(this)
        fullscreen = FrameLayout(this).apply { setBackgroundColor(Color.BLACK); visibility = View.GONE }
        stack.addView(content, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        stack.addView(fullscreen, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(stack, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        // Bottom bar like Brave mobile: back · forward · new tab · tabs · menu
        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Ui.BG)
            gravity = Gravity.CENTER_VERTICAL
        }
        backBtn = Ui.iconButton(this, "←", "Back") { current?.webView?.takeIf { it.canGoBack() }?.goBack() }
        fwdBtn = Ui.iconButton(this, "→", "Forward") { current?.webView?.takeIf { it.canGoForward() }?.goForward() }
        val newTab = Ui.iconButton(this, "＋", "New tab") { openInNewTab(null, current?.isPrivate == true) }
        tabsBtn = Ui.iconButton(this, "1", "Tabs") { showTabSwitcher() }.apply {
            textSize = 14f
            background = Ui.rounded(Color.TRANSPARENT, dp(6).toFloat())
        }
        val menu = Ui.iconButton(this, "⋮", "Menu") { showMenu(it) }
        newTab.setOnLongClickListener { openInNewTab(null, true); true }
        listOf(backBtn, fwdBtn, newTab, tabsBtn, menu).forEach {
            bottom.addView(it, LinearLayout.LayoutParams(0, dp(52), 1f))
        }
        root.addView(bottom)

        applyInsets()
    }

    private fun buildFindBar() {
        findBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Ui.SURFACE)
            setPadding(dp(10), dp(4), dp(4), dp(4))
            visibility = View.GONE
        }
        findInput = EditText(this).apply {
            hint = "Find in page"; setHintTextColor(Ui.MUTED); setTextColor(Ui.TEXT); isSingleLine = true
            background = null
            addTextChangedListener(object : android.text.TextWatcher {
                override fun afterTextChanged(s: android.text.Editable?) { current?.webView?.findAllAsync(s.toString()) }
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            })
        }
        findCount = Ui.text(this, "", 13f, Ui.MUTED)
        findBar.addView(findInput, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        findBar.addView(findCount)
        findBar.addView(Ui.iconButton(this, "↑", "Previous match") { current?.webView?.findNext(false) })
        findBar.addView(Ui.iconButton(this, "↓", "Next match") { current?.webView?.findNext(true) })
        findBar.addView(Ui.iconButton(this, "✕", "Close find") { closeFind() })
    }

    /** targetSdk 35+ is edge-to-edge: pad for system bars and the keyboard ourselves. */
    @Suppress("DEPRECATION")
    private fun applyInsets() {
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
    }

    private fun registerBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
        }
    }

    @Deprecated("Used below API 33 only")
    override fun onBackPressed() = handleBack()

    private fun handleBack() {
        val tab = current
        when {
            customView != null -> hideCustomView()
            findBar.visibility == View.VISIBLE -> closeFind()
            tab != null && tab.webView.canGoBack() -> tab.webView.goBack()
            tab != null && tab.isPrivate -> closeTab(tab)
            else -> moveTaskToBack(true)
        }
    }

    // ── Tabs ─────────────────────────────────────────────────────────────────────────────────
    override fun openInNewTab(url: String?, private: Boolean, transport: Message?) {
        val tab = BrowserTab(this, private, prefs, this)
        tabs.add(tab)
        switchTo(tab)
        when {
            transport != null -> {
                (transport.obj as WebView.WebViewTransport).webView = tab.webView
                transport.sendToTarget()
            }
            url != null -> tab.load(url)
            else -> { tab.showNewTab(); urlBar.requestFocus(); showKeyboard() }
        }
    }

    private fun switchTo(tab: BrowserTab) {
        current?.webView?.onPause()
        content.removeAllViews()
        content.addView(tab.webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        current = tab
        tab.webView.onResume()
        refreshChrome()
    }

    private fun closeTab(tab: BrowserTab) {
        val idx = tabs.indexOf(tab)
        tabs.remove(tab)
        content.removeView(tab.webView)
        val wasPrivate = tab.isPrivate
        tab.destroy()
        if (wasPrivate && tabs.none { it.isPrivate }) Toast.makeText(this, "Private session closed", Toast.LENGTH_SHORT).show()
        if (tabs.isEmpty()) { current = null; openInNewTab(null, false); return }
        if (current === tab) switchTo(tabs[(idx - 1).coerceAtLeast(0)]) else refreshChrome()
    }

    private fun saveTabs() {
        val urls = tabs.filter { !it.isPrivate && !it.isNewTab }.map { it.url }
        prefs.sp.edit().putString("open_tabs", urls.joinToString("\n")).apply()
    }

    private fun restoreTabsOrNew() {
        val saved = if (prefs.restoreTabs) prefs.sp.getString("open_tabs", "").orEmpty().lines().filter { it.isNotBlank() } else emptyList()
        if (saved.isEmpty()) { openInNewTab(null, false); return }
        saved.forEach { u ->
            val tab = BrowserTab(this, false, prefs, this)
            tabs.add(tab); tab.load(u)
        }
        switchTo(tabs.last())
    }

    private fun showTabSwitcher() {
        val list = ListView(this)
        var dialog: AlertDialog? = null
        val adapter = object : BaseAdapter() {
            override fun getCount() = tabs.size
            override fun getItem(p: Int) = tabs[p]
            override fun getItemId(p: Int) = tabs[p].id
            override fun getView(p: Int, convertView: View?, parent: ViewGroup?): View {
                val t = tabs[p]
                val row = LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(14), dp(8), dp(4), dp(8))
                    if (t === current) background = Ui.rounded(if (t.isPrivate) Ui.PRIVATE else Ui.SURFACE_2, dp(10).toFloat())
                }
                val labels = Ui.vertical(this@MainActivity)
                labels.addView(Ui.text(this@MainActivity, (if (t.isPrivate) "🕶 " else "") + t.title, 15f).apply { isSingleLine = true })
                labels.addView(Ui.text(this@MainActivity, t.displayUrl.ifEmpty { "New tab" }, 12f, Ui.MUTED).apply { isSingleLine = true })
                row.addView(labels, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                row.addView(Ui.iconButton(this@MainActivity, "✕", "Close tab") {
                    closeTab(t); notifyDataSetChanged()
                    if (tabs.size <= 1) dialog?.dismiss()
                })
                return row
            }
        }
        list.adapter = adapter
        list.setOnItemClickListener { _, _, p, _ -> switchTo(tabs[p]); dialog?.dismiss() }
        dialog = AlertDialog.Builder(this)
            .setTitle("${tabs.size} tabs")
            .setView(list)
            .setPositiveButton("New tab") { _, _ -> openInNewTab(null, false) }
            .setNeutralButton("Private tab") { _, _ -> openInNewTab(null, true) }
            .setNegativeButton("Close all") { _, _ -> tabs.toList().forEach { closeTab(it) } }
            .show()
    }

    // ── Navigation ───────────────────────────────────────────────────────────────────────────
    private fun toUrl(input: String): String {
        val s = input.trim()
        if (s.isEmpty()) return BrowserTab.NEWTAB_URL
        if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("quantum://")) return s
        if (!s.contains(' ') && (Patterns.WEB_URL.matcher(s).matches() || s.startsWith("localhost"))) return "https://$s"
        return prefs.searchEngine.queryUrl(s)
    }

    private fun navigate(input: String) {
        val tab = current ?: return
        tab.load(toUrl(input))
        urlBar.dismissDropDown()
        urlBar.clearFocus()
        hideKeyboard()
    }

    private fun refreshChrome() {
        val tab = current ?: return
        if (!urlBar.hasFocus()) urlBar.setText(tab.displayUrl, false)
        val private = tab.isPrivate
        topBar.setBackgroundColor(if (private) Ui.PRIVATE else Ui.BG)
        root.setBackgroundColor(if (private) Ui.PRIVATE else Ui.BG)   // fills the status-bar inset
        siteIcon.text = when {
            tab.isNewTab -> if (private) "🕶" else "🔍"
            tab.url.startsWith("https://") -> "🔒"
            else -> "⚠"
        }
        tabsBtn.text = if (tabs.size > 99) ":D" else tabs.size.toString()
        backBtn.alpha = if (tab.webView.canGoBack()) 1f else 0.35f
        fwdBtn.alpha = if (tab.webView.canGoForward()) 1f else 0.35f
        onShieldsCount(tab)
    }

    // ── TabHost callbacks ────────────────────────────────────────────────────────────────────
    override fun onTabChanged(tab: BrowserTab) { if (tab === current) refreshChrome() }

    override fun onProgress(tab: BrowserTab, progress: Int) {
        if (tab !== current) return
        this.progress.progress = progress
        this.progress.visibility = if (progress in 1..99) View.VISIBLE else View.GONE
    }

    override fun onShieldsCount(tab: BrowserTab) {
        if (tab !== current) return
        val h = tab.pageHost
        val up = h == null || prefs.shieldsUp(h)
        val n = tab.blockedOnPage.get()
        shieldsBtn.text = if (n > 0) "🛡 $n" else "🛡"
        shieldsBtn.background = Ui.rounded(
            if (!up) Ui.SURFACE_2 else if (tab.isPrivate) Ui.PRIVATE_ACCENT else Ui.ACCENT, dp(18).toFloat())
        shieldsBtn.alpha = if (up) 1f else 0.6f
    }

    override fun onPageFinished(tab: BrowserTab) {
        if (!tab.isPrivate && !tab.isNewTab) QuantumApp.history.add(PageEntry(tab.title, tab.url))
        if (tab === current) refreshChrome()
    }

    override fun onDownload(tab: BrowserTab, url: String, userAgent: String, contentDisposition: String, mimeType: String) {
        val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
        AlertDialog.Builder(this)
            .setTitle("Download file?")
            .setMessage(name)
            .setPositiveButton("Download") { _, _ -> startDownload(url, userAgent, name, mimeType) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun startDownload(url: String, ua: String, name: String, mime: String?) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            Toast.makeText(this, "This download type isn't supported yet", Toast.LENGTH_LONG).show(); return
        }
        runCatching {
            val req = DownloadManager.Request(Uri.parse(url))
                .setTitle(name)
                .setMimeType(mime)
                .addRequestHeader("User-Agent", ua)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            CookieManager.getInstance().getCookie(url)?.let { req.addRequestHeader("Cookie", it) }
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
            Toast.makeText(this, "Downloading $name", Toast.LENGTH_SHORT).show()
        }.onFailure { Toast.makeText(this, "Download failed: ${it.message}", Toast.LENGTH_LONG).show() }
    }

    @Suppress("DEPRECATION")
    override fun showCustomView(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (customView != null) { callback.onCustomViewHidden(); return }
        customView = view; customViewCallback = callback
        fullscreen.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        fullscreen.visibility = View.VISIBLE
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    @Suppress("DEPRECATION")
    override fun hideCustomView() {
        val v = customView ?: return
        fullscreen.removeView(v)
        fullscreen.visibility = View.GONE
        customView = null
        customViewCallback?.onCustomViewHidden(); customViewCallback = null
        if (Build.VERSION.SDK_INT >= 30) window.insetsController?.show(WindowInsets.Type.systemBars())
        else window.decorView.systemUiVisibility = 0
    }

    override fun showFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        fileCallback?.onReceiveValue(null)
        fileCallback = callback
        return try {
            startActivityForResult(params.createIntent(), REQ_FILE); true
        } catch (e: ActivityNotFoundException) {
            fileCallback = null; false
        }
    }

    @Deprecated("Framework Activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        } else super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onSitePermission(tab: BrowserTab, request: PermissionRequest) {
        val wanted = request.resources.filter {
            it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
        }
        if (wanted.isEmpty()) { request.deny(); return }
        val what = wanted.joinToString(" and ") { if (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE) "camera" else "microphone" }
        AlertDialog.Builder(this)
            .setTitle("${request.origin.host} wants to use your $what")
            .setPositiveButton("Allow") { _, _ ->
                val perms = wanted.map {
                    if (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE) Manifest.permission.CAMERA else Manifest.permission.RECORD_AUDIO
                }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                if (perms.isEmpty()) request.grant(wanted.toTypedArray())
                else { pendingPermission = request; requestPermissions(perms.toTypedArray(), REQ_MEDIA) }
            }
            .setNegativeButton("Block") { _, _ -> request.deny() }
            .setOnCancelListener { request.deny() }
            .show()
    }

    override fun onGeolocation(origin: String, callback: GeolocationPermissions.Callback) {
        AlertDialog.Builder(this)
            .setTitle("${Uri.parse(origin).host ?: origin} wants your location")
            .setPositiveButton("Allow") { _, _ ->
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) callback.invoke(origin, true, false)
                else { pendingGeo = origin to callback; requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), REQ_GEO) }
            }
            .setNegativeButton("Block") { _, _ -> callback.invoke(origin, false, false) }
            .setOnCancelListener { callback.invoke(origin, false, false) }
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        val granted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        when (requestCode) {
            REQ_MEDIA -> pendingPermission?.let { r ->
                if (granted) r.grant(r.resources.filter { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }.toTypedArray())
                else r.deny()
                pendingPermission = null
            }
            REQ_GEO -> pendingGeo?.let { (o, cb) ->
                cb.invoke(o, grantResults.any { it == PackageManager.PERMISSION_GRANTED }, false); pendingGeo = null
            }
        }
    }

    override fun onLongPress(tab: BrowserTab, result: WebView.HitTestResult) {
        val link = result.extra ?: return
        val isImage = result.type == WebView.HitTestResult.IMAGE_TYPE || result.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE
        val options = mutableListOf("Open in new tab", "Open in private tab", "Copy link", "Share link")
        if (isImage) options += "Download image"
        AlertDialog.Builder(this)
            .setTitle(link.take(120))
            .setItems(options.toTypedArray()) { _, which ->
                when (options[which]) {
                    "Open in new tab" -> { openInNewTab(link, false); }
                    "Open in private tab" -> openInNewTab(link, true)
                    "Copy link" -> copy(link)
                    "Share link" -> share(link, link)
                    "Download image" -> startDownload(link, tab.webView.settings.userAgentString,
                        URLUtil.guessFileName(link, null, null), null)
                }
            }.show()
    }

    override fun onSslError(tab: BrowserTab, url: String) {
        AlertDialog.Builder(this)
            .setTitle("Connection not secure")
            .setMessage("The certificate for ${Uri.parse(url).host} is not valid, so Quantum stopped loading it to protect you.")
            .setPositiveButton("OK", null)
            .show()
    }

    override fun launchExternal(uri: Uri): Boolean {
        return try {
            val intent = if (uri.scheme == "intent") Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).apply {
                addCategory(Intent.CATEGORY_BROWSABLE); component = null; selector = null
            } else Intent(Intent.ACTION_VIEW, uri)
            startActivity(intent); true
        } catch (e: Exception) {
            // intent:// links usually carry a browser fallback URL
            if (uri.scheme == "intent") runCatching {
                Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url")
            }.getOrNull()?.let { current?.load(it) }
            true
        }
    }

    // ── Shields panel ────────────────────────────────────────────────────────────────────────
    private fun showShieldsPanel() {
        val tab = current ?: return
        val h = tab.pageHost
        val box = Ui.vertical(this, 4)
        if (h == null) {
            box.addView(Ui.text(this, "Shields protect every site you visit.\n${Shields.ruleCount} filter rules active.", 15f).apply { setPadding(dp(18), dp(8), dp(18), dp(8)) })
        } else {
            val site = FilterMatcher.registrableDomain(h)
            box.addView(Ui.text(this, site, 20f, bold = true).apply { setPadding(dp(18), dp(4), dp(18), 0) })
            box.addView(Ui.text(this, "${tab.blockedOnPage.get()} trackers, ads & pop-ups blocked on this page", 13f, Ui.MUTED).apply { setPadding(dp(18), 0, dp(18), dp(8)) })
            box.addView(Ui.switchRow(this, "Shields for this site", if (prefs.shieldsUp(h)) "UP — blocking trackers & ads" else "DOWN — site may track you", prefs.shieldsUp(h)) {
                prefs.setShieldsUp(h, it); tab.reload()
            })
            box.addView(Ui.switchRow(this, "Block scripts on this site", "Strongest protection; may break pages", prefs.blockScripts(h)) {
                prefs.setBlockScripts(h, it); tab.load(tab.url)
            })
        }
        box.addView(Ui.header(this, "Global Shields"))
        val modes = FilterMatcher.Mode.values()
        box.addView(Ui.valueRow(this, "Trackers & ads blocking", modeLabel(prefs.adBlockMode)) { v ->
            AlertDialog.Builder(this).setTitle("Trackers & ads blocking")
                .setSingleChoiceItems(modes.map { modeLabel(it) }.toTypedArray(), prefs.adBlockMode.ordinal) { d, i ->
                    prefs.adBlockMode = modes[i]; v.text = modeLabel(modes[i]); d.dismiss(); tab.reload()
                }.show()
        })
        box.addView(Ui.switchRow(this, "Upgrade connections to HTTPS", null, prefs.httpsUpgrade) { prefs.httpsUpgrade = it })
        box.addView(Ui.switchRow(this, "Block fingerprinting", "Randomises canvas, audio & hardware info", prefs.fingerprintProtection) { prefs.fingerprintProtection = it })
        box.addView(Ui.switchRow(this, "Block cross-site cookies", null, prefs.blockThirdPartyCookies) {
            prefs.blockThirdPartyCookies = it; tabs.forEach { t -> t.configure() }
        })
        box.addView(Ui.switchRow(this, "Hide cookie consent banners", null, prefs.hideCookieBanners) { prefs.hideCookieBanners = it })
        box.addView(Ui.switchRow(this, "Block pop-ups", null, prefs.blockPopups) { prefs.blockPopups = it; tabs.forEach { t -> t.configure() } })
        AlertDialog.Builder(this).setView(ScrollView(this).apply { addView(box) }).setPositiveButton("Done", null).show()
    }

    private fun modeLabel(m: FilterMatcher.Mode) = when (m) {
        FilterMatcher.Mode.OFF -> "Off"
        FilterMatcher.Mode.STANDARD -> "Standard (recommended)"
        FilterMatcher.Mode.AGGRESSIVE -> "Aggressive (also blocks first-party trackers)"
    }

    private fun showSiteInfo() {
        val tab = current ?: return
        if (tab.isNewTab) { urlBar.requestFocus(); showKeyboard(); return }
        val secure = tab.url.startsWith("https://")
        AlertDialog.Builder(this)
            .setTitle(Uri.parse(tab.url).host)
            .setMessage(if (secure) "🔒 Connection is secure (HTTPS). Information you send is private." else "⚠ Connection is not secure. Don't enter passwords or payment details.")
            .setPositiveButton("OK", null)
            .setNeutralButton("Shields") { _, _ -> showShieldsPanel() }
            .show()
    }

    // ── Main menu ────────────────────────────────────────────────────────────────────────────
    private fun showMenu(anchor: View) {
        val tab = current ?: return
        val pm = PopupMenu(this, anchor)
        val m = pm.menu
        m.add(0, 1, 0, "New tab"); m.add(0, 2, 0, "New private tab")
        m.add(0, 3, 0, if (QuantumApp.bookmarks.contains(tab.url)) "Remove bookmark" else "Add bookmark").isEnabled = !tab.isNewTab
        m.add(0, 4, 0, "Bookmarks"); m.add(0, 5, 0, "History"); m.add(0, 6, 0, "Downloads")
        m.add(0, 7, 0, "Find in page").isEnabled = !tab.isNewTab
        m.add(0, 8, 0, if (tab.readerMode) "Exit reader mode" else "Reader mode").isEnabled = !tab.isNewTab
        m.add(0, 9, 0, "Quantum AI: summarize page").isEnabled = !tab.isNewTab
        m.add(0, 10, 0, "Quantum AI: ask about page").isEnabled = !tab.isNewTab
        m.add(0, 11, 0, "Desktop site").apply { isCheckable = true; isChecked = tab.desktopMode }
        m.add(0, 12, 0, "Night mode for pages").apply { isCheckable = true; isChecked = prefs.nightMode }
        m.add(0, 13, 0, "Share").isEnabled = !tab.isNewTab
        m.add(0, 14, 0, "Reload")
        m.add(0, 15, 0, "Clear browsing data")
        m.add(0, 16, 0, "Settings")
        pm.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> openInNewTab(null, false)
                2 -> openInNewTab(null, true)
                3 -> toggleBookmark(tab)
                4 -> showPageList("Bookmarks", QuantumApp.bookmarks)
                5 -> showPageList("History", QuantumApp.history)
                6 -> runCatching { startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)) }
                7 -> openFind()
                8 -> toggleReader(tab)
                9 -> askAi(tab, "Summarize this page.")
                10 -> promptAiQuestion(tab)
                11 -> tab.setDesktop(!tab.desktopMode)
                12 -> { prefs.nightMode = !prefs.nightMode; tabs.forEach { it.applyNightMode() } }
                13 -> share(tab.title, tab.url)
                14 -> tab.reload()
                15 -> confirmClearData()
                16 -> startActivity(Intent(this, SettingsActivity::class.java))
            }
            true
        }
        pm.show()
    }

    private fun toggleBookmark(tab: BrowserTab) {
        if (QuantumApp.bookmarks.contains(tab.url)) {
            QuantumApp.bookmarks.remove(tab.url); toast("Bookmark removed")
        } else {
            QuantumApp.bookmarks.add(PageEntry(tab.title, tab.url)); toast("Bookmarked")
        }
    }

    private fun showPageList(title: String, store: com.quantum.browser.data.PageStore) {
        val items = store.all()
        if (items.isEmpty()) { toast("No $title yet".lowercase().replaceFirstChar { it.uppercase() }); return }
        val adapter = object : ArrayAdapter<PageEntry>(this, android.R.layout.simple_list_item_2, android.R.id.text1, items) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = super.getView(position, convertView, parent)
                val e = items[position]
                v.findViewById<TextView>(android.R.id.text1).apply { text = e.title.ifBlank { e.url }; isSingleLine = true }
                v.findViewById<TextView>(android.R.id.text2).apply { text = e.url; isSingleLine = true; setTextColor(Ui.MUTED) }
                return v
            }
        }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setAdapter(adapter) { _, which -> current?.load(items[which].url) }
            .setNegativeButton("Clear all") { _, _ ->
                AlertDialog.Builder(this).setMessage("Delete all ${title.lowercase()}?")
                    .setPositiveButton("Delete") { _, _ -> store.clear() }.setNegativeButton("Cancel", null).show()
            }
            .setPositiveButton("Close", null)
            .show()
    }

    private fun openFind() {
        findBar.visibility = View.VISIBLE
        findInput.requestFocus(); showKeyboard()
        current?.webView?.setFindListener { active, count, _ -> findCount.text = if (count == 0) "0/0" else "${active + 1}/$count" }
    }

    private fun closeFind() {
        findBar.visibility = View.GONE
        findInput.setText("")
        current?.webView?.clearMatches()
        hideKeyboard()
    }

    private fun toggleReader(tab: BrowserTab) {
        if (tab.readerMode) { tab.readerMode = false; tab.webView.reload(); return }
        tab.webView.evaluateJavascript(PrivacyScripts.READER_MODE) { r ->
            if (r.contains("ok")) tab.readerMode = true else toast("Reader mode isn't available for this page")
        }
    }

    // ── Quantum AI (Leo-style assistant) ────────────────────────────────────────────────────
    private fun promptAiQuestion(tab: BrowserTab) {
        val input = EditText(this).apply { hint = "Ask anything about this page"; setPadding(dp(20), dp(12), dp(20), dp(12)) }
        AlertDialog.Builder(this).setTitle("Quantum AI").setView(input)
            .setPositiveButton("Ask") { _, _ -> input.text.toString().takeIf { it.isNotBlank() }?.let { askAi(tab, it) } }
            .setNegativeButton("Cancel", null).show()
    }

    private fun askAi(tab: BrowserTab, question: String) {
        val key = prefs.aiApiKey
        if (key.isBlank()) {
            AlertDialog.Builder(this).setTitle("Quantum AI")
                .setMessage("Add your Anthropic API key in Settings → Quantum AI to use the page assistant. Page text is only sent when you ask.")
                .setPositiveButton("Open settings") { _, _ -> startActivity(Intent(this, SettingsActivity::class.java)) }
                .setNegativeButton("Cancel", null).show()
            return
        }
        val waiting = AlertDialog.Builder(this).setTitle("Quantum AI").setMessage("Thinking…").setCancelable(true).show()
        tab.webView.evaluateJavascript(PrivacyScripts.PAGE_TEXT) { raw ->
            val text = runCatching { org.json.JSONArray("[$raw]").getString(0) }.getOrDefault("")
            QuantumAi.ask(key, text, question) { result ->
                if (!waiting.isShowing) return@ask
                waiting.dismiss()
                val answer = result.getOrElse { "⚠ ${it.message}" }
                AlertDialog.Builder(this).setTitle("Quantum AI")
                    .setMessage(answer)
                    .setPositiveButton("Close", null)
                    .setNeutralButton("Copy") { _, _ -> copy(answer) }
                    .show()
            }
        }
    }

    // ── Data ─────────────────────────────────────────────────────────────────────────────────
    private fun confirmClearData() {
        AlertDialog.Builder(this).setTitle("Clear browsing data?")
            .setMessage("Deletes history, cookies, site data and cache. Bookmarks are kept.")
            .setPositiveButton("Clear") { _, _ -> clearBrowsingData(silent = false) }
            .setNegativeButton("Cancel", null).show()
    }

    fun clearBrowsingData(silent: Boolean) {
        QuantumApp.history.clear()
        CookieManager.getInstance().removeAllCookies(null)
        WebStorage.getInstance().deleteAllData()
        tabs.forEach { it.webView.clearCache(true); it.webView.clearHistory(); it.webView.clearFormData() }
        if (!silent) toast("Browsing data cleared")
    }

    private fun copy(s: String) {
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("text", s))
        if (Build.VERSION.SDK_INT < 33) toast("Copied")
    }

    private fun share(subject: String, url: String) {
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"; putExtra(Intent.EXTRA_SUBJECT, subject); putExtra(Intent.EXTRA_TEXT, url)
        }, "Share"))
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    private fun showKeyboard() {
        val v = currentFocus ?: urlBar
        v.post { (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(v, InputMethodManager.SHOW_IMPLICIT) }
    }

    private fun hideKeyboard() {
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(root.windowToken, 0)
    }

    /** URL-bar suggestions from bookmarks first, then history. */
    private inner class SuggestionAdapter : BaseAdapter(), Filterable {
        private var items: List<PageEntry> = emptyList()
        override fun getCount() = items.size
        override fun getItem(position: Int) = items[position]
        override fun getItemId(position: Int) = position.toLong()
        override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
            val e = items[position]
            return Ui.vertical(this@MainActivity).apply {
                setPadding(dp(16), dp(10), dp(16), dp(10))
                addView(Ui.text(this@MainActivity, e.title.ifBlank { e.url }, 15f).apply { isSingleLine = true })
                addView(Ui.text(this@MainActivity, e.url, 12f, Ui.MUTED).apply { isSingleLine = true })
            }
        }
        override fun getFilter() = object : Filter() {
            override fun performFiltering(c: CharSequence?): FilterResults {
                val q = c?.toString().orEmpty()
                val list = if (q.isBlank()) emptyList()
                else (QuantumApp.bookmarks.search(q, 3) + QuantumApp.history.search(q, 6)).distinctBy { it.url }
                return FilterResults().apply { values = list; count = list.size }
            }
            @Suppress("UNCHECKED_CAST")
            override fun publishResults(c: CharSequence?, r: FilterResults?) {
                items = (r?.values as? List<PageEntry>).orEmpty(); notifyDataSetChanged()
            }
            override fun convertResultToString(resultValue: Any?) = (resultValue as? PageEntry)?.url ?: ""
        }
    }

    companion object {
        private const val REQ_FILE = 101
        private const val REQ_MEDIA = 102
        private const val REQ_GEO = 103
    }
}
