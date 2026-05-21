'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  ultra-adblocker.js  —  7-Layer Ad Blocking Orchestrator
//
//  One call — ultraAdblocker.init(win) — wires up all layers:
//
//  Layer 1 · FilterEngine     Network domain blocking (hardcoded + downloaded)
//  Layer 2 · FilterUpdater    Auto-downloads EasyList / EasyPrivacy every 24 h
//  Layer 3 · CSSInjector      Element hiding via CSS on every page load
//  Layer 4 · YouTubeKiller    Skips pre-roll / mid-roll ads on YouTube
//  Layer 5 · FacebookKiller   Removes sponsored posts on Facebook / Instagram
//  Layer 6 · AntiAdblockBypass  Spoofs window.canRunAds so sites stay accessible
//  Layer 7 · NuclearMode      Persists settings, whitelist, and custom rules
//
//  IPC channels match the legacy adblocker-* names so adblocker-settings.html
//  keeps working without any changes.
// ═══════════════════════════════════════════════════════════════════════════════

const { app, session, ipcMain, BrowserWindow, webContents } = require('electron')
const path = require('path')
const fs   = require('fs')

const filterEngine      = require('./filter-engine')
const filterUpdater     = require('./filter-updater')
const nuclearMode       = require('./nuclear-mode')
const cssInjector       = require('./css-injector')
const youtubeKiller     = require('./youtube-killer')
const facebookKiller    = require('./facebook-killer')
const antiAdblockBypass = require('./anti-adblock-bypass')

const { extractHostname } = filterEngine

// ── Runtime state ──────────────────────────────────────────────────────────────

let mainWin     = null
let alreadyInit = false

let sessionCount = 0
let todayDate    = ''
let todayCount   = 0

const BLOCKED_LOG_MAX = 200
const blockedLog      = []   // { url, domain, ts }

const getStatsFile = () => path.join(app.getPath('userData'), 'ultra-stats.json')

// ── Persistent stats ──────────────────────────────────────────────────────────

function loadStats () {
  try {
    const d = JSON.parse(fs.readFileSync(getStatsFile(), 'utf8'))
    nuclearMode.set({ allTimeBlocked: d.allTime || 0 })
    todayDate  = d.todayDate  || ''
    todayCount = d.todayCount || 0
  } catch (_) {}
}

function saveStats () {
  try {
    fs.writeFileSync(getStatsFile(), JSON.stringify({
      allTime:   nuclearMode.get().allTimeBlocked,
      todayDate,
      todayCount,
    }), 'utf8')
  } catch (_) {}
}

function getTodayStr () { return new Date().toISOString().slice(0, 10) }

// ── Settings payload — compatible with adblocker-settings.html ───────────────

function buildPayload () {
  const s   = nuclearMode.get()
  const eng = filterEngine.getStats()
  return {
    // adblocker-settings.html fields
    enabled:       s.enabled,
    strictMode:    false,   // already included in filter-engine hardcoded domains
    userWhitelist: s.whitelist,
    customRules:   s.customRules,
    blockedLog:    [...blockedLog].reverse(),   // most-recent first
    stats: {
      todayDate,
      todayCount,
      allTimeCount: s.allTimeBlocked,
      sessionCount,
    },
    domains: filterEngine.domainSet.size,

    // adblock-stats.html extended fields
    topAdDomains:   eng.topAdDomains,
    topSites:       eng.topSites,
    bandwidthSaved: eng.bandwidthSaved,
    timeSaved:      eng.timeSaved,
    patternCount:   eng.patternCount,
  }
}

// ── IPC broadcast helpers ─────────────────────────────────────────────────────

function broadcastCount () {
  if (mainWin && !mainWin.isDestroyed())
    mainWin.webContents.send('adblocker-count', sessionCount)
}

function broadcastUpdate () {
  const p = buildPayload()
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('adblocker-settings-update', p)
  })
}

