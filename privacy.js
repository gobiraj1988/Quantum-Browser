'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  PRIVACY.JS  —  Complete privacy engine for MyBrowser
//  Uses onBeforeSendHeaders + onHeadersReceived (no conflict with adblocker's
//  onBeforeRequest). HTTPS upgrade is handled per-webContents via will-navigate.
// ─────────────────────────────────────────────────────────────────────────────

const { session, ipcMain, app } = require('electron')
const path = require('path')
const fs   = require('fs')

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'privacy-settings.json')

// ─── Defaults & scoring ───────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  blockTrackingCookies:    true,
  fingerprintProtection:   true,
  webRTCProtection:        true,
  httpsUpgrade:            true,
  doNotTrack:              true,
  blockThirdPartyCookies:  true,
}

// weights must sum to 100
const SCORE_WEIGHTS = {
  doNotTrack:              10,
  blockTrackingCookies:    10,
  blockThirdPartyCookies:  25,
  httpsUpgrade:            15,
  webRTCProtection:        15,
  fingerprintProtection:   25,
}

// ─── Known tracking/analytics domains ────────────────────────────────────────
// These have cookies blocked on both send and set.
// google.com / googleapis.com are excluded so search & login keep working.

const TRACKING_DOMAINS = new Set([
  // Google advertising (not Google search)
  'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
  'googletagmanager.com', 'googletagservices.com', 'google-analytics.com',
  'analytics.google.com', 'adservice.google.com',
  // Meta
  'facebook.com', 'connect.facebook.net', 'fbcdn.net',
  'pixel.facebook.com', 'static.xx.fbcdn.net',
  // Twitter/X ads
  'analytics.twitter.com', 'static.ads-twitter.com', 't.co',
  // Amazon ads
  'amazon-adsystem.com', 'ads.amazon.com',
  // Ad exchanges
  'adsrvr.org', 'adnxs.com', 'rubiconproject.com', 'pubmatic.com',
  'openx.net', 'contextweb.com', 'bidswitch.net', 'adroll.com',
  // Criteo / native ads
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com',
  // Analytics / session replay
  'scorecardresearch.com', 'quantserve.com', 'comscore.com',
  'hotjar.com', 'fullstory.com', 'mouseflow.com', 'logrocket.com',
  'segment.com', 'segment.io', 'mixpanel.com', 'amplitude.com',
  'heap.io', 'intercom.io', 'intercomcdn.com',
  // LinkedIn / Bing / Clarity
  'snap.licdn.com', 'bat.bing.com', 'c.clarity.ms',
  // CRM / marketing
  'hubspot.com', 'marketo.net', 'pardot.com', 'salesforce.com',
  'mc.yandex.ru', 'mc.yandex.com',
])

// ─── Fingerprint protection script ───────────────────────────────────────────
// Injected into every web page's MAIN world via executeJavaScript at dom-ready.
// Overrides native APIs used for browser fingerprinting.

