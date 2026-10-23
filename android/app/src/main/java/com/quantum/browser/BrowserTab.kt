package com.quantum.browser

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.View
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import com.quantum.browser.data.Prefs
import com.quantum.browser.shields.FilterMatcher
import com.quantum.browser.shields.PrivacyScripts
import com.quantum.browser.shields.Shields
import java.io.ByteArrayInputStream
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import kotlin.random.Random

/** Callbacks from a tab to the browser UI. All are invoked on the main thread. */
interface TabHost {
    fun onTabChanged(tab: BrowserTab)
    fun onProgress(tab: BrowserTab, progress: Int)
    fun onShieldsCount(tab: BrowserTab)
    fun onPageFinished(tab: BrowserTab)
    fun openInNewTab(url: String?, private: Boolean, transport: Message? = null)
    fun onDownload(tab: BrowserTab, url: String, userAgent: String, contentDisposition: String, mimeType: String)
    fun showCustomView(view: View, callback: WebChromeClient.CustomViewCallback)
    fun hideCustomView()
    fun showFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean
    fun onSitePermission(tab: BrowserTab, request: PermissionRequest)
    fun onGeolocation(origin: String, callback: GeolocationPermissions.Callback)
    fun onLongPress(tab: BrowserTab, result: WebView.HitTestResult)
    fun onSslError(tab: BrowserTab, url: String)
    fun launchExternal(uri: Uri): Boolean
}