// ── Layer 1–2: Network blocking ───────────────────────────────────────────────
// Bypasses FilterEngine.attach() so we can record URLs to blockedLog
// and call filterEngine._recordBlock() for per-site stats simultaneously.

function setupNetworkBlocking (ses) {
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (!nuclearMode.get().enabled) return callback({})

    const url      = details.url
    const hostname = extractHostname(url)
    let   pageHost = ''

    try {
      const wc = webContents.fromId(details.webContentsId)
      if (wc && !wc.isDestroyed()) pageHost = extractHostname(wc.getURL())
    } catch (_) {}

    // User whitelist — skip blocking if the page or request domain is allowed
    const wl = nuclearMode.get().whitelist
    if ((hostname && wl.includes(hostname)) ||
        (pageHost && wl.includes(pageHost))) {
      return callback({})
    }

    if (filterEngine.shouldBlock(url, hostname, pageHost)) {
      // Update session stats
      sessionCount++
      const today = getTodayStr()
      if (today !== todayDate) { todayDate = today; todayCount = 0 }
      todayCount++
      nuclearMode.bumpAllTime()

      // Feed filter-engine's per-site / per-domain maps for the stats page
      filterEngine._recordBlock(hostname, pageHost)

      // Maintain blocked log (last 200 entries)
      blockedLog.push({ url, domain: hostname, ts: Date.now() })
      if (blockedLog.length > BLOCKED_LOG_MAX) blockedLog.shift()

      // Persist stats every 25 blocks to avoid thrashing disk
      if (sessionCount % 25 === 0) saveStats()

      broadcastCount()
      return callback({ cancel: true })
    }
    callback({})
  })

  console.log('[UltraAdblocker] Network layer attached')
}

// ── Layers 3–6: CSS + JS injection ───────────────────────────────────────────

function injectForPage (wc, url) {
  if (!url || !url.startsWith('http')) return
  if (wc.isDestroyed()) return

  const s = nuclearMode.get()
  if (!s.enabled) return

  // Layer 3: CSS element hiding (global + site-specific + annoyances)
  cssInjector.inject(wc, url, s)

  // Layer 4: YouTube pre-roll / mid-roll ad killer
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    youtubeKiller.inject(wc)
  }

  // Layer 5: Facebook / Instagram sponsored post remover
  if (url.includes('facebook.com') || url.includes('fb.com') ||
      url.includes('instagram.com')) {
    facebookKiller.inject(wc, url)
  }

  // Layer 6: Anti-adblock bypass (spoof canRunAds, fake ad bait, patch FuckAdBlock)
  if (s.antiAdblockBypass !== false) {
    antiAdblockBypass.inject(wc)
  }
}

