'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  ADBLOCKER.JS  —  Network-level ad/tracker blocking + settings backend
//  OPTIMIZED: Bloom filter for O(1) domain pre-check, hostname result cache,
//  fast URL parsing without new URL(), pre-compiled pattern RegExp.
// ─────────────────────────────────────────────────────────────────────────────

const { session, ipcMain, net, app, BrowserWindow } = require('electron')
const path = require('path')
const fs   = require('fs')
const { BLOCKED_DOMAINS, BLOCKED_PATTERNS, ESSENTIAL_WHITELIST, parseEasyListText } = require('./filterlist')

// ─────────────────────────────────────────────────────────────────────────────
//  Bloom filter — fast probabilistic "is this hostname blocked?" check.
//  2^21 bits (256 KB), 4 hash functions → ~0.46% false-positive rate at 100K entries.
//  False positives cause an extra Set.has() call (harmless).
//  False negatives are impossible — if bloom says NO, it's definitely clean.
// ─────────────────────────────────────────────────────────────────────────────

class BloomFilter {
  constructor(bits = 1 << 21, hashes = 4) {
    this.m = bits
    this.k = hashes
    this.b = new Uint32Array(Math.ceil(bits / 32))
  }

  _h(s, seed) {
    let h = seed
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x9e3779b9)
      h ^= h >>> 16
    }
    return ((h >>> 0) % this.m + this.m) % this.m
  }

  add(s) {
    for (let i = 0; i < this.k; i++) {
      const bit = this._h(s, 0x811c9dc5 + i * 0x27d4eb2f)
      this.b[bit >>> 5] |= 1 << (bit & 31)
    }
  }

  test(s) {
    for (let i = 0; i < this.k; i++) {
      const bit = this._h(s, 0x811c9dc5 + i * 0x27d4eb2f)
      if (!(this.b[bit >>> 5] & (1 << (bit & 31)))) return false
    }
    return true   // probably in set (may be false positive)
  }
}

// ─── Runtime state ────────────────────────────────────────────────────────────

let blockedCount     = 0
let isEnabled        = true
let strictMode       = false
let mainWin          = null
let cacheFilePath    = ''
let settingsFilePath = ''
let statsFilePath    = ''
let alreadyInit      = false

const blockedDomains     = new Set(BLOCKED_DOMAINS)
const whitelistedDomains = new Set()
const urlPatterns        = [...BLOCKED_PATTERNS]
const essentialSet       = new Set(ESSENTIAL_WHITELIST)

const userWhitelist  = new Set()
let   customRules    = []

const BLOCKED_LOG_MAX = 200
let blockedLog = []

let todayDate = '', todayCount = 0, allTimeCount = 0

// ─── Bloom filter (populated after blockedDomains is ready) ──────────────────

const bloom = new BloomFilter()

function rebuildBloom() {
  // Reset bits
  bloom.b.fill(0)
  for (const d of blockedDomains) bloom.add(d)
}

// ─── Hostname result cache ─────────────────────────────────────────────────────
// Caches the final shouldBlock() result per hostname.
// Same hostname can appear in hundreds of requests per page — cache it once.

const resultCache = new Map()   // hostname -> boolean
const RESULT_CACHE_MAX = 20000

function getCached(hostname) {
  return resultCache.has(hostname) ? resultCache.get(hostname) : null
}

function setCached(hostname, result) {
  if (resultCache.size >= RESULT_CACHE_MAX) {
    const firstKey = resultCache.keys().next().value
    resultCache.delete(firstKey)
  }
  resultCache.set(hostname, result)
}

function invalidateCache() {
  resultCache.clear()
}

// ─── Pre-compiled pattern RegExp ──────────────────────────────────────────────
// Converts urlPatterns array into a single RegExp — one test() call
// instead of looping through every pattern with String.includes().

let compiledPatterns = null

function rebuildPatternRegex() {
  const all = [...urlPatterns, ...customRules.filter(Boolean)]
  if (!all.length) { compiledPatterns = null; return }
  const escaped = all.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  compiledPatterns = new RegExp(escaped.join('|'), 'i')
}

// ─── Fast hostname extraction (avoids new URL() object creation) ─────────────
// Parses hostname directly from the URL string — ~5x faster than new URL().

function fastHostname(url) {
  const ci = url.indexOf('//')
  if (ci === -1) return ''
  let start = ci + 2
  let end   = start
  const len = url.length
  while (end < len) {
    const c = url.charCodeAt(end)
    // stop at '/', ':', '?', '#'
    if (c === 47 || c === 58 || c === 63 || c === 35) break
    end++
  }
  const raw = url.slice(start, end)
  // Return lowercase (avoid allocating a new string if already lower-case)
  return raw === raw.toLowerCase() ? raw : raw.toLowerCase()
}

// ─── Strict-mode extra categories ────────────────────────────────────────────

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
    if (Array.isArray(d.userWhitelist))    d.userWhitelist.forEach(x => userWhitelist.add(x))
    if (Array.isArray(d.customRules))      customRules = d.customRules
    if (typeof d.strictMode === 'boolean') strictMode  = d.strictMode
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

// ─── Platform ad URL patterns ─────────────────────────────────────────────────
// Checked BEFORE the essential whitelist so youtube.com/googlevideo.com/
// facebook.com ad requests are blocked even though those domains are whitelisted.

