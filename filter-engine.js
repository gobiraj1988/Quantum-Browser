'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  filter-engine.js  —  Layer 1 network request blocking + Bloom pre-filter
//
//  ARCHITECTURE
//  ┌──────────────────────────────────────────────────────────────┐
//  │ onBeforeRequest  →  Bloom filter (O(1), 256KB)              │
//  │   HIT?  →  Domain Set (O(1) confirmation)                   │
//  │   MISS? →  URL Pattern array (compiled regex, ~200 rules)   │
//  └──────────────────────────────────────────────────────────────┘
//
//  This runs on EVERY web request, so speed matters.
//  Bloom filter: ~0.5% false-positive rate → almost zero false blocks.
// ═══════════════════════════════════════════════════════════════════════════════

const { webContents } = require('electron')

// ── Bloom Filter (probabilistic pre-check — false negatives impossible) ────────

class BloomFilter {
  constructor (bits = 1 << 22, hashes = 5) { // 4MB bits, 5 hashes
    this.m = bits
    this.k = hashes
    this.buf = new Uint32Array(Math.ceil(bits / 32))
  }

  _h (s, seed) {
    let h = seed
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x9e3779b9)
      h ^= h >>> 16
    }
    return ((h >>> 0) % this.m + this.m) % this.m
  }

  add (s) {
    for (let i = 0; i < this.k; i++) {
      const bit = this._h(s, 0x811c9dc5 + i * 0x27d4eb2f)
      this.buf[bit >>> 5] |= 1 << (bit & 31)
    }
  }

  has (s) {
    for (let i = 0; i < this.k; i++) {
      const bit = this._h(s, 0x811c9dc5 + i * 0x27d4eb2f)
      if (!(this.buf[bit >>> 5] & (1 << (bit & 31)))) return false
    }
    return true
  }
}

// ── Layer 1: Hardcoded ad-network domains (safe to block entire domain) ────────
// These are DEDICATED ad infrastructure — blocking them fully is safe.

const HARDCODED_DOMAINS = [
  // DoubleClick / Google Ad Network
  'doubleclick.net', 'ad.doubleclick.net', 'googleads.g.doubleclick.net',
  'googlesyndication.com', 'pagead2.googlesyndication.com',
  'googleadservices.com', 'adservice.google.com', 'adservice.google.co.uk',
  'googletagservices.com', 'google-analytics.com', 'googletagmanager.com',
  'stats.g.doubleclick.net', 'cm.g.doubleclick.net',
  // Amazon Ads
  'amazon-adsystem.com', 'aax.amazon-adsystem.com',
  // AppNexus / Xandr
  'adnxs.com', 'secure.adnxs.com', 'ib.adnxs.com',
  // Criteo
  'criteo.com', 'widget.criteo.com', 'static.criteo.net',
  'dis.criteo.com', 'sslwidget.criteo.com',
  // Taboola
  'taboola.com', 'trc.taboola.com', 'cdn.taboola.com',
  'images.taboola.com', 'pixel.taboola.com',
  // Outbrain
  'outbrain.com', 'widgets.outbrain.com', 'amplify.outbrain.com',
  // The Trade Desk
  'adsrvr.org', 'insight.adsrvr.org',
  // Integral Ad Science
  'adsafeprotected.com', 'pixel.adsafeprotected.com',
  // comScore
  'scorecardresearch.com', 'beacon.scorecardresearch.com',
  // Quantcast
  'quantserve.com', 'pixel.quantserve.com',
  // Moat
  'moatads.com', 'z.moatads.com',
  // Rubicon Project
  'rubiconproject.com', 'fastlane.rubiconproject.com', 'pixel.rubiconproject.com',
  // PubMatic
  'pubmatic.com', 'ads.pubmatic.com', 'image8.pubmatic.com',
  // OpenX
  'openx.net', 'rtb.openx.net', 'delivery.openx.net',
  // Twitter / X ads (dedicated ad domain only — NOT twitter.com itself)
  'ads-twitter.com', 'ads.twitter.com',
  // Facebook ad network
  'an.facebook.com', 'connect.facebook.net',
  // Misc trackers
  'analytics.tiktok.com', 'ads-api.tiktok.com',
  'adsystem.com', 'adsymptotic.com',
  'adform.net', 'track.adform.net',
  'smartadserver.com', 'eas.smartadserver.com',
  'serving-sys.com', 'bs.serving-sys.com',
  'turn.com', 'ad.turn.com', 'adsystem.adobe.com',
  'bidswitch.net', 'global.adserver.org',
  'lotame.com', 'bcp.crwdcntrl.net', 'tags.crwdcntrl.net',
  'amplitude.com', 'cdn.amplitude.com', 'api.amplitude.com',
  'segment.io', 'api.segment.io', 'cdn.segment.com',
  'fullstory.com', 'rs.fullstory.com',
  'hotjar.com', 'script.hotjar.com', 'static.hotjar.com',
  'mixpanel.com', 'api.mixpanel.com',
  'marketo.net', 'mktoresp.com', 'munchkin.marketo.net',
  'demdex.net', 'dpm.demdex.net',
  'omtrdc.net', 's3.amazonaws.com',  // NOTE: only ad-related omtrdc
  'rlcdn.com', 'crsspxl.com',
  'pixels.youappi.com', 'adsupply.com',
  'onetrust.com', // cookie consent tracker
  'cookiepro.com', 'cookiebot.com',
  'trustarcservice.com', 'consent.trustarc.com',
]