function setupInjection () {
  app.on('web-contents-created', (_, wc) => {
    // Full page load
    wc.on('dom-ready', () => injectForPage(wc, wc.getURL()))

    // SPA client-side navigation (YouTube, Facebook push new routes without reload)
    wc.on('did-navigate-in-page', (_, url, isMainFrame) => {
      if (isMainFrame) injectForPage(wc, url)
    })
  })
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
// Channel names kept compatible with adblocker-settings.html (adblocker-*).

function setupIPC () {
  // On/off toggle
  ipcMain.on('adblocker-toggle', (_, enabled) => {
    nuclearMode.set({ enabled: Boolean(enabled) })
    filterEngine.enabled = Boolean(enabled)
    console.log(`[UltraAdblocker] ${enabled ? 'Enabled' : 'Disabled'}`)
    broadcastUpdate()
  })

  // Quick state poll (toolbar badge)
  ipcMain.handle('adblocker-get-state', () => ({
    enabled: nuclearMode.get().enabled,
    count:   sessionCount,
    domains: filterEngine.domainSet.size,
  }))

  // Full settings payload (settings panel + stats page)
  ipcMain.handle('adblocker-get-settings', () => buildPayload())
  ipcMain.handle('ultra-get-stats',        () => buildPayload())

  // Whitelist management
  ipcMain.handle('adblocker-add-whitelist', (_, domain) => {
    const d = (domain || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
    if (d) {
      nuclearMode.addWhitelist(d)
      filterEngine.addToWhitelist(d)
      broadcastUpdate()
    }
    return nuclearMode.get().whitelist
  })

  ipcMain.handle('adblocker-remove-whitelist', (_, domain) => {
    const d = (domain || '').replace(/^www\./, '')
    nuclearMode.removeWhitelist(d)
    filterEngine.removeFromWhitelist(d)
    broadcastUpdate()
    return nuclearMode.get().whitelist
  })

  // Custom rules
  ipcMain.handle('adblocker-add-custom-rule', (_, rule) => {
    const r = (rule || '').trim()
    if (r) {
      nuclearMode.addCustomRule(r)
      filterEngine.addCustomRule(r)
    }
    return nuclearMode.get().customRules
  })

  ipcMain.handle('adblocker-remove-custom-rule', (_, rule) => {
    nuclearMode.removeCustomRule(rule)
    filterEngine.removeCustomRule(rule)
    return nuclearMode.get().customRules
  })

  // Strict mode — kept for settings panel compatibility.
  // Filter-engine already includes those domains in its hardcoded set.
  ipcMain.handle('adblocker-toggle-strict', (_, enabled) => Boolean(enabled))

  // Clear stats
  ipcMain.handle('adblocker-clear-stats', () => {
    sessionCount = 0; todayCount = 0
    nuclearMode.resetAllTime()
    filterEngine.resetStats()
    blockedLog.length = 0
    saveStats()
    broadcastCount()
    broadcastUpdate()
    return buildPayload()
  })

  // Force filter list download
  ipcMain.handle('adblocker-force-update', async () => {
    await filterUpdater.update(true)
    broadcastUpdate()
    return { domains: filterEngine.domainSet.size }
  })

  // Open ad blocker settings window (adblocker-settings.html)
  ipcMain.handle('open-settings', () => {
    const existing = BrowserWindow.getAllWindows().find(w =>
      !w.isDestroyed() && w.getTitle() === 'Ad Blocker Settings')
    if (existing) { existing.focus(); return }
    const sw = new BrowserWindow({
      width: 720, height: 560, parent: mainWin,
      title: 'Ad Blocker Settings', backgroundColor: '#202124', show: false,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    })
    sw.loadFile('adblocker-settings.html')
    sw.setMenuBarVisibility(false)
    sw.once('ready-to-show', () => sw.show())
  })

  // Open ad block stats window (adblock-stats.html)
  ipcMain.handle('open-adblock-stats', () => {
    const existing = BrowserWindow.getAllWindows().find(w =>
      !w.isDestroyed() && w.getTitle() === 'Ad Block Stats')
    if (existing) { existing.focus(); return }
    const sw = new BrowserWindow({
      width: 860, height: 640, parent: mainWin,
      title: 'Ad Block Stats', backgroundColor: '#13131a', show: false,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
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

  // Restore persisted stats
  loadStats()

  // Apply saved settings to filter engine
  const s = nuclearMode.get()
  filterEngine.enabled = s.enabled
  s.whitelist.forEach(d => filterEngine.addToWhitelist(d))
  s.customRules.forEach(r => filterEngine.addCustomRule(r))

  // Layers 1–2: Network blocking + auto-updating filter lists
  setupNetworkBlocking(session.defaultSession)
  filterUpdater.init()

  // Layers 3–6: CSS + script injection into every page
  setupInjection()

  // IPC for settings / stats UI
  setupIPC()

  // Flush stats to disk on exit
  app.on('before-quit', saveStats)

  console.log(
    `[UltraAdblocker] Ready — ${filterEngine.domainSet.size.toLocaleString()} domains, ` +
    `${filterEngine.urlPatterns.length} patterns`
  )
}

module.exports = { init }
