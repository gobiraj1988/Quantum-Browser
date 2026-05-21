'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  safe-adblocker.js — Ghostery / uBlock-Origin engine for Electron
//
//  Uses @ghostery/adblocker-electron v2.x — the same engine as uBlock Origin.
//  Battle-tested, handles YouTube + Facebook natively via filter rules.
//  Does NOT use custom per-site heuristics — the filter lists do the work.
//
//  Filter lists loaded:
//    · EasyList          — mainstream ad networks
//    · EasyPrivacy       — trackers and analytics
//    · Peter Lowe's list — combined ads + trackers (hosts format)
//    · uBlock Origin     — extra network filters
//    · AdGuard Annoyances — cookie banners, newsletter popups
// ═══════════════════════════════════════════════════════════════════════════════

const { app, session, ipcMain, BrowserWindow, net } = require('electron')
const path  = require('path')
const fs    = require('fs')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

// ── Runtime state ─────────────────────────────────────────────────────────────

let blocker     = null
let mainWin     = null
let isEnabled   = true
let alreadyInit = false
let sessionCount = 0
let ruleCount   = 0

const getCachePath = () => path.join(app.getPath('userData'), 'ghostery-engine.bin')

// ── Stats helpers ─────────────────────────────────────────────────────────────

function sendCount () {
  if (mainWin && !mainWin.isDestroyed())
    mainWin.webContents.send('adblocker-count', sessionCount)
}

function broadcastSettings () {
  const p = buildPayload()
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('adblocker-settings-update', p)
  })
}

function buildPayload () {
  return {
    enabled:       isEnabled,
    strictMode:    false,
    userWhitelist: [],
    customRules:   [],
    blockedLog:    [],
    stats: {
      todayDate:    new Date().toISOString().slice(0, 10),
      todayCount:   sessionCount,
      allTimeCount: sessionCount,
      sessionCount,
    },
    domains:       ruleCount,
    topAdDomains:  [],
    topSites:      [],
    bandwidthSaved: sessionCount * 52 * 1024,
    timeSaved:     sessionCount * 0.9,
    patternCount:  0,
  }
}

function broadcastStatus (msg) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('adblocker-update-status', msg)
  })
}

// ── Block counting — patch onBeforeRequest BEFORE enableBlockingInSession ─────
// Ghostery's BlockingContext closes over blocker.onBeforeRequest at call time,
// so patching it before enabling lets us count every cancelled request.

function patchForCounting () {
  if (!blocker) return
  const orig = blocker.onBeforeRequest.bind(blocker)
  blocker.onBeforeRequest = function (details, callback) {
    orig(details, (response) => {
      if (response && response.cancel && isEnabled) {
        sessionCount++
        sendCount()
      }
      callback(response)
    })
  }
}

// ── Enable / disable blocking ─────────────────────────────────────────────────

function enableBlocker () {
  if (!blocker) return
  if (blocker.isBlockingEnabled(session.defaultSession)) return
  patchForCounting()
  blocker.enableBlockingInSession(session.defaultSession)
}

function disableBlocker () {
  if (!blocker) return
  if (!blocker.isBlockingEnabled(session.defaultSession)) return
  try { blocker.disableBlockingInSession(session.defaultSession) } catch (_) {}
}

// ── Download / load blocker ───────────────────────────────────────────────────
// Strategy:
//   1. fromPrebuiltFull   — Ghostery's CDN, pre-compiled binary (ads+trackers+annoyances)
//   2. fromPrebuiltAdsAndTracking — smaller prebuilt if Full CDN is down
// Custom URL lists are NOT used as primary because third-party CDNs (pgl.yoyo.org,
// ublockorigin.github.io) can fail cert validation in certain Electron environments.
// Ghostery's prebuilt engine covers all the same categories (EasyList, EasyPrivacy,
// Peter Lowe, uBlock filters, annoyances) in a single optimised binary.

