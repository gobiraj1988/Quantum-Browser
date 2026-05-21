'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  css-injector.js  —  Layer 3: CSS element hiding (Layers 3 + Annoyance)
//
//  Injected via webContents.insertCSS() on dom-ready.
//  YouTube, Facebook, Instagram, Twitter, global, annoyances.
// ═══════════════════════════════════════════════════════════════════════════════

// ── YouTube element hiding ────────────────────────────────────────────────────

const CSS_YOUTUBE = `
/* ── Video player ad overlays ─────────────────────────────── */
.ytp-ad-module,
.ytp-ad-overlay-container,
.ytp-ad-text-overlay,
.ytp-ad-image-overlay,
.ytp-ad-skip-button-container,
.ytp-skip-ad-button,
.ytp-ad-skip-button,
.ytp-ad-skip-button-modern,
.ytp-ad-player-overlay,
.ytp-ad-player-overlay-layout,
.ytp-ad-progress,
.ytp-ad-preview-container,
.ytp-ad-preview-image,
.ytp-ad-preview-text-container,
.ytp-ad-action-interstitial,
.ytp-ad-feedback-dialog-container,
.ytp-ad-overlay-close-button,
.ytp-ad-timed-pie-countdown-container,
.ad-showing .ytp-chrome-bottom,
.videoAdUiAttribution { display: none !important; height: 0 !important; }

/* ── Feed / sidebar ads ────────────────────────────────────── */
ytd-display-ad-renderer,
ytd-promoted-sparkles-web-renderer,
ytd-banner-promo-renderer,
ytd-action-companion-ad-renderer,
ytd-statement-banner-renderer,
ytd-in-feed-ad-layout-renderer,
ytd-ad-slot-renderer,
ytd-promoted-video-renderer,
ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
ytd-compact-promoted-video-renderer,
ytd-promoted-sparkles-text-search-renderer,
ytd-search-pyv-renderer,
ytd-video-masthead-ad-v3-renderer,
ytd-video-masthead-ad-primetime-renderer,
ytd-billboard-promo-renderer,
ytd-companion-slot-renderer,
ytd-player-legacy-desktop-watch-ads-renderer,
ytd-watch-next-secondary-results-renderer:has(ytd-compact-promoted-video-renderer) {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  max-height: 0 !important;
  overflow: hidden !important;
}

/* ── Masthead / banner ads ─────────────────────────────────── */
#masthead-ad,
#player-ads,
.ad-showing,
.ad-interrupting,
.ytd-action-companion-ad-renderer,
.ytd-donation-shelf-renderer,
.ytd-in-feed-ad-layout-renderer { display: none !important; }

/* Prevent layout shift when ads are hidden */
.ytp-ad-overlay-slot { display: none !important; }
`

// ── Facebook element hiding ────────────────────────────────────────────────────

const CSS_FACEBOOK = `
/* Sponsored feed posts */
[data-pagelet*="FeedUnit"]:has([aria-label="Sponsored"]),
[data-pagelet*="Feed"]:has([aria-label="Sponsored"]),
div[role="article"]:has(a[href*="/ads/"]),
div[role="article"]:has([aria-label="Sponsored"]),
div[data-ad-rendering-role],
div[data-xt*="sponsored"],
div[aria-label="Sponsored"],
div[aria-label="Suggested for you"],
[data-testid="placeholder"][data-visualcompletion="loading-state"],
div[data-pagelet*="Ad"],
div[data-ad-comet-metadata],
span:contains("Sponsored") { }

/* Right-rail ads */
div[data-pagelet="RightRail"] > div:has([aria-label="Sponsored"]),
[id^="content_ad_wrapper"],
.uiStreamSponsoredLink { display: none !important; }

/* Messenger ads */
[data-testid*="commerce"],
.fbAdUnit { display: none !important; }
`

// ── Instagram element hiding ──────────────────────────────────────────────────

const CSS_INSTAGRAM = `
article:has([aria-label*="Sponsored"]),
article:has(a[href="/ads/about/"]),
div[role="presentation"]:has(span:contains("Sponsored")),
._adp { display: none !important; }

/* Story ads */
div[style*="height: 100%"]:has(a[href*="/ads/"]) { display: none !important; }
`

// ── Twitter / X element hiding ────────────────────────────────────────────────

const CSS_TWITTER = `
[data-testid="placementTracking"],
article:has([data-testid="placementTracking"]),
div:has(> a[href="/i/adsapi"]) { display: none !important; }
`

// ── Global ad elements ────────────────────────────────────────────────────────