function isPlatformAdUrl(url) {
  const u = url.toLowerCase()
  if (u.includes('googlevideo.com/videoplayback') && (u.includes('adsid=') || u.includes('adformat='))) return true
  if (u.includes('youtube.com/api/stats/ads'))       return true
  if (u.includes('youtube.com/pagead/'))             return true
  if (u.includes('youtube.com/ptracking'))           return true
  if (u.includes('youtube.com/get_video_info') && u.includes('adformat')) return true
  if (u.includes('googleads.g.doubleclick.net'))     return true
  if (u.includes('static.doubleclick.net'))          return true
  if (u.includes('facebook.com/ads/'))               return true
  if (u.includes('an.facebook.com/'))                return true
  if (u.includes('connect.facebook.net/') && u.includes('sdk.js')) return true
  if (u.includes('fbcdn.net/') && u.includes('/ads/')) return true
  return false
}

// ─── Domain walking ───────────────────────────────────────────────────────────
// Walk hostname + all parent domains against a set.

function walkDomains(hostname, set) {
  if (!hostname) return false
  if (set.has(hostname)) return true
  const parts = hostname.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    if (set.has(parts.slice(i).join('.'))) return true
  }
  return false
}

const isEssentialDomain = h => walkDomains(h, essentialSet)
const isUserWhitelisted  = h => walkDomains(h, userWhitelist)
const isStrictBlocked    = h => strictMode && walkDomains(h, STRICT_DOMAINS)

function isDomainBlocked(hostname) {
  if (!hostname) return false

  // Bloom filter fast-path: if bloom says NO, it's definitely not blocked.
  // Saves the Set.has() + subdomain walk for the majority of clean domains.
  if (!bloom.test(hostname)) {
    // Still need to check parent domains (e.g. "ads.evil.com" when only "evil.com" is in bloom)
    const parts = hostname.split('.')
    let parentBlocked = false
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.')
      if (bloom.test(parent) && blockedDomains.has(parent)) {
        parentBlocked = true
        break
      }
    }
    if (!parentBlocked) return false
  }

  // Bloom said maybe — do the authoritative Set check
  if (blockedDomains.has(hostname)) return true
  if (whitelistedDomains.has(hostname)) return false
  const parts = hostname.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    const p = parts.slice(i).join('.')
    if (blockedDomains.has(p)) return true
  }
  return false
}

function isPatternBlocked(url) {
  return compiledPatterns ? compiledPatterns.test(url) : false
}

// ─── Main blocking decision ───────────────────────────────────────────────────

function shouldBlock(url) {
  if (!isEnabled) return false
  if (!url) return false

  // Skip non-web schemes
  const schemeEnd = url.indexOf(':')
  if (schemeEnd > 0) {
    const scheme = url.slice(0, schemeEnd)
    if (scheme === 'file' || scheme === 'about' || scheme === 'devtools' ||
        scheme === 'chrome-extension' || scheme === 'data' || scheme === 'blob') return false
  }

  // Platform ad check (before essential whitelist)
  if (isPlatformAdUrl(url)) return true

  const h = fastHostname(url)

  // Check result cache first
  const cached = getCached(h)
  if (cached !== null) return cached

  // Compute result
  let result = false
  if (!isEssentialDomain(h) && !isUserWhitelisted(h)) {
    result = isDomainBlocked(h) || isPatternBlocked(url) || isStrictBlocked(h)
  }

  setCached(h, result)
  return result
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
    enabled: isEnabled, strictMode,
    userWhitelist: [...userWhitelist], customRules,
    blockedLog: [...blockedLog].reverse(),
    stats: { todayDate, todayCount, allTimeCount, sessionCount: blockedCount },
    domains: blockedDomains.size,
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
    rebuildBloom()                          // update bloom with new domains
    invalidateCache()                       // clear stale hostname decisions
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
  ipcMain.on('adblocker-toggle', (_, enabled) => {
    isEnabled = Boolean(enabled)
    invalidateCache()
    console.log(`[AdBlocker] ${isEnabled ? 'Enabled' : 'Disabled'}`)
    sendState()
    broadcastSettingsUpdate()
  })

  ipcMain.handle('adblocker-get-state', () => ({
    enabled: isEnabled, count: blockedCount, domains: blockedDomains.size,
  }))

  ipcMain.handle('adblocker-get-settings', () => buildPayload())

  ipcMain.handle('adblocker-add-whitelist', (_, domain) => {
    const d = (domain || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (d) { userWhitelist.add(d); saveSettings(); invalidateCache() }
    return [...userWhitelist]
  })

  ipcMain.handle('adblocker-remove-whitelist', (_, domain) => {
    userWhitelist.delete(domain)
    saveSettings()
    invalidateCache()
    return [...userWhitelist]
  })

  ipcMain.handle('adblocker-force-update', async () => {
    await refreshFilterLists()
    return { domains: blockedDomains.size }
  })

  ipcMain.handle('adblocker-add-custom-rule', (_, rule) => {
    const r = (rule || '').trim().toLowerCase()
    if (r && !customRules.includes(r)) {
      customRules.push(r)
      saveSettings()
      rebuildPatternRegex()
      invalidateCache()
    }
    return customRules
  })

  ipcMain.handle('adblocker-remove-custom-rule', (_, rule) => {
    customRules = customRules.filter(r => r !== rule)
    saveSettings()
    rebuildPatternRegex()
    invalidateCache()
    return customRules
  })

  ipcMain.handle('adblocker-toggle-strict', (_, enabled) => {
    strictMode = Boolean(enabled)
    saveSettings()
    invalidateCache()
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

  // Build bloom filter and compile patterns before the first request arrives
  rebuildBloom()
  rebuildPatternRegex()

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      if (shouldBlock(details.url)) {
        blockedCount++

        const today = getTodayStr()
        if (today !== todayDate) { todayDate = today; todayCount = 0 }
        todayCount++
        allTimeCount++

        blockedLog.push({ url: details.url, domain: fastHostname(details.url), ts: Date.now() })
        if (blockedLog.length > BLOCKED_LOG_MAX) blockedLog.shift()

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