// ── Layer 1: URL patterns for sites where we can't block the whole domain ──────
// These block specific AD paths without breaking the main site.

const HARDCODED_PATTERNS = [
  // ── YouTube ad delivery ──────────────────────────────────────────────────────
  // Ad video streams (normal streams do NOT contain &ctier= or &oad=)
  '*://*.googlevideo.com/videoplayback?*ctier=*',
  '*://*.googlevideo.com/videoplayback?*&oad=*',
  '*://*.googlevideo.com/initplayback?*&oad=*',
  // YouTube ad tracking / stat endpoints
  '*://www.youtube.com/api/stats/ads*',
  '*://www.youtube.com/api/stats/qoe?*adformat*',
  '*://www.youtube.com/pagead/*',
  '*://www.youtube.com/ptracking*',
  '*://www.youtube.com/get_midroll_info*',
  '*://www.youtube.com/youtubei/v1/log_event*',
  '*://www.youtube.com/youtubei/v1/player/ad_break*',
  '*://youtubei.googleapis.com/youtubei/v1/log_event*',
  // ── Facebook ad endpoints ────────────────────────────────────────────────────
  '*://www.facebook.com/ads/*',
  '*://www.facebook.com/audience_network/*',
  '*://www.facebook.com/adnw_*',
  '*://www.facebook.com/tr*',
  '*://www.facebook.com/pixel/*',
  '*://www.facebook.com/ajax/bz*',
  '*://m.facebook.com/ajax/bz*',
  // ── Instagram ads ────────────────────────────────────────────────────────────
  '*://*.instagram.com/api/v1/ads/*',
  '*://i.instagram.com/api/v1/ads/*',
  '*://*.instagram.com/ajax/bz*',
  // ── TikTok ads ───────────────────────────────────────────────────────────────
  '*://*.tiktok.com/api/ad/*',
  '*://*.tiktok.com/aweme/v1/ad/*',
  '*://*.tiktok.com/*/ad/*',
  // ── Twitter / X ads ──────────────────────────────────────────────────────────
  '*://*.twitter.com/i/adsapi/*',
  '*://*.x.com/i/adsapi/*',
  '*://twitter.com/i/jot*',
  // ── Common tracking pixels / patterns ────────────────────────────────────────
  '*://*/beacon?*',
  '*://*/pixel.gif*',
  '*://*/tracking.gif*',
  '*://*/impression.gif*',
  '*://*/ad_log*',
  '*://*/adclick*',
  '*://*/adsrv*',
  '*://*/adview*',
  '*://*/click-through*',
]

// ── URL pattern → RegExp compiler ─────────────────────────────────────────────

function compilePattern (pat) {
  try {
    // 1. Escape regex special chars (except *)
    const escaped = pat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\?/g, '\\?')
      .replace(/\*/g, '.*')
    return new RegExp(escaped, 'i')
  } catch (_) { return null }
}

// ── Engine singleton ───────────────────────────────────────────────────────────

class FilterEngine {
  constructor () {
    this.enabled      = true
    this.bloom        = new BloomFilter()
    this.domainSet    = new Set()
    this.urlPatterns  = []
    this.whitelist    = new Set()
    this.customRules  = []

    // Stats
    this.sessionCount = 0
    this.allTimeCount = 0
    this.perSite      = new Map()   // page hostname → blocked count
    this.perAdDomain  = new Map()   // blocked hostname → blocked count
    this.onBlock      = null        // callback(sessionCount)

    // Load hardcoded layer 1
    this._loadHardcoded()
  }

