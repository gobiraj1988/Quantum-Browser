'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  FINGERPRINT-SPOOFER.JS
//  When VPN is on, injects a script into every page that overrides:
//    • navigator.language / navigator.languages
//    • Date.getTimezoneOffset()
//    • Intl.DateTimeFormat timezone
//    • navigator.geolocation (spoofed coords matching VPN country)
// ─────────────────────────────────────────────────────────────────────────────

const { app, webContents } = require('electron')

let enabled     = false
let activeScript = ''
let alreadyInit = false

// ─── Build inject script from country data ────────────────────────────────────

function buildScript(data) {
  const { lang, tz, tzOffset, lat, lon } = data
  // Use JSON.stringify to safely embed strings in the injected code
  return `(function(){
  'use strict'
  if (window.__fpSpoof) return
  window.__fpSpoof = true

  var lang    = ${JSON.stringify(lang)}
  var tz      = ${JSON.stringify(tz)}
  var tzOff   = ${tzOffset}
  var lat     = ${lat}
  var lon     = ${lon}

  // ── navigator.language / languages ─────────────────────────────────────────
  try {
    Object.defineProperty(navigator, 'language',  { get: function(){ return lang }, configurable: true })
    Object.defineProperty(navigator, 'languages', { get: function(){ return [lang, 'en'] }, configurable: true })
  } catch(_) {}

  // ── Timezone: getTimezoneOffset ─────────────────────────────────────────────
  try {
    Date.prototype.getTimezoneOffset = function() { return tzOff }
  } catch(_) {}

  // ── Intl.DateTimeFormat timezone ────────────────────────────────────────────
  try {
    var _OrigDTF = window.Intl.DateTimeFormat
    var PatchedDTF = function(locale, options) {
      var opts = Object.assign({}, options)
      if (!opts.timeZone) opts.timeZone = tz
      return new _OrigDTF(locale || lang, opts)
    }
    PatchedDTF.prototype             = _OrigDTF.prototype
    PatchedDTF.supportedLocalesOf    = _OrigDTF.supportedLocalesOf.bind(_OrigDTF)
    PatchedDTF[Symbol.hasInstance]   = function(v){ return v instanceof _OrigDTF }
    Intl.DateTimeFormat = PatchedDTF

    // Also patch Intl.DateTimeFormat().resolvedOptions().timeZone
    var _resolvedOptions = _OrigDTF.prototype.resolvedOptions
    _OrigDTF.prototype.resolvedOptions = function() {
      var res = _resolvedOptions.call(this)
      res.timeZone = tz
      return res
    }
  } catch(_) {}

  // ── Geolocation ─────────────────────────────────────────────────────────────
  try {
    var fakeCoords = {
      latitude:         lat,
      longitude:        lon,
      accuracy:         65,
      altitude:         null,
      altitudeAccuracy: null,
      heading:          null,
      speed:            null,
    }
    var fakePos = { coords: fakeCoords, timestamp: Date.now() }
    navigator.geolocation.getCurrentPosition = function(success, error, opts) {
      setTimeout(function(){ if (typeof success === 'function') success(fakePos) }, 10)
    }
    navigator.geolocation.watchPosition = function(success, error, opts) {
      setTimeout(function(){ if (typeof success === 'function') success(fakePos) }, 10)
      return Math.floor(Math.random() * 10000)
    }
    navigator.geolocation.clearWatch = function() {}
  } catch(_) {}

})()`
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  if (alreadyInit) return
  alreadyInit = true

  app.on('web-contents-created', (_, wc) => {
    wc.on('dom-ready', () => {
      const url = wc.getURL()
      if (!url.startsWith('http')) return
      if (enabled && activeScript) wc.executeJavaScript(activeScript).catch(() => {})
    })
  })

  console.log('[FP-Spoof] Initialised')
}

// ─── Enable ───────────────────────────────────────────────────────────────────

function enable(countryData) {
  if (!countryData) return
  activeScript = buildScript(countryData)
  enabled      = true

  // Inject into all currently open pages
  webContents.getAllWebContents().forEach(wc => {
    if (wc.isDestroyed()) return
    const url = wc.getURL()
    if (!url.startsWith('http')) return
    wc.executeJavaScript(activeScript).catch(() => {})
  })

  console.log(`[FP-Spoof] ON — lang=${countryData.lang}, tz=${countryData.tz}, pos=${countryData.lat},${countryData.lon}`)
}

// ─── Disable ──────────────────────────────────────────────────────────────────

function disable() {
  enabled      = false
  activeScript = ''
  console.log('[FP-Spoof] OFF — refresh pages to restore real fingerprint')
}

function isEnabled() { return enabled }

module.exports = { init, enable, disable, isEnabled }
