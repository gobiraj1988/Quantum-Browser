'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  nuclear-mode.js  —  Settings management for the 7-layer ad blocker
//
//  Persists user choices to  userData/ultra-adblock-settings.json
//  Exposes a settings object that all other modules read from.
// ═══════════════════════════════════════════════════════════════════════════════

const { app } = require('electron')
const path    = require('path')
const fs      = require('fs')

const SETTINGS_FILE = path.join(app.getPath('userData'), 'ultra-adblock-settings.json')

// ── Defaults (everything on = maximum protection) ─────────────────────────────

const DEFAULTS = {
  enabled:          true,

  // NUCLEAR MODE — block ads + all analytics, social widgets, tracking pixels
  nuclearMode:      true,

  // ANTI-TRACKING — strip UTM params from URLs, block fingerprint & referrer
  antiTracking:     true,

  // ANNOYANCE BLOCKER — cookie banners, newsletter popups, chat widgets
  annoyanceBlocker: true,

  // ANTI-ADBLOCK BYPASS — spoof window.canRunAds etc. to stop detection
  antiAdblockBypass: true,

  // Auto-update filter lists (every N hours)
  autoUpdate:       true,

  // Custom user rules (array of URL patterns)
  customRules:      [],

  // User whitelist (domains to skip)
  whitelist:        [],

  // All-time block count (persisted across sessions)
  allTimeBlocked:   0,
  allTimeTrackers:  0,
}

// ── Read / write ──────────────────────────────────────────────────────────────

function load () {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
      return { ...DEFAULTS, ...saved }
    }
  } catch (_) {}
  return { ...DEFAULTS }
}

function save (settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8')
  } catch (e) {
    console.error('[NuclearMode] Cannot save settings:', e.message)
  }
}

// ── Live settings object ──────────────────────────────────────────────────────

let _settings = load()
let _onChange = null  // callback(settings)

function get ()  { return _settings }
function set (patch) {
  _settings = { ..._settings, ...patch }
  save(_settings)
  if (_onChange) _onChange(_settings)
}

function onchange (cb) { _onChange = cb }

// ── Whitelist helpers ─────────────────────────────────────────────────────────

function addWhitelist (domain) {
  domain = domain.toLowerCase().replace(/^www\./, '').trim()
  if (domain && !_settings.whitelist.includes(domain)) {
    set({ whitelist: [..._settings.whitelist, domain] })
  }
}

function removeWhitelist (domain) {
  domain = domain.toLowerCase().replace(/^www\./, '').trim()
  set({ whitelist: _settings.whitelist.filter(d => d !== domain) })
}

// ── Custom rules helpers ──────────────────────────────────────────────────────

function addCustomRule (rule) {
  if (!_settings.customRules.includes(rule)) {
    set({ customRules: [..._settings.customRules, rule] })
  }
}

function removeCustomRule (rule) {
  set({ customRules: _settings.customRules.filter(r => r !== rule) })
}

// ── Persistent counter helpers ────────────────────────────────────────────────

function bumpAllTime (n = 1) {
  _settings.allTimeBlocked += n
  // Save only every 50 blocks to avoid thrashing disk
  if (_settings.allTimeBlocked % 50 === 0) save(_settings)
}

function resetAllTime () {
  set({ allTimeBlocked: 0, allTimeTrackers: 0 })
}

module.exports = {
  get, set, onchange, save, load,
  addWhitelist, removeWhitelist,
  addCustomRule, removeCustomRule,
  bumpAllTime, resetAllTime,
}
