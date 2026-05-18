'use strict'
// Facebook ad blocking script — injected into Facebook pages via ad-injector.js
// Runs inside the webview renderer context (NOT the main process).
;(function () {

  if (window.__fbAdFix) return
  window.__fbAdFix = true

  // ── CSS: hide known Facebook ad containers immediately ────────────────────────
  const css = document.createElement('style')
  css.id = '__fb-ad-fix-css'
  css.textContent = `
    [data-pagelet="FeedUnit"] [data-ad-rendering-role],
    div[data-ad-rendering-role="story_message"],
    div[data-ad-comet-metadata],
    div[aria-label="Sponsored"],
    div[data-xt][data-ad-rendering-role],
    div[data-pagelet*="MercuryAdUnit"],
    div[data-pagelet*="RightRail"],
    ._5pcr[data-ad-rendering-role],
    .x1iorvi4[data-yt-haste-ad-container],
    div[id^="hyperfeed_story_id_"]:has([data-ad-rendering-role]) { display: none !important; }
  `
  ;(document.head || document.documentElement).appendChild(css)

  // ── Walk up the DOM to find the feed article/story container ─────────────────
  function findStory (el) {
    let p = el
    for (let i = 0; i < 16; i++) {
      p = p?.parentElement
      if (!p || p === document.body) return null
      const role = p.getAttribute('role')
      const pg   = p.getAttribute('data-pagelet') || ''
      if (role === 'article') return p
      if (pg.startsWith('FeedUnit') || pg.startsWith('FeedStory')) return p
      if (p.id && /^hyperfeed_story_id_/.test(p.id)) return p
    }
    return null
  }

  function hideStory (el) {
    if (!el || el.dataset.fbAdHidden) return false
    el.style.display = 'none'
    el.dataset.fbAdHidden = '1'
    return true
  }

  // ── Remove sponsored posts from the feed ─────────────────────────────────────
  function purge () {
    let removed = 0

    // Method 1: data-ad-rendering-role attribute (most reliable signal)
    document.querySelectorAll('[data-ad-rendering-role]').forEach(el => {
      if (hideStory(findStory(el))) removed++
    })

    // Method 2: aria-label="Sponsored" element
    document.querySelectorAll('[aria-label="Sponsored"]').forEach(el => {
      if (hideStory(findStory(el))) removed++
    })

    // Method 3: data-ad-comet-metadata (newer Facebook ad marker)
    document.querySelectorAll('[data-ad-comet-metadata]').forEach(el => {
      if (hideStory(findStory(el))) removed++
    })

    // Method 4: text scan — look for a "Sponsored" or "Ad" span with no children
    // Only scan inside feed containers to avoid false positives
    const feedContainers = document.querySelectorAll('[data-pagelet^="FeedUnit"], [role="feed"]')
    const scanRoots = feedContainers.length ? feedContainers : [document.body]
    scanRoots.forEach(root => {
      root.querySelectorAll('span, a').forEach(el => {
        if (el.childElementCount > 0) return
        const t = el.textContent.trim()
        if (t !== 'Sponsored' && t !== 'Ad') return
        if (hideStory(findStory(el))) removed++
      })
    })

    return removed
  }

  // ── Debounced MutationObserver for dynamic feed content ──────────────────────
  let debounce = null
  const observer = new MutationObserver(() => {
    clearTimeout(debounce)
    debounce = setTimeout(purge, 350)
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // ── Fallback interval every 2 s for posts that slip through ──────────────────
  setInterval(purge, 2000)

  // ── Initial run ───────────────────────────────────────────────────────────────
  purge()

})()