const CSS_GLOBAL = `
/* Common ad containers */
[id*="google_ads_iframe"],
[id*="aswift_"],
[id*="ad-container"],
[id*="ad-slot"],
[id*="ad-banner"],
[id*="ad-frame"],
[class*="ad-banner"],
[class*="ad-container"],
[class*="ad-slot"],
[class*="ad-frame"],
[class*="adsense"],
[class*="adsbygoogle"],
iframe[src*="doubleclick.net"],
iframe[src*="googlesyndication.com"],
iframe[src*="adservice.google.com"],
iframe[src*="amazon-adsystem.com"],
iframe[src*="criteo.com"],
div[data-ad-unit],
div[data-google-query-id],
ins.adsbygoogle { display: none !important; height: 0 !important; }

/* Ensure no height is stolen by hidden ad iframes */
iframe[height="0"][width="0"],
iframe[style*="display: none"],
img[src*="pixel.gif"],
img[src*="beacon.gif"],
img[width="1"][height="1"],
img[width="0"][height="0"] {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
`

// ── Annoyance Blocker (cookie banners, popups, newsletter modals) ──────────────

const CSS_ANNOYANCES = `
/* Cookie consent banners */
#onetrust-consent-sdk,
#onetrust-banner-sdk,
.onetrust-pc-dark-filter,
.onetrust-pc-sdk,
#CybotCookiebotDialog,
#CybotCookiebotDialogBody,
.cc-banner,
.cc-window,
.cookieConsent,
.cookie-consent,
.cookie-notice,
.cookie-banner,
.cookie-policy,
.cookie-law,
.gdpr-notice,
.eu-cookie-bar,
[id*="cookiebanner"],
[class*="cookiebanner"],
[id*="cookie-banner"],
[class*="cookie-banner"],
[id*="cookieConsent"],
[class*="cookieConsent"],
[id*="cookie_consent"],
[class*="cookie_consent"],
#cookiepolicydiv,
.truste_overlay,
.truste_box_overlay { display: none !important; }

/* Newsletter modals */
.popup-overlay,
.newsletter-popup,
.email-popup,
.subscribe-popup,
[class*="newsletter"][class*="popup"],
[class*="newsletter"][class*="modal"],
[class*="email-signup"],
[class*="email-capture"],
[class*="subscribe-modal"],
[id*="newsletter-modal"],
[id*="email-modal"] { display: none !important; }

/* Exit-intent overlays */
[class*="exit-intent"],
[class*="exit-popup"],
[id*="exit-intent"],
[id*="exit-popup"] { display: none !important; }

/* Chat widgets */
#hubspot-messages-iframe-container,
#intercom-container,
.intercom-app,
#drift-widget,
.drift-widget,
#freshworks-container,
[id*="livechat"],
[id*="chat-widget"],
[class*="livechat-widget"],
[class*="chat-widget"] { display: none !important; }

/* Push notification prompts — commonly a full-screen overlay */
.push-notification-overlay,
[class*="push-notification"][class*="overlay"],
[class*="push-prompt"] { display: none !important; }

/* Paywall overlays (Forbes, etc.) */
.tp-container-inner,
.tp-iframe-wrapper,
[class*="paywall-container"]:not(.paywall-content),
#piano-id { opacity: 0.01 !important; pointer-events: none !important; }
body.tp-modal-open { overflow: auto !important; }

/* Sticky / floating newsletter bars */
[class*="sticky-signup"],
[class*="floating-bar"],
.sailthru-overlay { display: none !important; }
`

// ── Inject into a webContents ──────────────────────────────────────────────────

function inject (wc, url, settings) {
  if (!wc || wc.isDestroyed()) return
  if (!url || !url.startsWith('http')) return

  const promises = []

  try {
    // Always inject global ad CSS
    promises.push(wc.insertCSS(CSS_GLOBAL))

    // Site-specific CSS
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      promises.push(wc.insertCSS(CSS_YOUTUBE))
    }
    if (url.includes('facebook.com') || url.includes('fb.com')) {
      promises.push(wc.insertCSS(CSS_FACEBOOK))
    }
    if (url.includes('instagram.com')) {
      promises.push(wc.insertCSS(CSS_INSTAGRAM))
    }
    if (url.includes('twitter.com') || url.includes('x.com')) {
      promises.push(wc.insertCSS(CSS_TWITTER))
    }

    // Annoyance blocker (on all sites if enabled)
    if (settings && settings.annoyanceBlocker) {
      promises.push(wc.insertCSS(CSS_ANNOYANCES))
    }

    Promise.all(promises).catch(() => {})
  } catch (_) {}
}

module.exports = { inject, CSS_YOUTUBE, CSS_FACEBOOK, CSS_GLOBAL, CSS_ANNOYANCES }