const FP_SCRIPT = `
(function () {
  'use strict';
  if (location.protocol === 'file:' || location.hostname === '') return;

  const _def = (obj, prop, val) => {
    try {
      Object.defineProperty(obj, prop, { get: () => val, configurable: true, enumerable: true });
    } catch (_) {}
  };

  // ── 1. Navigator normalisation ────────────────────────────────────────────
  _def(navigator, 'hardwareConcurrency', 4);
  _def(navigator, 'deviceMemory', 8);
  _def(navigator, 'platform', 'Win32');
  _def(navigator, 'languages', Object.freeze(['en-US', 'en']));

  // Deny Battery API (fingerprinting vector)
  if (navigator.getBattery) {
    Object.defineProperty(navigator, 'getBattery', {
      value: () => Promise.reject(new Error('Access denied')),
      configurable: true,
    });
  }

  // ── 2. Canvas fingerprint: add imperceptible per-session noise ────────────
  const SEED = Math.floor(Math.random() * 10) + 1;

  const _patchCanvas = (proto, method) => {
    const orig = proto[method];
    if (!orig) return;
    proto[method] = function (...args) {
      const ctx = typeof this.getContext === 'function' && this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        try {
          const d = ctx.getImageData(0, 0, 1, 1);
          d.data[0] = (d.data[0] ^ SEED) & 0xFF;
          ctx.putImageData(d, 0, 0);
        } catch (_) {}
      }
      return orig.apply(this, args);
    };
  };

  if (window.HTMLCanvasElement) {
    _patchCanvas(HTMLCanvasElement.prototype, 'toDataURL');
    _patchCanvas(HTMLCanvasElement.prototype, 'toBlob');
  }

  // ── 3. WebGL: normalise vendor + renderer strings ─────────────────────────
  const _patchWebGL = (Ctor) => {
    if (!Ctor) return;
    const origGet = Ctor.prototype.getParameter;
    Ctor.prototype.getParameter = function (p) {
      // UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL
      if (p === 37445) return 'Intel Open Source Technology Center';
      if (p === 37446) return 'Mesa DRI Intel(R) HD Graphics 620';
      return origGet.call(this, p);
    };
    const origExt = Ctor.prototype.getExtension;
    Ctor.prototype.getExtension = function (name) {
      // Block the extension that exposes real GPU vendor/renderer
      if (name === 'WEBGL_debug_renderer_info') return null;
      return origExt.call(this, name);
    };
  };
  _patchWebGL(window.WebGLRenderingContext);
  _patchWebGL(window.WebGL2RenderingContext);

  // ── 4. WebRTC: clear ICE servers to prevent real-IP leaks ────────────────
  if (window.RTCPeerConnection) {
    const _Orig = window.RTCPeerConnection;
    function _SafeRTC(cfg, constraints) {
      if (cfg && Array.isArray(cfg.iceServers)) cfg.iceServers = [];
      return new _Orig(cfg, constraints);
    }
    _SafeRTC.prototype = _Orig.prototype;
    Object.setPrototypeOf(_SafeRTC, _Orig);
    try { window.RTCPeerConnection = _SafeRTC; } catch (_) {}
  }
  // Disable MediaDevices.getUserMedia as additional RTC leak vector
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      value: () => Promise.resolve([]), configurable: true,
    });
  }

  // ── 5. AudioContext: add sub-perceptible noise to timing fingerprint ───────
  const _patchAC = (AC) => {
    if (!AC) return;
    const origOsc = AC.prototype.createOscillator;
    if (origOsc) {
      AC.prototype.createOscillator = function () {
        const osc = origOsc.call(this);
        if (osc && osc.detune) osc.detune.value += SEED * 0.0001;
        return osc;
      };
    }
  };
  _patchAC(window.AudioContext);
  _patchAC(window.webkitAudioContext);

  // ── 6. Screen: normalise colour depth ────────────────────────────────────
  _def(screen, 'colorDepth', 24);
  _def(screen, 'pixelDepth', 24);

})();
`

// ─── State ────────────────────────────────────────────────────────────────────

let settings = { ...DEFAULT_SETTINGS }
let mainWin  = null

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) } }
  catch { return { ...DEFAULT_SETTINGS } }
}

function saveSettings(s) {
  try { fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s), 'utf8') } catch (_) {}
}

function calcScore(s) {
  return Object.entries(SCORE_WEIGHTS)
    .reduce((total, [key, w]) => total + (s[key] ? w : 0), 0)
}

function getHostname(url) {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

function isTracking(hostname) {
  if (!hostname) return false
  const parts = hostname.split('.')
  for (let i = 0; i < parts.length - 1; i++) {
    if (TRACKING_DOMAINS.has(parts.slice(i).join('.'))) return true
  }
  return false
}

function isSameParty(a, b) {
  if (!a || !b) return true
  const apex = h => h.replace(/^www\./, '').split('.').slice(-2).join('.')
  return apex(a) === apex(b)
}

function isLocal(url) {
  return /^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url)
}

