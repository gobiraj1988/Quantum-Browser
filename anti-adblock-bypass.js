'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  anti-adblock-bypass.js  —  Layer 6: Prevent sites from detecting the blocker
//
//  Injected on every page before content loads (dom-ready).
//  Techniques:
//   1. Spoof window.canRunAds and related ad-detection variables
//   2. Create fake ad placeholder elements (sites check if ads rendered)
//   3. Block adblock-detection library calls
//   4. Remove "disable your adblocker" popups and overlays
// ═══════════════════════════════════════════════════════════════════════════════

const BYPASS_SCRIPT = /* js */`
;(function antiAdBlockBypass() {
  'use strict';
  if (window.__aabBypassDone) return;
  window.__aabBypassDone = true;

  // ── 1. Spoof common ad-blocker detection variables ──────────────────────────

  // window.canRunAds — used by Forbes, Wired, many others
  Object.defineProperty(window, 'canRunAds', {
    get: () => true, configurable: true,
  });

  // Google AdSense detection variable
  Object.defineProperty(window, 'google_jobrunner', {
    get: () => ({}), configurable: true,
  });

  // Some sites check adsbygoogle
  if (!window.adsbygoogle) {
    Object.defineProperty(window, 'adsbygoogle', {
      get: () => ({ loaded: true, push: function() {} }),
      configurable: true,
    });
  }

  // Outbrain / Taboola detection
  window._taboola  = window._taboola  || [];
  window._ob_init  = window._ob_init  || function() {};
  window.OBR       = window.OBR       || { extern: {} };

  // ── 2. Fake ad placeholder element ────────────────────────────────────────
  // Many sites check if the div #ads or .ad-placeholder rendered with real
  // dimensions. We create a hidden one with real dimensions.

  function createFakeAdBait() {
    if (document.getElementById('__mbFakeAd')) return;
    const d = document.createElement('div');
    d.id = '__mbFakeAd';
    d.className = 'adsbygoogle pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad';
    d.setAttribute('data-ad-client', 'ca-pub-0000000000000000');
    d.setAttribute('data-ad-slot', '0000000000');
    Object.assign(d.style, {
      position: 'absolute',
      left:     '-9999px',
      top:      '-9999px',
      width:    '300px',
      height:   '250px',
    });
    if (document.body) document.body.appendChild(d);
  }

  if (document.body) createFakeAdBait();
  else document.addEventListener('DOMContentLoaded', createFakeAdBait);

  // ── 3. Neutralise common adblock-detection libraries ─────────────────────

  // FuckAdBlock / BlockAdblock: patch the constructor
  function fakeAdBlockDetector() {}
  fakeAdBlockDetector.prototype = {
    onDetected: function() { return this; },
    onNotDetected: function(cb) { try { cb(); } catch (_) {} return this; },
    check: function(cb) { try { cb(false); } catch (_) {} return this; },
    setOption: function() { return this; },
    setMessage: function() { return this; },
    clearMessage: function() { return this; },
  };

  // If FuckAdBlock is loaded, replace it
  const _fuckNames = [
    'FuckAdBlock', 'BlockAdblock', 'fuckAdBlock', 'blockAdblock',
    'adBlocker', 'AdBlockDetect', 'DetectAdblock', 'adblockDetector',
  ];
  _fuckNames.forEach(name => {
    try {
      Object.defineProperty(window, name, {
        get: () => new fakeAdBlockDetector(),
        set: (val) => {},
        configurable: true,
      });
    } catch (_) {}
  });

  // ── 4. Remove "Please disable AdBlock" popups / modals ───────────────────

  const POPUP_SELECTORS = [
    // Generic anti-adblock patterns
    '[class*="adblock-modal"]', '[id*="adblock-modal"]',
    '[class*="adblock-popup"]', '[id*="adblock-popup"]',
    '[class*="adblock-overlay"]', '[id*="adblock-overlay"]',
    '[class*="adblock-notice"]', '[id*="adblock-notice"]',
    '[class*="adblock-wall"]',   '[id*="adblock-wall"]',
    '[class*="anti-adblock"]',   '[id*="anti-adblock"]',
    // Site-specific
    '#bild-nojs-overlay',    // Bild.de
    '#usercentrics-root',    // Usercentrics
    '.adblock-notice',
    '.ad-blocker-notice',
    '.ad-block-message',
    '[data-adblock-popup]',
  ].join(',');

  function removeAdblockPopups() {
    document.querySelectorAll(POPUP_SELECTORS).forEach(el => {
      el.style.display = 'none';
      try { el.remove(); } catch (_) {}
    });

    // Also re-enable body scroll if anti-adblock froze it
    if (document.body && document.body.style.overflow === 'hidden') {
      const hasModal = document.querySelector(POPUP_SELECTORS);
      if (!hasModal) document.body.style.overflow = '';
    }
  }

  // Run on DOMContentLoaded and after
  document.addEventListener('DOMContentLoaded', removeAdblockPopups);
  setInterval(removeAdblockPopups, 1500);
  new MutationObserver(removeAdblockPopups)
    .observe(document.documentElement, { childList: true, subtree: true });

  // ── 5. Forbes paywall bypass ──────────────────────────────────────────────
  // Forbes shows an adblock wall in a tp-container iframe. Force body visible.
  if (location.hostname.includes('forbes.com')) {
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('.tp-backdrop, .tp-container-inner').forEach(el => {
        el.style.display = 'none';
      });
      document.body.style.overflow = 'auto';
    });
  }

})();
`

function inject (wc) {
  if (!wc || wc.isDestroyed()) return
  try {
    wc.executeJavaScript(BYPASS_SCRIPT).catch(() => {})
  } catch (_) {}
}

module.exports = { inject, BYPASS_SCRIPT }
