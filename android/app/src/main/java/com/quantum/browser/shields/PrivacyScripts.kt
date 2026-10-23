package com.quantum.browser.shields

/** JavaScript/CSS payloads injected into pages. Every script is idempotent (guarded by a flag). */
object PrivacyScripts {

    /**
     * Brave-style fingerprint "farbling": small per-session random noise on canvas/audio reads and
     * generic values for hardware APIs, so trackers get a different fingerprint every session.
     */
    fun fingerprint(seed: Int) = """
(function(){
  if (window.__qbFp) return; window.__qbFp = 1;
  var seed = $seed;
  function rnd(i){ var x = Math.sin(seed + i) * 10000; return x - Math.floor(x); }
  try {
    var toDataURL = HTMLCanvasElement.prototype.toDataURL;
    var getImageData = CanvasRenderingContext2D.prototype.getImageData;
    function noisify(ctx, w, h){
      try { var d = getImageData.call(ctx, 0, 0, Math.min(w,16), Math.min(h,16));
        for (var i = 0; i < d.data.length; i += 4) d.data[i] = d.data[i] ^ (rnd(i) > 0.5 ? 1 : 0);
        ctx.putImageData(d, 0, 0); } catch(e){}
    }
    HTMLCanvasElement.prototype.toDataURL = function(){
      var c = this.getContext && this.getContext('2d'); if (c && this.width && this.height) noisify(c, this.width, this.height);
      return toDataURL.apply(this, arguments);
    };
    CanvasRenderingContext2D.prototype.getImageData = function(x,y,w,h){
      var d = getImageData.apply(this, arguments);
      for (var i = 0; i < d.data.length; i += 97) d.data[i] = d.data[i] ^ 1;
      return d;
    };
  } catch(e){}
  try {
    var gp = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p){
      if (p === 37445) return 'Quantum'; if (p === 37446) return 'Quantum WebGL';
      return gp.apply(this, arguments);
    };
  } catch(e){}
  try {
    var gcd = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function(){
      var d = gcd.apply(this, arguments);
      for (var i = 0; i < d.length; i += 500) d[i] = d[i] + rnd(i) * 1e-7;
      return d;
    };
  } catch(e){}
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: function(){ return 4; } });
    Object.defineProperty(navigator, 'deviceMemory', { get: function(){ return 4; } });
    Object.defineProperty(navigator, 'plugins', { get: function(){ return []; } });
    if (navigator.getBattery) navigator.getBattery = undefined;
  } catch(e){}
})();
""".trimIndent()

    /** Forces WebRTC through relay servers so the device's real/local IP is not exposed. */
    const val WEBRTC_PROTECT = """
(function(){
  if (window.__qbRtc || !window.RTCPeerConnection) return; window.__qbRtc = 1;
  var Orig = window.RTCPeerConnection;
  window.RTCPeerConnection = function(cfg, c){ cfg = cfg || {}; cfg.iceTransportPolicy = 'relay'; return new Orig(cfg, c); };
  window.RTCPeerConnection.prototype = Orig.prototype;
})();
"""

    /** Global Privacy Control signal (also sent as the Sec-GPC header). */
    const val GPC = """
(function(){ try { Object.defineProperty(navigator, 'globalPrivacyControl', { get: function(){ return true; } }); } catch(e){} })();
"""

    private const val COSMETIC_CSS =
        "ins.adsbygoogle,.adsbygoogle,[id^='google_ads_'],[id^='div-gpt-ad'],iframe[src*='doubleclick.net']," +
        "iframe[src*='googlesyndication'],.ad-banner,.ad-container,.ad-slot,.adbox,.ad-wrapper,.advertisement," +
        "[class*='sponsored-content'],.taboola,#taboola-below-article,[id^='taboola-'],.OUTBRAIN,[data-widget-id^='outbrain']," +
        "amp-ad,amp-embed,.mgid,[id^='mgid_'],.revcontent,[aria-label='Advertisement'],.sticky-ad,.adsense" +
        "{display:none!important;visibility:hidden!important;height:0!important}"

    private const val COOKIE_BANNER_CSS =
        "#onetrust-banner-sdk,#onetrust-consent-sdk,.onetrust-pc-dark-filter,#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay," +
        ".fc-consent-root,#qc-cmp2-container,.qc-cmp2-container,.cc-window,.cc-banner,#cookie-law-info-bar,#didomi-host," +
        "#usercentrics-root,.cmp-root,#cmpbox,#cmpbox2,.cookie-notice,#cookie-notice,#cookieConsent,.cookie-consent," +
        "#gdpr-cookie-message,.truste_box_overlay,#truste-consent-track,[id^='sp_message_container']" +
        "{display:none!important}" +
        "html,body{overflow:auto!important}"

    private fun injectCss(id: String, css: String) = """
(function(){
  if (document.getElementById('$id')) return;
  var s = document.createElement('style'); s.id = '$id'; s.textContent = ${jsString(css)};
  (document.head || document.documentElement).appendChild(s);
})();
"""

    val COSMETIC = injectCss("__qb_cosmetic", COSMETIC_CSS)
    val COOKIE_BANNERS = injectCss("__qb_cookies", COOKIE_BANNER_CSS)

    /** Simple readability: keeps the densest block of paragraphs and restyles it. */
    const val READER_MODE = """
(function(){
  var best = null, bestScore = 0;
  document.querySelectorAll('article, main, section, div').forEach(function(el){
    var ps = el.querySelectorAll(':scope > p, :scope > div > p');
    var score = 0; ps.forEach(function(p){ score += p.innerText.length; });
    if (score > bestScore) { bestScore = score; best = el; }
  });
  if (!best || bestScore < 400) return 'none';
  var title = document.title;
  var h = document.querySelector('h1'); if (h) title = h.innerText;
  var parts = [];
  best.querySelectorAll('h2, h3, p, img, blockquote, ul, ol, pre').forEach(function(n){
    if (n.tagName === 'IMG') { if (n.src && n.naturalWidth > 200) parts.push('<img src="' + n.src + '">'); }
    else parts.push('<' + n.tagName.toLowerCase() + '>' + n.innerHTML + '</' + n.tagName.toLowerCase() + '>');
  });
  document.documentElement.innerHTML = '<head><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title>' +
   '<style>body{max-width:720px;margin:0 auto;padding:20px 18px 80px;font:19px/1.7 Georgia,serif;background:#1b1b1f;color:#e7e7ea}' +
   'h1{font:700 28px/1.3 sans-serif}img{max-width:100%;height:auto;border-radius:8px}a{color:#ff7a50}pre{overflow:auto}' +
   'blockquote{border-left:3px solid #fb542b;margin:0;padding-left:14px;color:#bbb}</style></head>' +
   '<body><h1>' + title + '</h1>' + parts.join('') + '</body>';
  return 'ok';
})();
"""

    /** Visible page text for the AI assistant, capped to keep requests small. */
    const val PAGE_TEXT = "(function(){ return (document.title + '\\n\\n' + (document.body ? document.body.innerText : '')).substring(0, 15000); })();"

    fun jsString(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) when (c) {
            '\\' -> sb.append("\\\\"); '"' -> sb.append("\\\""); '\n' -> sb.append("\\n"); '\r' -> {}
            '<' -> sb.append("\\u003c"); else -> sb.append(c)
        }
        return sb.append('"').toString()
    }
}