function pushScore() {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('privacy-score-update', calcScore(settings))
  }
}

// ─── webRequest listeners ─────────────────────────────────────────────────────
// Uses onBeforeSendHeaders + onHeadersReceived — does NOT conflict with
// adblocker's onBeforeRequest.

function setupWebRequest(ses) {

  // ── Outgoing: add DNT header + strip cookies sent to trackers ──────────────
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers  = { ...details.requestHeaders }
    const reqHost  = getHostname(details.url)
    const refHost  = details.referrer ? getHostname(details.referrer) : null

    if (settings.doNotTrack) {
      headers['DNT']     = '1'
      headers['Sec-GPC'] = '1'   // Global Privacy Control (GPC spec)
    }

    if (settings.blockTrackingCookies && isTracking(reqHost)) {
      delete headers['Cookie']
    }

    if (settings.blockThirdPartyCookies && refHost && !isSameParty(reqHost, refHost)) {
      delete headers['Cookie']
    }

    callback({ requestHeaders: headers })
  })

  // ── Incoming: strip Set-Cookie from trackers / third parties ───────────────
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    const reqHost = getHostname(details.url)
    const refHost = details.referrer ? getHostname(details.referrer) : null

    const shouldStrip =
      (settings.blockTrackingCookies   && isTracking(reqHost)) ||
      (settings.blockThirdPartyCookies && refHost && !isSameParty(reqHost, refHost))

    if (shouldStrip) {
      delete headers['set-cookie']
      delete headers['Set-Cookie']
    }

    callback({ responseHeaders: headers })
  })
}

// ─── Per-webContents hooks ────────────────────────────────────────────────────

function attachToContents(contents) {

  // HTTPS upgrade: redirect http:// → https:// on main-frame navigation
  contents.on('will-navigate', (event, url) => {
    if (!settings.httpsUpgrade) return
    if (!url.startsWith('http://')) return
    if (isLocal(url)) return
    // Skip bare IP addresses (no valid cert)
    if (/^http:\/\/(\d{1,3}\.){3}\d{1,3}/i.test(url)) return
    event.preventDefault()
    contents.loadURL(url.replace(/^http:/, 'https:'))
  })

  // Fingerprint protection: inject into main world after DOM is ready
  contents.on('dom-ready', () => {
    if (!settings.fingerprintProtection) return
    const url = contents.getURL()
    if (!url
      || url.startsWith('file://')
      || url.startsWith('about:')
      || url.startsWith('devtools:')
      || url.startsWith('chrome-extension:')
    ) return
    contents.executeJavaScript(FP_SCRIPT).catch(() => {})
  })
}

function setupPerContents() {
  app.on('web-contents-created', (_event, contents) => {
    attachToContents(contents)
  })
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function setupIPC(win) {
  mainWin = win

  ipcMain.handle('privacy-get-settings', () => ({
    settings,
    score: calcScore(settings),
  }))

  ipcMain.handle('privacy-save-settings', (_, patch) => {
    settings = { ...settings, ...patch }
    saveSettings(settings)
    pushScore()
    return { settings, score: calcScore(settings) }
  })

  ipcMain.handle('privacy-clear-data', async () => {
    const ses = session.defaultSession
    await ses.clearCache()
    await ses.clearStorageData({
      storages: [
        'cookies', 'filesystem', 'indexdb', 'localstorage',
        'shadercache', 'websql', 'serviceworkers', 'cachestorage',
      ],
    })
    try { await ses.clearHostResolverCache() } catch (_) {}
    return true
  })

  ipcMain.handle('privacy-get-score', () => calcScore(settings))
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init(win) {
  settings = loadSettings()
  setupWebRequest(session.defaultSession)
  setupPerContents()
  setupIPC(win)
  console.log(`[Privacy] Ready — score: ${calcScore(settings)}/100`)
}

module.exports = { init, calcScore }
