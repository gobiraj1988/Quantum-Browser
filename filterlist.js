'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  FILTERLIST.JS
//  Bundled ad/tracker domain list compiled from EasyList + EasyPrivacy.
//  Also exports parseEasyListText() for parsing downloaded filter lists.
// ─────────────────────────────────────────────────────────────────────────────

// Domains to block completely (all subdomains are also blocked).
// Stored as an Array here; adblocker.js converts it to a Set for O(1) lookups.
const BLOCKED_DOMAINS = [

  // ── Google Advertising ─────────────────────────────────────────────────────
  'doubleclick.net',           // Google's main ad platform
  'googleadservices.com',      // Google Ads click tracking
  'googlesyndication.com',     // Google AdSense display ads
  'googletagmanager.com',      // Google Tag Manager (tracking)
  'googletagservices.com',     // Google tag container
  'google-analytics.com',      // Google Analytics
  'adservice.google.com',      // Google ad service endpoint
  'pagead2.googlesyndication.com',
  'tpc.googlesyndication.com',
  'cm.g.doubleclick.net',
  'stats.g.doubleclick.net',
  'survey.g.doubleclick.net',
  'ad.doubleclick.net',
  'securepubads.g.doubleclick.net',

  // ── Major Ad Networks ──────────────────────────────────────────────────────
  'adnxs.com',              // Xandr / Microsoft
  'appnexus.com',
  'amazon-adsystem.com',    // Amazon Advertising
  'advertising.com',        // Yahoo / Verizon
  'outbrain.com',           // Outbrain native ads
  'taboola.com',            // Taboola native ads
  'criteo.com',             // Criteo retargeting
  'criteo.net',
  'adsrvr.org',             // The Trade Desk
  'pubmatic.com',           // PubMatic SSP
  'openx.net',              // OpenX
  'openxadexchange.com',
  'rubiconproject.com',     // Magnite (formerly Rubicon Project)
  'casalemedia.com',        // Index Exchange
  'indexww.com',
  'smartadserver.com',
  'adform.net',             // Adform DSP
  'contextweb.com',         // PulsePoint
  'moatads.com',            // Oracle Moat (viewability)
  'adsafeprotected.com',    // Integral Ad Science
  'spotxchange.com',        // SpotX video ads
  'sharethrough.com',       // Sharethrough native
  'teads.tv',               // Teads video ads
  'revcontent.com',         // Revcontent
  'mgid.com',               // MGID
  'lijit.com',              // Sovrn
  'sovrn.com',
  'bidswitch.net',          // Iponweb BidSwitch
  'yieldmo.com',
  'conversant.com',
  'emxdgt.com',             // EMX Digital
  'undertone.com',
  'zedo.com',
  'richaudience.com',
  'triplelift.com',
  'unrulymedia.com',
  'adroll.com',
  'adthrive.com',
  'mediavine.com',
  'media.net',
  'medianet.com',
  'liveintent.com',
  'loopme.com',
  'permutive.com',
  'smaato.net',
  'smaato.com',
  'tapad.com',
  'turn.com',
  'xad.com',
  'yieldr.com',
  'yieldmanager.com',
  'tradedoubler.com',
  'doubleverify.com',       // Ad verification (tracking)
  'buysellads.com',
  'buysellads.net',
  'nativeads.com',
  'plista.com',
  'realtimeadx.com',
  'adpushup.com',
  'adtelligent.com',
  'improvedigital.com',
  'improve-digital.net',
  'iponweb.net',
  'semasio.net',
  'widespace.com',
  'vertamedia.com',
  'adhigh.net',
  'adition.com',
  'adkernel.com',
  'pixfuture.net',
  'eyeota.net',

  // ── Analytics & Tracking ───────────────────────────────────────────────────
  'hotjar.com',             // Session recording / heatmaps
  'mixpanel.com',           // Product analytics
  'segment.com',            // Customer data platform
  'segment.io',
  'amplitude.com',          // Product analytics
  'heapanalytics.com',      // Auto-capture analytics
  'fullstory.com',          // Session replay
  'logrocket.com',          // Session replay
  'mouseflow.com',          // Heatmaps
  'crazyegg.com',           // Heatmaps
  'clicktale.net',          // Contentsquare / ClickTale
  'inspectlet.com',         // Session recording
  'optimizely.com',         // A/B testing
  'vwo.com',                // Visual Website Optimizer
  'chartbeat.com',          // Real-time analytics
  'chartbeat.net',
  'scorecardresearch.com',  // Comscore
  'quantserve.com',         // Quantcast
  'quantcast.com',
  'newrelic.com',           // Application monitoring
  'nr-data.net',
  'statcounter.com',
  'pingdom.net',
  'kissmetrics.com',
  'luckyorange.com',
  'woopra.com',
  'clicky.com',
  'heap.io',
  'bat.bing.com',           // Microsoft Advertising tracking
  'clarity.ms',             // Microsoft Clarity heatmaps
  'bizographics.com',       // LinkedIn Insight Tag
  'branch.io',              // Mobile attribution
  'adjust.com',             // Mobile attribution
  'appsflyer.com',          // Mobile attribution
  'kochava.com',
  'singular.net',
  'tvsquared.com',

  // ── Social Media Tracking Pixels ───────────────────────────────────────────
  'connect.facebook.net',   // Facebook SDK / Pixel
  'an.facebook.com',        // Facebook Audience Network
  'ads.linkedin.com',       // LinkedIn Ads
  'ads.twitter.com',        // Twitter/X Ads
  'analytics.twitter.com',
  'tr.snapchat.com',        // Snapchat Pixel
  'sc-static.net',          // Snapchat
  'ads.pinterest.com',      // Pinterest Ads
  'ct.pinterest.com',
  'tiktok.com',             // TikTok Pixel (cdn.tiktok.com blocks legitimate content so we skip the root)
  'analytics.tiktok.com',

  // ── Popup & Pop-under Networks ─────────────────────────────────────────────
  'popcash.net',
  'propellerads.com',
  'adcash.com',
  'clickadu.com',
  'trafficfactory.biz',
  'popads.net',
  'popmyads.com',
  'adf.ly',
  'linkbucks.com',
  'shorte.st',
  'sh.st',
  'ouo.io',
  'bc.vc',

  // ── Crypto Mining Scripts ──────────────────────────────────────────────────
  'coinhive.com',
  'coin-hive.com',
  'jsecoin.com',
  'cryptoloot.pro',
  'minero.cc',
  'webminepool.com',
  'ppoi.org',
  'authedmine.com',
  'coinerra.com',
  'crypto-loot.com',
  'minecrunch.co',
  'rocks.io',
  'cnhv.co',
  'project-invictus.io',
  'deepminer.com',

]