  _loadHardcoded () {
    for (const d of HARDCODED_DOMAINS) this.addDomain(d)
    for (const p of HARDCODED_PATTERNS) this.addPattern(p)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  addDomain (raw) {
    const d = raw.toLowerCase().trim().replace(/^www\./, '').replace(/\.$/, '')
    if (!d || d.length < 4 || d.startsWith('#') || !d.includes('.')) return
    this.domainSet.add(d)
    this.bloom.add(d)
    // Also add www. variant in bloom
    this.bloom.add('www.' + d)
  }

  addDomains (arr) { for (const d of arr) this.addDomain(d) }

  addPattern (pat) {
    const rx = compilePattern(pat)
    if (rx) this.urlPatterns.push(rx)
  }

  addPatterns (arr) { for (const p of arr) this.addPattern(p) }

  addToWhitelist (domain) {
    this.whitelist.add(domain.toLowerCase().replace(/^www\./, ''))
  }

  removeFromWhitelist (domain) {
    this.whitelist.delete(domain.toLowerCase().replace(/^www\./, ''))
  }

  addCustomRule (rule) {
    const rx = compilePattern(rule)
    if (rx) { this.customRules.push({ rule, rx }) }
  }

  removeCustomRule (rule) {
    this.customRules = this.customRules.filter(r => r.rule !== rule)
  }

  clearCustomRules () { this.customRules = [] }

  // ── Main decision function ──────────────────────────────────────────────────

  shouldBlock (url, hostname, pageHostname) {
    if (!this.enabled || !url) return false

    // Never block internal / file / data URLs
    if (url.startsWith('file://') || url.startsWith('data:') ||
        url.startsWith('blob:')   || url.startsWith('devtools:')) return false

    // Whitelist check
    if (hostname && this.whitelist.has(hostname)) return false
    if (pageHostname && this.whitelist.has(pageHostname)) return false

    // Custom user rules first
    for (const { rx } of this.customRules) {
      if (rx.test(url)) return true
    }

    // ── Domain Set check (fast) ──────────────────────────────────────────────
    if (hostname) {
      // Bloom filter pre-check (if bloom says NO → definitely not blocked)
      if (this.bloom.has(hostname)) {
        if (this.domainSet.has(hostname)) return true
      }
      // Walk up parent domains (e.g., sub.ads.example.com → ads.example.com → example.com)
      const parts = hostname.split('.')
      for (let i = 1; i < parts.length - 1; i++) {
        const parent = parts.slice(i).join('.')
        if (this.bloom.has(parent) && this.domainSet.has(parent)) return true
      }
    }

    // ── URL Pattern check (regex, O(n)) ─────────────────────────────────────
    for (const rx of this.urlPatterns) {
      if (rx.test(url)) return true
    }

    return false
  }

  // ── Attach to Electron session ─────────────────────────────────────────────

  attach (ses) {
    ses.webRequest.onBeforeRequest((details, callback) => {
      const url      = details.url
      const hostname = extractHostname(url)
      let pageHostname = ''

      try {
        const wc = webContents.fromId(details.webContentsId)
        if (wc && !wc.isDestroyed()) pageHostname = extractHostname(wc.getURL())
      } catch (_) {}

      if (this.shouldBlock(url, hostname, pageHostname)) {
        this._recordBlock(hostname, pageHostname)
        return callback({ cancel: true })
      }
      callback({})
    })
    console.log('[FilterEngine] Attached to session  —  Layer 1 hardcoded rules loaded')
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  _recordBlock (adHost, pageHost) {
    this.sessionCount++
    this.allTimeCount++
    if (adHost)   this.perAdDomain.set(adHost,  (this.perAdDomain.get(adHost)  || 0) + 1)
    if (pageHost) this.perSite.set(pageHost, (this.perSite.get(pageHost) || 0) + 1)
    if (this.onBlock) this.onBlock(this.sessionCount)
  }

  resetSession ()  { this.sessionCount = 0 }
  resetStats ()    { this.sessionCount = 0; this.allTimeCount = 0; this.perSite.clear(); this.perAdDomain.clear() }

  getStats () {
    const topSites = [...this.perSite.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([site, count]) => ({ site, count }))
    const topAdDomains = [...this.perAdDomain.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([domain, count]) => ({ domain, count }))

    return {
      session:    this.sessionCount,
      allTime:    this.allTimeCount,
      domainCount: this.domainSet.size,
      patternCount: this.urlPatterns.length,
      topSites,
      topAdDomains,
      bandwidthSaved: Math.round(this.sessionCount * 52),     // ~52KB per ad
      timeSaved:      Math.round(this.sessionCount * 0.9),    // ~0.9s per block
    }
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function extractHostname (url) {
  if (!url) return ''
  const s = url.indexOf('//')
  if (s === -1) return ''
  const start = s + 2
  const end = url.indexOf('/', start)
  const hostPort = end === -1 ? url.slice(start) : url.slice(start, end)
  const colonIdx = hostPort.lastIndexOf(':')
  const host = colonIdx > 0 && colonIdx > hostPort.lastIndexOf('.') + 4
    ? hostPort.slice(0, colonIdx)
    : hostPort
  return host.toLowerCase().replace(/^www\./, '')
}

module.exports = new FilterEngine()
module.exports.extractHostname = extractHostname