async function createBlocker () {
  const cachePath = getCachePath()
  const fetchFn   = (url, init) => net.fetch(url, init)
  const caching   = {
    path:  cachePath,
    read:  (p) => fs.promises.readFile(p),
    write: (p, data) => fs.promises.writeFile(p, data),
  }

  broadcastStatus({ phase: 'start' })

  // Try #1 — full prebuilt (ads + trackers + annoyances + cookie banners)
  try {
    broadcastStatus({ phase: 'downloading', name: 'Ghostery Full Engine' })
    blocker = await ElectronBlocker.fromPrebuiltFull(fetchFn, caching)
    enableBlocker()
    ruleCount = blocker.getFilters().networkFilters.length
    console.log(`[SafeAdBlocker] Ghostery Full engine ready — ${ruleCount.toLocaleString()} network rules`)
    broadcastStatus({ phase: 'done', domains: ruleCount })
    broadcastSettings()
    return
  } catch (e) {
    console.warn('[SafeAdBlocker] Full engine failed:', e.message)
  }

  // Try #2 — ads + tracking prebuilt (smaller, different CDN path)
  try {
    broadcastStatus({ phase: 'downloading', name: 'Ghostery Ads+Tracking Engine' })
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchFn, caching)
    enableBlocker()
    ruleCount = blocker.getFilters().networkFilters.length
    console.log(`[SafeAdBlocker] Ghostery Ads+Tracking engine ready — ${ruleCount.toLocaleString()} rules`)
    broadcastStatus({ phase: 'done', domains: ruleCount })
    broadcastSettings()
    return
  } catch (e) {
    console.error('[SafeAdBlocker] Both engines failed:', e.message)
    broadcastStatus({ phase: 'error', error: e.message })
  }
}

async function refreshBlocker () {
  try { fs.unlinkSync(getCachePath()) } catch (_) {}
  disableBlocker()
  blocker = null
  await createBlocker()
}

// ── IPC handlers — compatible with existing settings panel ───────────────────

function setupIPC () {
  // Toggle on/off
  ipcMain.on('adblocker-toggle', (_, enabled) => {
    isEnabled = Boolean(enabled)
    isEnabled ? enableBlocker() : disableBlocker()
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed())
        w.webContents.send('adblocker-state', { enabled: isEnabled, count: sessionCount })
    })
    broadcastSettings()
  })

  ipcMain.handle('adblocker-get-state', () => ({
    enabled: isEnabled,
    count:   sessionCount,
    domains: ruleCount,
  }))

  ipcMain.handle('adblocker-get-settings', () => buildPayload())
  ipcMain.handle('ultra-get-stats',        () => buildPayload())

  // Force update — deletes cache and re-downloads all lists
  ipcMain.handle('adblocker-force-update', async () => {
    await refreshBlocker()
    return { domains: ruleCount }
  })

  // Clear session stats
  ipcMain.handle('adblocker-clear-stats', () => {
    sessionCount = 0
    sendCount()
    broadcastSettings()
    return buildPayload()
  })

  // Whitelist — Ghostery supports per-host whitelisting via addFilter
  ipcMain.handle('adblocker-add-whitelist', (_, domain) => {
    const d = (domain || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
    if (d && blocker) {
      try { blocker.addFilter(`@@||${d}^$document`) } catch (_) {}
    }
    return []
  })

  // Stubs for settings panel fields we don't track in Ghostery mode
  ipcMain.handle('adblocker-remove-whitelist',   () => [])
  ipcMain.handle('adblocker-add-custom-rule',    (_, rule) => {
    if (rule && blocker) { try { blocker.addFilter(rule) } catch (_) {} }
    return []
  })
  ipcMain.handle('adblocker-remove-custom-rule', () => [])
  ipcMain.handle('adblocker-toggle-strict',      () => false)

  // Settings window
  ipcMain.handle('open-settings', () => {
    const existing = BrowserWindow.getAllWindows().find(w =>
      !w.isDestroyed() && w.getTitle() === 'Ad Blocker Settings')
    if (existing) { existing.focus(); return }
    const sw = new BrowserWindow({
      width: 720, height: 560, parent: mainWin,
      title: 'Ad Blocker Settings', backgroundColor: '#202124', show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true,
                        preload: path.join(__dirname, 'preload.js') },
    })
    sw.loadFile('adblocker-settings.html')
    sw.setMenuBarVisibility(false)
    sw.once('ready-to-show', () => sw.show())
  })

  // Stats window
  ipcMain.handle('open-adblock-stats', () => {
    const existing = BrowserWindow.getAllWindows().find(w =>
      !w.isDestroyed() && w.getTitle() === 'Ad Block Stats')
    if (existing) { existing.focus(); return }
    const sw = new BrowserWindow({
      width: 860, height: 640, parent: mainWin,
      title: 'Ad Block Stats', backgroundColor: '#13131a', show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true,
                        preload: path.join(__dirname, 'preload.js') },
    })
    sw.loadFile('adblock-stats.html')
    sw.setMenuBarVisibility(false)
    sw.once('ready-to-show', () => sw.show())
  })
}

// ── Public init ───────────────────────────────────────────────────────────────

function init (win) {
  if (alreadyInit) { mainWin = win; return }
  alreadyInit = true
  mainWin     = win

  setupIPC()

  // createBlocker downloads lists or loads from disk cache.
  // Network blocking starts as soon as the engine is ready.
  createBlocker()

  console.log('[SafeAdBlocker] Initialising Ghostery engine…')
}

module.exports = { init }
