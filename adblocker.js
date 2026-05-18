'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  ADBLOCKER.JS  —  Network-level ad/tracker blocking + settings backend
// ─────────────────────────────────────────────────────────────────────────────

const { session, ipcMain, net, app, BrowserWindow } = require('electron')
const path = require('path')
const fs   = require('fs')
const { BLOCKED_DOMAINS, BLOCKED_PATTERNS, ESSENTIAL_WHITELIST, parseEasyListText } = require('./filterlist')

// ─── Runtime state ────────────────────────────────────────────────────────────

let blockedCount     = 0        // session counter (shown in toolbar)
let isEnabled        = true
let strictMode       = false
let mainWin          = null
let cacheFilePath    = ''
let settingsFilePath = ''
let statsFilePath    = ''
let alreadyInit      = false

// Live blocking sets
const blockedDomains     = new Set(BLOCKED_DOMAINS)
const whitelistedDomains = new Set()
const urlPatterns        = [...BLOCKED_PATTERNS]
const essentialSet       = new Set(ESSENTIAL_WHITELIST)

// User-managed (persisted to disk)
const userWhitelist = new Set()
let   customRules   = []

// Blocked log — circular buffer, most-recent at end
const BLOCKED_LOG_MAX = 200
let blockedLog = []

// Daily + all-time stats (persisted)
let todayDate    = ''
let todayCount   = 0
let allTimeCount = 0

// Strict-mode: extra categories that aren't in EasyList by default
const STRICT_DOMAINS = new Set([
  'hotjar.com', 'mouseflow.com', 'fullstory.com', 'logrocket.com',
  'mixpanel.com', 'amplitude.com', 'segment.com', 'heap.io',
  'intercom.io', 'intercomcdn.com', 'hubspot.com', 'marketo.com',
  'clearbit.com', 'quantserve.com', 'comscore.com',
  'omniture.com', 'adobedtm.com', 'demdex.net', 'bluekai.com',
  'krxd.net', 'casalemedia.com', 'openx.net', 'rubiconproject.com',
  'pubmatic.com', 'bidswitch.net', 'adsrvr.org', 'adroll.com',
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com',
])

const FILTER_SOURCES = [
  { name: 'EasyList',    url: 'https://easylist.to/easylist/easylist.txt'    },
  { name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
]
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadSettings() {
  try {
    const d = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'))
    if (Array.isArray(d.userWhitelist))   d.userWhitelist.forEach(x => userWhitelist.add(x))
    if (Array.isArray(d.customRules))     customRules = d.customRules
    if (typeof d.strictMode === 'boolean') strictMode = d.strictMode
  } catch (_) {}
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFilePath,
      JSON.stringify({ userWhitelist: [...userWhitelist], customRules, strictMode }), 'utf8')
  } catch (_) {}
}

function loadStats() {
  try {
    const d = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'))
    todayDate    = d.todayDate    || ''
    todayCount   = d.todayCount   || 0
    allTimeCount = d.allTimeCount || 0
  } catch (_) {}
}

function saveStats() {
  try {
    fs.writeFileSync(statsFilePath,
      JSON.stringify({ todayDate, todayCount, allTimeCount }), 'utf8')
  } catch (_) {}
}

function getTodayStr() { return new Date().toISOString().slice(0, 10) }

// ─── Platform-specific ad URL patterns ───────────────────────────────────────
// Checked BEFORE the essential whitelist so youtube.com/googlevideo.com/
// facebook.com ad requests are blocked even though those domains are whitelisted.

function isPlatformAdUrl(url) {
  const u = url.toLowerCase()

  // ── YouTube / Google video ads ─────────────────────────────────────────────
  // Ad video streams carry adsid= in the query string; normal video CDN does not
  if (u.includes('googlevideo.com/videoplayback') && (u.includes('adsid=') || u.includes('adformat='))) return true
  // YouTube ad-specific API endpoints
  if (u.includes('youtube.com/api/stats/ads'))                return true
  if (u.includes('youtube.com/pagead/'))                      return true
  if (u.includes('youtube.com/ptracking'))                    return true
  if (u.includes('youtube.com/get_video_info') && u.includes('adformat')) return true
  // DoubleClick subdomains not already caught by the domain list
  if (u.includes('googleads.g.doubleclick.net'))              return true
  if (u.includes('static.doubleclick.net'))                   return true

  // ── Facebook ads ───────────────────────────────────────────────────────────
  if (u.includes('facebook.com/ads/'))                        return true
  if (u.includes('an.facebook.com/'))                         return true
  // Facebook SDK loader — used to serve Audience Network ads on third-party sites
  if (u.includes('connect.facebook.net/') && u.includes('sdk.js')) return true
  // Facebook ad image/script CDN paths
  if (u.includes('fbcdn.net/') && u.includes('/ads/'))        return true

  return false
}

