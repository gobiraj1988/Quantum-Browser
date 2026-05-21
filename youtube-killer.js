'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  youtube-killer.js  —  Layer 4: YouTube ad-kill script
//
//  Injected into every YouTube tab on dom-ready and on SPA navigation.
//  Three-pronged attack:
//   1. DOM cleaner (setInterval + MutationObserver) — skip button + seek-to-end
//   2. Fetch interceptor — strips adPlacements from player API responses
//   3. XHR interceptor — blocks ad stat/tracking endpoints
// ═══════════════════════════════════════════════════════════════════════════════

// This string is injected as JavaScript into the YouTube page context.
const YOUTUBE_SCRIPT = /* js */`
;(function youtubeKiller() {
  'use strict';
  if (window.__ytKillerRunning) return;
  window.__ytKillerRunning = true;

  // ── 1. DOM ad cleaner ───────────────────────────────────────────────────────

  const AD_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-overlay-close-button',
  ].join(',');

  function killAds() {
    // Click skip buttons first
    const skip = document.querySelector(AD_SELECTORS);
    if (skip) { skip.click(); return; }

    // If an ad is playing in the video, mute + seek to end
    const video = document.querySelector('video');
    if (video && (
      document.querySelector('.ad-showing') ||
      document.querySelector('.ytp-ad-player-overlay-layout')
    )) {
      video.muted = true;
      video.playbackRate = 16;
      if (video.duration && video.duration > 0 && isFinite(video.duration)) {
        video.currentTime = video.duration - 0.1;
      }
    }

    // Remove lingering overlay containers
    document.querySelectorAll(
      '.ytp-ad-overlay-container, .ytp-ad-text-overlay, ' +
      '.ytp-ad-preview-container, .ytp-ad-module'
    ).forEach(el => el.remove());
  }

  // Run immediately and repeatedly
  killAds();
  const killInterval = setInterval(killAds, 150);

  // MutationObserver for instant reaction (YouTube is a heavy SPA)
  const killObserver = new MutationObserver(killAds);
  function attachObserver() {
    if (document.body) {
      killObserver.observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.body) attachObserver();
  else document.addEventListener('DOMContentLoaded', attachObserver);

  // ── 2. Fetch interceptor — remove adPlacements from player responses ────────

  const _origFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await _origFetch.apply(this, args);
    try {
      const url = (typeof args[0] === 'string') ? args[0] : (args[0]?.url || '');
      if (url && (
        url.includes('/youtubei/v1/player') ||
        url.includes('/youtubei/v1/next')
      )) {
        const clone  = res.clone();
        const data   = await clone.json();
        let modified = false;
        if (data.adPlacements)   { delete data.adPlacements;   modified = true; }
        if (data.playerAds)      { delete data.playerAds;       modified = true; }
        if (data.adSlots)        { delete data.adSlots;         modified = true; }
        if (data.adBreakHeartbeatParams) { delete data.adBreakHeartbeatParams; modified = true; }
        if (data.auxiliaryUi)    { delete data.auxiliaryUi;     modified = true; }
        if (modified) {
          return new Response(JSON.stringify(data), {
            status:     res.status,
            statusText: res.statusText,
            headers:    res.headers,
          });
        }
      }
    } catch (_) {}
    return res;
  };

  // ── 3. XHR interceptor — block ad stat calls ─────────────────────────────

  const _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (typeof url === 'string' && (
      url.includes('/api/stats/ads') ||
      url.includes('/ptracking')     ||
      url.includes('/pagead/')       ||
      url.includes('log_event')      ||
      url.includes('/ad_break')      ||
      url.includes('doubleclick.net')
    )) {
      // Re-point to a no-op endpoint (avoids network errors)
      url = 'data:text/plain,';
    }
    return _origOpen.call(this, method, url, ...rest);
  };

  // ── 4. Video mutation — handle YouTube's "ad blocker detected" message ──────

  // YouTube occasionally shows a modal when it detects ad blocking.
  // Watch for it and dismiss it.
  function dismissYtModal() {
    const modal = document.querySelector('yt-confirm-dialog-renderer, ytd-enforcement-message-view-model');
    if (!modal) return;
    // Try to click the "continue anyway" or "reload" button
    const btn = modal.querySelector('button, .yt-spec-button-shape-next');
    if (btn) btn.click();
    // Otherwise reload (the modal is blocking playback anyway)
  }
  setInterval(dismissYtModal, 2000);

})();
`

// ── Inject into a YouTube webContents ─────────────────────────────────────────

function inject (wc) {
  if (!wc || wc.isDestroyed()) return
  try {
    wc.executeJavaScript(YOUTUBE_SCRIPT).catch(() => {})
  } catch (_) {}
}

module.exports = { inject, YOUTUBE_SCRIPT }