@SuppressLint("SetJavaScriptEnabled")
class BrowserTab(
    context: Context,
    val isPrivate: Boolean,
    private val prefs: Prefs,
    private val host: TabHost,
) {
    val id: Long = nextId.incrementAndGet().toLong()
    val webView = WebView(context)

    var title: String = "New tab"; private set
    var url: String = NEWTAB_URL; private set
    var favicon: Bitmap? = null; private set
    var desktopMode = prefs.desktopModeDefault
    var readerMode = false
    val blockedOnPage = AtomicInteger(0)

    /** Host of the current top-level page; read from the network thread. */
    @Volatile var pageHost: String? = null; private set
    @Volatile private var pendingUpgradeHost: String? = null
    private val fingerprintSeed = Random.nextInt(1, 1_000_000)
    private val main = Handler(Looper.getMainLooper())
    private val mobileUa = WebSettings.getDefaultUserAgent(context)
        .replace("; wv", "").replace(Regex("Version/\\d+\\.\\d+ "), "")

    val isNewTab get() = url == NEWTAB_URL || url.startsWith("about:blank")
    val displayUrl get() = if (isNewTab) "" else url

    init {
        configure()
        webView.webViewClient = ShieldsClient()
        webView.webChromeClient = ChromeClient()
        webView.setDownloadListener { u, ua, cd, mime, _ -> host.onDownload(this, u, ua, cd, mime) }
        webView.setOnLongClickListener {
            val r = webView.hitTestResult
            if (r.type == WebView.HitTestResult.SRC_ANCHOR_TYPE || r.type == WebView.HitTestResult.IMAGE_TYPE ||
                r.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) { host.onLongPress(this, r); true } else false
        }
    }

    @Suppress("DEPRECATION")
    fun configure() {
        val s = webView.settings
        s.javaScriptEnabled = pageHost?.let { !(prefs.shieldsUp(it) && prefs.blockScripts(it)) } ?: true
        s.domStorageEnabled = true
        s.databaseEnabled = !isPrivate
        s.mediaPlaybackRequiresUserGesture = true
        s.setSupportZoom(true); s.builtInZoomControls = true; s.displayZoomControls = false
        s.loadWithOverviewMode = true
        s.useWideViewPort = true
        s.setSupportMultipleWindows(true)
        s.javaScriptCanOpenWindowsAutomatically = !prefs.blockPopups
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.safeBrowsingEnabled = true
        s.cacheMode = if (isPrivate) WebSettings.LOAD_NO_CACHE else WebSettings.LOAD_DEFAULT
        s.saveFormData = !isPrivate
        s.userAgentString = if (desktopMode) DESKTOP_UA else mobileUa
        applyNightMode()
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, !prefs.blockThirdPartyCookies)
        webView.setBackgroundColor(Color.parseColor("#17171b"))
    }

    @Suppress("DEPRECATION")
    fun applyNightMode() {
        val s = webView.settings
        if (Build.VERSION.SDK_INT >= 33) s.isAlgorithmicDarkeningAllowed = prefs.nightMode
        else s.forceDark = if (prefs.nightMode) WebSettings.FORCE_DARK_ON else WebSettings.FORCE_DARK_OFF
    }

    fun setDesktop(on: Boolean) {
        desktopMode = on
        webView.settings.userAgentString = if (on) DESKTOP_UA else mobileUa
        if (!isNewTab) webView.reload()
    }

    /** Navigate from the URL bar / new-tab page. Applies HTTPS upgrade and privacy headers. */
    fun load(raw: String) {
        readerMode = false
        if (raw == NEWTAB_URL) { showNewTab(); return }
        val target = upgrade(raw)
        Uri.parse(target).host?.let { beforeNavigate(it) }
        webView.loadUrl(target, headers())
    }

    fun showNewTab() {
        url = NEWTAB_URL; title = if (isPrivate) "Private tab" else "New tab"; pageHost = null
        blockedOnPage.set(0)
        webView.loadDataWithBaseURL(NEWTAB_URL, NewTabPage.html(webView.context, prefs, isPrivate), "text/html", "utf-8", NEWTAB_URL)
        host.onTabChanged(this); host.onShieldsCount(this)
    }

    fun reload() = if (isNewTab) showNewTab() else webView.reload()

    fun destroy() {
        if (isPrivate) { webView.clearHistory(); webView.clearCache(true); webView.clearFormData() }
        webView.stopLoading(); webView.destroy()
    }

    private fun headers(): Map<String, String> =
        if (prefs.sendGpc) mapOf("Sec-GPC" to "1", "DNT" to "1") else emptyMap()

    private fun upgrade(u: String): String {
        if (!prefs.httpsUpgrade || !u.startsWith("http://")) return u
        val h = Uri.parse(u).host ?: return u
        if (h in httpFallbackHosts || isLocal(h)) return u
        pendingUpgradeHost = h
        QuantumApp.stats.addHttpsUpgrade()
        return "https://" + u.removePrefix("http://")
    }

    private fun beforeNavigate(h: String) {
        pageHost = h
        blockedOnPage.set(0)
        val shieldsUp = prefs.shieldsUp(h)
        webView.settings.javaScriptEnabled = !(shieldsUp && prefs.blockScripts(h))
        host.onShieldsCount(this)
    }

    private fun injectEarly(view: WebView, h: String?) {
        if (h == null || !prefs.shieldsUp(h)) return
        if (prefs.fingerprintProtection) view.evaluateJavascript(PrivacyScripts.fingerprint(fingerprintSeed), null)
        if (prefs.blockWebRtcLeak) view.evaluateJavascript(PrivacyScripts.WEBRTC_PROTECT, null)
        if (prefs.sendGpc) view.evaluateJavascript(PrivacyScripts.GPC, null)
    }

    private fun injectLate(view: WebView, h: String?) {
        if (h == null || !prefs.shieldsUp(h)) return
        if (prefs.cosmeticFiltering) view.evaluateJavascript(PrivacyScripts.COSMETIC, null)
        if (prefs.hideCookieBanners) view.evaluateJavascript(PrivacyScripts.COOKIE_BANNERS, null)
    }

    // ── Shields: network blocking, HTTPS upgrade, script injection ───────────────────────────
    private inner class ShieldsClient : WebViewClient() {

        private val empty = ByteArray(0)

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (request.isForMainFrame) return null
            val page = pageHost ?: return null
            val reqHost = request.url.host ?: return null
            if (!prefs.shieldsUp(page)) return null
            if (!Shields.matcher.shouldBlock(reqHost, page, prefs.adBlockMode)) return null
            blockedOnPage.incrementAndGet()
            QuantumApp.stats.addBlocked()
            main.post { host.onShieldsCount(this@BrowserTab) }
            return WebResourceResponse("text/plain", "utf-8", 403, "Blocked by Shields", emptyMap(), ByteArrayInputStream(empty))
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            val scheme = uri.scheme?.lowercase() ?: return false
            if (scheme != "http" && scheme != "https") {
                if (scheme == "about" || scheme == "data" || scheme == "blob" || scheme == "javascript") return false
                return host.launchExternal(uri)   // tel:, mailto:, intent:, market:, app links …
            }
            if (!request.isForMainFrame) return false
            val s = uri.toString()
            // Site redirected our HTTPS upgrade back to HTTP: it has no working HTTPS, stop upgrading it.
            if (request.isRedirect && scheme == "http" && uri.host != null && uri.host == pendingUpgradeHost) {
                pendingUpgradeHost = null
                httpFallbackHosts.add(uri.host!!)
            }
            val upgraded = upgrade(s)
            uri.host?.let { beforeNavigate(it) }
            if (upgraded != s) { view.loadUrl(upgraded, headers()); return true }
            return false
        }

        override fun onPageStarted(view: WebView, u: String, icon: Bitmap?) {
            if (u.startsWith("data:")) return
            if (u == NEWTAB_URL) {   // e.g. navigating back to the new tab page
                url = u; pageHost = null; favicon = null; blockedOnPage.set(0)
                title = if (isPrivate) "Private tab" else "New tab"
                host.onTabChanged(this@BrowserTab); host.onShieldsCount(this@BrowserTab)
                return
            }
            url = u
            favicon = icon
            val h = Uri.parse(u).host
            if (h != pageHost) { pageHost = h; blockedOnPage.set(0) }
            injectEarly(view, h)
            host.onTabChanged(this@BrowserTab); host.onShieldsCount(this@BrowserTab)
        }

        override fun onPageCommitVisible(view: WebView, u: String) {
            injectEarly(view, pageHost); injectLate(view, pageHost)
        }

        override fun onPageFinished(view: WebView, u: String) {
            if (u.startsWith("data:")) return
            if (u != NEWTAB_URL) url = u
            injectLate(view, pageHost)
            view.title?.takeIf { it.isNotBlank() && !it.startsWith("data:") }?.let { title = it }
            if (pendingUpgradeHost == Uri.parse(u).host) pendingUpgradeHost = null
            host.onTabChanged(this@BrowserTab); host.onPageFinished(this@BrowserTab)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            // HTTPS upgrade failed for this host → fall back to plain HTTP once, like Brave.
            val h = request.url.host
            if (request.isForMainFrame && request.url.scheme == "https" && h != null && h == pendingUpgradeHost) {
                pendingUpgradeHost = null
                httpFallbackHosts.add(h)
                view.loadUrl(request.url.toString().replaceFirst("https://", "http://"), headers())
            }
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()   // never silently proceed on a bad certificate
            host.onSslError(this@BrowserTab, error.url)
        }
    }

    private inner class ChromeClient : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) = host.onProgress(this@BrowserTab, newProgress)

        override fun onReceivedTitle(view: WebView, t: String?) {
            if (!t.isNullOrBlank() && !isNewTab && !t.startsWith("data:")) { title = t; host.onTabChanged(this@BrowserTab) }
        }

        override fun onReceivedIcon(view: WebView, icon: Bitmap?) { favicon = icon; host.onTabChanged(this@BrowserTab) }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (prefs.blockPopups && !isUserGesture) {
                blockedOnPage.incrementAndGet(); host.onShieldsCount(this@BrowserTab)
                return false
            }
            host.openInNewTab(null, isPrivate, resultMsg)
            return true
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) = host.showCustomView(view, callback)
        override fun onHideCustomView() = host.hideCustomView()

        override fun onShowFileChooser(webView: WebView, filePathCallback: ValueCallback<Array<Uri>>, fileChooserParams: FileChooserParams) =
            host.showFileChooser(filePathCallback, fileChooserParams)

        override fun onPermissionRequest(request: PermissionRequest) = host.onSitePermission(this@BrowserTab, request)

        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) =
            host.onGeolocation(origin, callback)
    }

    companion object {
        const val NEWTAB_URL = "quantum://newtab/"
        const val DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
        private val nextId = AtomicInteger(0)

        /** Hosts whose HTTPS upgrade failed this session. */
        val httpFallbackHosts: MutableSet<String> = Collections.synchronizedSet(HashSet())

        fun isLocal(h: String) = h == "localhost" || h.endsWith(".local") || h.matches(Regex("^[0-9.:]+$"))
    }
}