// ─── URL analysis (runs on EVERY request — keep fast) ─────────────────────────

function getHostname(url) {
  try   { return new URL(url).hostname.toLowerCase() }
  catch { return '' }
}

function walkDomains(hostname, set) {
  if (!hostname) return false
  if (set.has(hostname)) return true
  const parts = hostname.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    if (set.has(parts.slice(i).join('.'))) return true
  }
  return false
}

const isEssentialDomain  = h => walkDomains(h, essentialSet)
const isUserWhitelisted  = h => walkDomains(h, userWhitelist)
const isStrictBlocked    = h => strictMode && walkDomains(h, STRICT_DOMAINS)

function isDomainBlocked(hostname) {
  if (!hostname) return false
  if (blockedDomains.has(hostname))     return true
  if (whitelistedDomains.has(hostname)) return false
  const parts = hostname.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    const p = parts.slice(i).join('.')
    if (blockedDomains.has(p)) return true
  }
  return false
}

function isPatternBlocked(url) {
  const lower = url.toLowerCase()
  if (urlPatterns.some(p => lower.includes(p))) return true
  if (customRules.some(r => r && lower.includes(r.toLowerCase()))) return true
  return false
}

function shouldBlock(url) {
  if (!isEnabled) return false
  if (!url || url.startsWith('file://') || url.startsWith('chrome-extension://') ||
      url.startsWith('about:') || url.startsWith('devtools:')) return false

  // Platform ad URLs are blocked BEFORE the essential-domain check so that
  // ad requests on whitelisted domains (youtube.com, googlevideo.com, facebook.com)
  // are still caught.
  if (isPlatformAdUrl(url)) return true

  const h = getHostname(url)
  if (isEssentialDomain(h)) return false   // YouTube, Google APIs, etc.
  if (isUserWhitelisted(h))  return false   // user's own whitelist
  return isDomainBlocked(h) || isPatternBlocked(url) || isStrictBlocked(h)
}

// ─── IPC broadcast helpers ────────────────────────────────────────────────────

function sendCount() {
  if (mainWin && !mainWin.isDestroyed())
    mainWin.webContents.send('adblocker-count', blockedCount)
}

function sendState() {
  if (mainWin && !mainWin.isDestroyed())
    mainWin.webContents.send('adblocker-state', { enabled: isEnabled, count: blockedCount })
}

function buildPayload() {
  return {
    enabled:       isEnabled,
    strictMode,
    userWhitelist: [...userWhitelist],
    customRules,
    blockedLog:    [...blockedLog].reverse(),   // most-recent first
    stats:         { todayDate, todayCount, allTimeCount, sessionCount: blockedCount },
    domains:       blockedDomains.size,
  }
}

function broadcastSettingsUpdate() {
  const payload = buildPayload()
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('adblocker-settings-update', payload)
  })
}

// ─── Filter list downloads ────────────────────────────────────────────────────

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    let body  = ''
    req.on('response', res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
      res.on('data',  c => { body += c.toString() })
      res.on('end',   () => resolve(body))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

function sendUpdateStatus(msg) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('adblocker-update-status', msg)
  })
}

async function refreshFilterLists() {
  let newDomains = 0
  sendUpdateStatus({ phase: 'start' })

  for (const src of FILTER_SOURCES) {
    try {
      sendUpdateStatus({ phase: 'downloading', name: src.name })
      console.log(`[AdBlocker] Downloading ${src.name}…`)
      const text  = await fetchText(src.url)
      const rules = parseEasyListText(text)

      rules.blocked.forEach(d => {
        if (!isEssentialDomain(d) && !blockedDomains.has(d)) { blockedDomains.add(d); newDomains++ }
      })
      rules.whitelisted.forEach(d => whitelistedDomains.add(d))

      console.log(`[AdBlocker] ${src.name}: +${rules.blocked.size} domains`)
    } catch (e) {
      console.log(`[AdBlocker] ${src.name} unavailable: ${e.message}`)
      sendUpdateStatus({ phase: 'error', name: src.name, error: e.message })
    }
  }

  if (newDomains > 0) {
    console.log(`[AdBlocker] Total: ${blockedDomains.size} domains`)
    try {
      fs.writeFileSync(cacheFilePath,
        JSON.stringify({ ts: Date.now(), size: blockedDomains.size }), 'utf8')
    } catch (_) {}
  }

  sendUpdateStatus({ phase: 'done', domains: blockedDomains.size })
  broadcastSettingsUpdate()
}

