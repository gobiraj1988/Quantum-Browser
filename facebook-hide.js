'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  facebook-hide.js — CSS-only sponsored post hider for Facebook / Instagram
//
//  Zero network requests blocked — purely visual.
//  The Ghostery engine already blocks ad-network requests at the network level;
//  this adds CSS hiding for in-feed "Sponsored" posts that load as organic HTML.
//
//  Safe selectors only — no :contains() hacks that can hide non-ad content.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Facebook CSS ──────────────────────────────────────────────────────────────

const CSS_FACEBOOK = `
/* Feed articles flagged as sponsored via ARIA or data attributes */
div[role="article"]:has([aria-label="Sponsored"]),
div[role="article"]:has([aria-label="Gesponsert"]),
div[role="article"]:has([aria-label="Sponsorisé"]),
div[role="article"]:has([aria-label="Patrocinado"]),
div[role="article"]:has([aria-label="Reklam"]),
div[role="article"]:has([data-ad-rendering-role]),
div[role="article"]:has([data-xt*="sponsored"]),
div[data-ad-rendering-role],
div[data-xt*="sponsored"],
div[data-pagelet*="FeedAd"],
div[data-pagelet*="Ad"] { display: none !important; }

/* Right-rail / sidebar ad units */
div[data-pagelet="RightRail"] > div:has([aria-label="Sponsored"]) { display: none !important; }

/* Marketplace / Messenger ad units */
.fbAdUnit { display: none !important; }
`

// ── Instagram CSS ─────────────────────────────────────────────────────────────

const CSS_INSTAGRAM = `
/* Feed posts and Reels with Sponsored label */
article:has([aria-label*="Sponsored"]),
article:has(a[href="/ads/about/"]) { display: none !important; }

/* Story ads */
div[role="presentation"]:has(a[href="/ads/about/"]) { display: none !important; }
`

// ── Inject into a webContents ─────────────────────────────────────────────────

function inject (wc, url) {
  if (!wc || wc.isDestroyed()) return
  if (!url || !url.startsWith('http')) return
  try {
    if (url.includes('instagram.com')) {
      wc.insertCSS(CSS_INSTAGRAM).catch(() => {})
    } else if (url.includes('facebook.com') || url.includes('fb.com')) {
      wc.insertCSS(CSS_FACEBOOK).catch(() => {})
    }
  } catch (_) {}
}

// ── Public init ───────────────────────────────────────────────────────────────

let started = false

function init () {
  if (started) return
  started = true

  const { app } = require('electron')

  app.on('web-contents-created', (_, wc) => {
    wc.on('dom-ready', () => inject(wc, wc.getURL()))

    // Facebook and Instagram are heavy SPAs — re-apply on route changes
    wc.on('did-navigate-in-page', (_, url, isMainFrame) => {
      if (isMainFrame) inject(wc, url)
    })
  })

  console.log('[FacebookHide] CSS injection ready')
}

module.exports = { init }