// ─── URL patterns ─────────────────────────────────────────────────────────────
// These are checked against the full request URL when domain matching misses.
// Keep this list short — every entry adds a string-search per request.
const BLOCKED_PATTERNS = [
  // YouTube ad endpoints (served from youtube.com / googlevideo.com own domains)
  '/api/stats/ads',
  '/pagead/viewthroughconversion/',
  '/pagead/conversion/',
  'youtube.com/pagead',
  '/pcs/activeview',
  '/pagead/parallelload',
  '/api/stats/qoe?adformat',
  'doubleclick.net/pagead',

  // Generic ad script patterns
  '/adsbygoogle.js',
  '/ads/ga-audiences',
  '/pagead/id',
  '/show_ads.js',

  // Tracking beacons (query-string style)
  '/pixel.gif?',
  '/beacon.gif?',
  '/tracking.gif?',
  '/track.gif?',

  // Analytics
  '/gtag/js?id=',
  '/analytics.js',
  '/collect?v=1&',

  // Miner scripts
  '/lib/jquery.coinhive.min.js',
  '/coinhive.min.js',
]

// ─── EasyList / Adblock Plus format parser ────────────────────────────────────
//
// Parses the subset of filter syntax used for network-level domain blocking:
//   ||domain.com^         → block all requests to domain.com (and subdomains)
//   @@||domain.com^       → whitelist (exception)
//
// Cosmetic rules (## element hiding) and full regex rules are skipped —
// they require a content-script approach and are handled separately.
//
function parseEasyListText(text) {
  const blocked     = new Set()
  const whitelisted = new Set()

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()

    // Skip blank lines, comments, header tags, and cosmetic rules
    if (!line)                 continue
    if (line.startsWith('!'))  continue
    if (line.startsWith('['))  continue
    if (line.includes('##'))   continue   // element hiding
    if (line.includes('#@#'))  continue   // element hiding exception
    if (line.includes('#?#'))  continue   // extended CSS
    if (line.startsWith('/'))  continue   // regex rules (too complex)

    if (line.startsWith('@@||')) {
      // Whitelist rule: @@||domain.com^
      const domain = line.slice(4).split(/[\^\/\?\|]/)[0].toLowerCase()
      if (domain && domain.includes('.') && !domain.includes('*')) {
        whitelisted.add(domain)
      }

    } else if (line.startsWith('||')) {
      // Block rule: ||domain.com^  or  ||domain.com/path^
      const domain = line.slice(2).split(/[\^\/\?\|]/)[0].toLowerCase()
      if (
        domain &&
        domain.includes('.') &&
        !domain.includes('*') &&
        !domain.includes('=') &&
        !domain.startsWith('.')
      ) {
        blocked.add(domain)
      }
    }
  }

  return { blocked, whitelisted }
}

// ─── Essential whitelist ──────────────────────────────────────────────────────
// These domains (and all their subdomains) are NEVER blocked, even if EasyList
// adds them. Blocking any of these breaks major legitimate functionality.
const ESSENTIAL_WHITELIST = [
  'youtube.com',          // YouTube itself
  'googlevideo.com',      // YouTube video CDN — blocking this breaks ALL video playback
  'ytimg.com',            // YouTube images and thumbnails
  'ggpht.com',            // Google channel icons / Google Photos
  'youtube-nocookie.com', // Embedded YouTube player
  'accounts.google.com',  // Google login (needed for YouTube sign-in)
  'googleapis.com',       // Google APIs (YouTube Data API, auth tokens, etc.)
  'gstatic.com',          // Google static assets (fonts, icons, CSS)
]

module.exports = { BLOCKED_DOMAINS, BLOCKED_PATTERNS, ESSENTIAL_WHITELIST, parseEasyListText }