function isCacheFresh() {
  try {
    const d = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'))
    return (Date.now() - (d.ts || 0)) < TWENTY_FOUR_HOURS
  } catch { return false }
}

// ─── IPC registration ─────────────────────────────────────────────────────────

function setupIPC() {
  // Existing toggle / state (used by toolbar shield button)
  ipcMain.on('adblocker-toggle', (_, enabled) => {
    isEnabled = Boolean(enabled)
    console.log(`[AdBlocker] ${isEnabled ? 'Enabled' : 'Disabled'}`)
    sendState()
    broadcastSettingsUpdate()
  })

  ipcMain.handle('adblocker-get-state', () => ({
    enabled: isEnabled, count: blockedCount, domains: blockedDomains.size,
  }))

  // Settings panel APIs
  ipcMain.handle('adblocker-get-settings', () => buildPayload())

  ipcMain.handle('adblocker-add-whitelist', (_, domain) => {
    const d = (domain || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (d) { userWhitelist.add(d); saveSettings() }
    return [...userWhitelist]
  })

  ipcMain.handle('adblocker-remove-whitelist', (_, domain) => {
    userWhitelist.delete(domain)
    saveSettings()
    return [...userWhitelist]
  })

  ipcMain.handle('adblocker-force-update', async () => {
    await refreshFilterLists()
    return { domains: blockedDomains.size }
  })

  ipcMain.handle('adblocker-add-custom-rule', (_, rule) => {
    const r = (rule || '').trim().toLowerCase()
    if (r && !customRules.includes(r)) { customRules.push(r); saveSettings() }
    return customRules
  })

  ipcMain.handle('adblocker-remove-custom-rule', (_, rule) => {
    customRules = customRules.filter(r => r !== rule)
    saveSettings()
    return customRules
  })

  ipcMain.handle('adblocker-toggle-strict', (_, enabled) => {
    strictMode = Boolean(enabled)
    saveSettings()
    console.log(`[AdBlocker] Strict mode ${strictMode ? 'ON' : 'OFF'}`)
    return strictMode
  })

  ipcMain.handle('adblocker-clear-stats', () => {
    blockedCount = 0; todayCount = 0; allTimeCount = 0; blockedLog = []
    saveStats()
    sendCount()
    return buildPayload()
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

function init(win) {
  if (alreadyInit) { mainWin = win; return }
  alreadyInit      = true
  mainWin          = win
  cacheFilePath    = path.join(app.getPath('userData'), 'adblocker-cache.json')
  settingsFilePath = path.join(app.getPath('userData'), 'adblocker-settings.json')
  statsFilePath    = path.join(app.getPath('userData'), 'adblocker-stats.json')

  loadSettings()
  loadStats()

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      if (shouldBlock(details.url)) {
        blockedCount++

        // Daily stats
        const today = getTodayStr()
        if (today !== todayDate) { todayDate = today; todayCount = 0 }
        todayCount++
        allTimeCount++

        // Blocked log
        blockedLog.push({ url: details.url, domain: getHostname(details.url), ts: Date.now() })
        if (blockedLog.length > BLOCKED_LOG_MAX) blockedLog.shift()

        // Flush stats every 10 blocks to avoid disk thrashing
        if (allTimeCount % 10 === 0) saveStats()

        sendCount()
        callback({ cancel: true })
      } else {
        callback({})
      }
    }
  )

  setupIPC()

  console.log(`[AdBlocker] Ready — ${blockedDomains.size} domains, ${urlPatterns.length} patterns`)

  if (!isCacheFresh()) {
    setTimeout(refreshFilterLists, 5000)
  } else {
    console.log('[AdBlocker] Cache fresh — skipping download')
  }

  setInterval(refreshFilterLists, TWENTY_FOUR_HOURS)

  app.on('before-quit', saveStats)
}

module.exports = { init }
