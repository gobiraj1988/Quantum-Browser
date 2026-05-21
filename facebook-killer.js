'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  facebook-killer.js  —  Layer 5: Facebook / Instagram sponsored post remover
//
//  Injected on dom-ready and on SPA navigation.
//  Works language-independently by checking aria attributes and data attributes,
//  not just the English word "Sponsored".
// ═══════════════════════════════════════════════════════════════════════════════

const FACEBOOK_SCRIPT = /* js */`
;(function facebookKiller() {
  'use strict';
  if (window.__fbKillerRunning) return;
  window.__fbKillerRunning = true;

  // Sponsored markers that Facebook uses across all locales
  const SPONSORED_ATTRS = [
    '[data-ad-rendering-role]',
    '[data-xt*="sponsored"]',
    '[aria-label="Sponsored"]',
    '[aria-label="Gesponsert"]',
    '[aria-label="Publicité"]',
    '[aria-label="Patrocinado"]',
    '[aria-label="Reklam"]',
    '[data-pagelet*="Ad"]',
    '[data-ad-comet-metadata]',
    '[data-ad-preview]',
    '[data-testid*="ad_"]',
    '[id^="substream"] [role="article"]:has([href*="/ads/"])',
  ].join(',');

  // Text-based detection (fallback for locales not covered above)
  const SPONSORED_KEYWORDS = [
    'sponsored', 'gesponsert', 'patrocinado', 'sponsorisé',
    'publicité', 'gesponserd', 'reklam', 'إعلان',
    'paid partnership', 'suggested for you',
  ];

  let removedCount = 0;

  function isSponsored(el) {
    // Check text content for sponsored keywords
    const text = (el.innerText || el.textContent || '').slice(0, 500).toLowerCase();
    return SPONSORED_KEYWORDS.some(kw => text.includes(kw));
  }

  function removePost(post) {
    if (post && post.parentNode) {
      post.style.display = 'none';
      // Also remove from DOM so it doesn't come back
      try { post.remove(); } catch (_) {}
      removedCount++;
    }
  }

  function cleanFeed() {
    // Method 1: attribute-based (fastest)
    document.querySelectorAll(SPONSORED_ATTRS).forEach(el => {
      const post = el.closest('[role="article"]') || el.closest('[data-pagelet]') || el;
      removePost(post);
    });

    // Method 2: text-content scan on all articles
    document.querySelectorAll('[role="article"]').forEach(post => {
      if (isSponsored(post)) removePost(post);
    });

    // Method 3: right-rail "Sponsored" sections
    document.querySelectorAll('aside [aria-label="Sponsored"]').forEach(el => {
      const wrapper = el.closest('div[class]');
      if (wrapper) removePost(wrapper);
    });
  }

  // Run immediately, then on a slow interval (Facebook feed is not real-time)
  cleanFeed();
  setInterval(cleanFeed, 800);

  // MutationObserver — catches newly loaded posts as user scrolls
  const fbObserver = new MutationObserver(() => cleanFeed());
  function attachObserver() {
    if (document.body) {
      fbObserver.observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.body) attachObserver();
  else document.addEventListener('DOMContentLoaded', attachObserver);

  // Block Facebook's tracking pixel XHR calls
  const _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (typeof url === 'string' && (
      url.includes('/tr?') ||
      url.includes('/tr/') ||
      url.includes('/pixel/') ||
      url.includes('/ajax/bz') ||
      url.includes('/audience_network/')
    )) {
      url = 'data:text/plain,';
    }
    return _origOpen.call(this, method, url, ...rest);
  };

})();
`

const INSTAGRAM_SCRIPT = /* js */`
;(function instagramKiller() {
  'use strict';
  if (window.__igKillerRunning) return;
  window.__igKillerRunning = true;

  function cleanIG() {
    // Story ads — Instagram labels them with aria attributes
    document.querySelectorAll(
      'article:has([aria-label*="Sponsored"]), ' +
      'article:has(a[href="/ads/about/"]), ' +
      'div[role="presentation"]:has(a[href="/ads/about/"])'
    ).forEach(el => { el.style.display = 'none'; try { el.remove(); } catch (_) {} });
  }

  cleanIG();
  setInterval(cleanIG, 1000);
  new MutationObserver(cleanIG).observe(document.documentElement,
    { childList: true, subtree: true });
})();
`

function inject (wc, url) {
  if (!wc || wc.isDestroyed()) return
  try {
    if (url && url.includes('instagram.com')) {
      wc.executeJavaScript(INSTAGRAM_SCRIPT).catch(() => {})
    } else {
      wc.executeJavaScript(FACEBOOK_SCRIPT).catch(() => {})
    }
  } catch (_) {}
}

module.exports = { inject, FACEBOOK_SCRIPT, INSTAGRAM_SCRIPT }
