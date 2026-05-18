'use strict'
// YouTube ad blocking script — injected into YouTube pages via ad-injector.js
// Runs inside the webview renderer context (NOT the main process).
;(function () {

  if (window.__ytAdFix) return
  window.__ytAdFix = true

  // ── CSS: hide all YouTube ad containers immediately ───────────────────────────
  const css = document.createElement('style')
  css.id = '__yt-ad-fix-css'
  css.textContent = `
    .ad-showing .ytp-ad-module,
    .ad-showing .ytp-ad-player-overlay,
    .ad-showing .ytp-ad-player-overlay-instream-info,
    .ytp-ad-overlay-container,
    .ytp-ad-text-overlay,
    .ytp-ad-progress,
    .ytp-ad-progress-list,
    .ytp-ad-preview-container,
    .ytp-ad-preview-text,
    .ytp-ad-feedback-dialog-container,
    .ytp-ad-action-interstitial,
    .ytp-ad-action-interstitial-slot,
    #player-ads,
    #watch-flexy #player-ads,
    ytd-promoted-sparkles-web-renderer,
    ytd-display-ad-renderer,
    ytd-banner-promo-renderer,
    ytd-statement-banner-renderer,
    ytd-ad-slot-renderer,
    ytd-in-feed-ad-layout-renderer,
    ytd-promoted-video-renderer,
    ytd-video-masthead-ad-v3-renderer,
    .ytd-promoted-video-renderer,
    #masthead-ad,
    #feed-pyv-container,
    tp-yt-paper-dialog:has(ytd-mealbar-promo-renderer),
    ytd-mealbar-promo-renderer { display: none !important; }
  `
  ;(document.head || document.documentElement).appendChild(css)

  // ── Skip button selectors (all known formats) ─────────────────────────────────
  const SKIP_SEL = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-slot',
    '.videoAdUiSkipContainer',
    'button[class*="skip"]',
  ]

  function clickSkip () {
    for (const sel of SKIP_SEL) {
      const btn = document.querySelector(sel)
      if (btn && btn.offsetParent !== null) { btn.click(); return true }
    }
    return false
  }

  // ── Fast-forward ad video to its end ─────────────────────────────────────────
  function ffwdAd () {
    const video = document.querySelector('video')
    if (!video) return false
    const adBadge = document.querySelector('.ad-showing, .ytp-ad-player-overlay')
    if (!adBadge) return false
    if (isFinite(video.duration) && !isNaN(video.duration) && video.duration > 0) {
      video.currentTime = video.duration
      video.muted = false
      return true
    }
    // fallback: mute + max speed
    video.muted = true
    video.playbackRate = 16
    return false
  }

  // ── Remove overlay ad elements ────────────────────────────────────────────────
  const OVERLAY_SEL = [
    '.ytp-ad-overlay-container',
    '.ytp-ad-text-overlay',
    '#masthead-ad',
    'ytd-banner-promo-renderer',
    'ytd-display-ad-renderer',
    'ytd-ad-slot-renderer',
    'ytd-promoted-sparkles-web-renderer',
    '#player-ads',
    '#feed-pyv-container',
  ]

  function clearOverlays () {
    OVERLAY_SEL.forEach(sel => document.querySelectorAll(sel).forEach(el => {
      try { el.remove() } catch (_) {}
    }))
  }

  // ── Ad polling loop (active only while ad is showing) ────────────────────────
  let adTimer = null

  function startAdLoop () {
    if (adTimer) return
    adTimer = setInterval(() => {
      const adActive = document.querySelector('.ad-showing, .ytp-ad-player-overlay')
      if (adActive) {
        if (!clickSkip()) ffwdAd()
        clearOverlays()
      } else {
        clearInterval(adTimer)
        adTimer = null
        // Restore normal playback rate if we changed it
        const v = document.querySelector('video')
        if (v && v.playbackRate > 1) {
          v.playbackRate = 1
          v.muted = false
        }
      }
    }, 150)
  }

  // ── MutationObserver: watch for ad class changes and new ad elements ──────────
  const AD_TAGS = new Set([
    'YTD-DISPLAY-AD-RENDERER',
    'YTD-PROMOTED-SPARKLES-WEB-RENDERER',
    'YTD-BANNER-PROMO-RENDERER',
    'YTD-AD-SLOT-RENDERER',
    'YTD-IN-FEED-AD-LAYOUT-RENDERER',
    'YTD-PROMOTED-VIDEO-RENDERER',
    'YTD-MEALBAR-PROMO-RENDERER',
    'YTD-STATEMENT-BANNER-RENDERER',
  ])

  function handleMutation (mutations) {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        const cl = m.target.classList
        if (cl.contains('ad-showing') || cl.contains('ytp-ad-module')) {
          startAdLoop()
          clickSkip()
          ffwdAd()
        }
      }
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue
        if (AD_TAGS.has(node.tagName)) {
          try { node.remove() } catch (_) {}
          continue
        }
        if (node.classList?.contains('ytp-ad-overlay-container') ||
            node.classList?.contains('ytp-ad-text-overlay') ||
            node.id === 'masthead-ad') {
          try { node.remove() } catch (_) {}
        }
      }
    }
  }

  const observer = new MutationObserver(handleMutation)
  observer.observe(document.documentElement, {
    childList:       true,
    subtree:         true,
    attributes:      true,
    attributeFilter: ['class'],
  })

  // ── YouTube SPA navigation (yt-navigate-finish fires on every page change) ────
  document.addEventListener('yt-navigate-finish', () => {
    // Small delay so YouTube's player initialises before we act
    setTimeout(() => { clickSkip(); ffwdAd(); clearOverlays() }, 200)
    setTimeout(() => {
      if (document.querySelector('.ad-showing, .ytp-ad-player-overlay')) startAdLoop()
    }, 500)
  })

  // ── Initial run ───────────────────────────────────────────────────────────────
  clickSkip()
  ffwdAd()
  clearOverlays()
  if (document.querySelector('.ad-showing, .ytp-ad-player-overlay')) startAdLoop()

})()
