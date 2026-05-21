'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  filter-updater.js  —  Layer 7: Automatic filter list downloader & cache
//
//  Downloads EasyList + EasyPrivacy + Disconnect from CDN.
//  Parses ABP and hosts-file format into domain lists.
//  Feeds all parsed domains into the FilterEngine singleton.
//  Saves raw list files to disk so they survive without internet.
//  Auto-refreshes every 24 hours.
// ═══════════════════════════════════════════════════════════════════════════════

const { app, net, BrowserWindow } = require('electron')
const path = require('path')
const fs   = require('fs')

const filterEngine = require('./filter-engine')

const UPDATE_INTERVAL = 24 * 60 * 60 * 1000   // 24 hours

const FILTER_SOURCES = [
  {
    name: 'EasyList',
    url:  'https://easylist.to/easylist/easylist.txt',
    file: 'easylist.txt',
  },
  {
    name: 'EasyPrivacy',
    url:  'https://easylist.to/easylist/easyprivacy.txt',
    file: 'easyprivacy.txt',
  },
  {
    name: 'Disconnect Tracking',
    url:  'https://s3.amazonaws.com/lists.disconnect.me/simple_tracking.txt',
    file: 'disconnect.txt',
  },
]

// ── Parser: ABP filter format + hosts file format ─────────────────────────────
// Handles:
//   ||example.com^              EasyList domain rule
//   ||example.com^$third-party  with options
//   0.0.0.0 example.com         hosts-file format
//   127.0.0.1 example.com       hosts-file format
// Everything else (CSS rules, element hiding, regex rules) is ignored.

function parseFilterList (text) {
  const domains = []
  for (const raw of text.split('\n')) {
    const l = raw.trim()
    if (!l || l.startsWith('!') || l.startsWith('[') || l.startsWith('#')) continue

    // EasyList / ABP domain rule:  ||example.com^
    if (l.startsWith('||')) {
      let d = l.slice(2)
      // Strip everything from the caret (options) onward
      const ci = d.indexOf('^')
      if (ci !== -1) d = d.slice(0, ci)
      // Strip path segments
      const si = d.indexOf('/')
      if (si !== -1) d = d.slice(0, si)
      d = d.toLowerCase()
      if (d && d.includes('.') && d.length > 4 && d.length < 128 &&
          !d.includes('*') && !d.includes(' ')) {
        domains.push(d)
      }
      continue
    }

    // Hosts-file format:  0.0.0.0 example.com  or  127.0.0.1 example.com
    if (l.startsWith('0.0.0.0') || l.startsWith('127.0.0.1')) {
      const parts = l.split(/\s+/)
      if (parts.length >= 2) {
        const d = parts[1].toLowerCase()
        if (d !== 'localhost' && d !== 'local' &&
            d.includes('.') && d.length > 4 && !d.includes('*')) {
          domains.push(d)
        }
      }
    }
  }
  return domains
}

// ── Lazy path helpers (safe to call before app ready) ────────────────────────

function getListDir () {
  return path.join(app.getPath('userData'), 'filterlists')
}

function getMetaFile () {
  return path.join(app.getPath('userData'), 'filterlists-meta.json')
}

// ── Cache freshness check ─────────────────────────────────────────────────────

function isCacheFresh () {
  try {
    const meta = JSON.parse(fs.readFileSync(getMetaFile(), 'utf8'))
    return Boolean(meta.ts) && (Date.now() - meta.ts) < UPDATE_INTERVAL
  } catch { return false }
}

function writeMeta (domainCount) {
  try {
    fs.writeFileSync(getMetaFile(),
      JSON.stringify({ ts: Date.now(), domainCount }, null, 2), 'utf8')
  } catch (_) {}
}

// ── Broadcast update status to all open windows ───────────────────────────────
// Uses the same channel name as the old adblocker.js so the settings panel
// receives progress messages without any changes.

function broadcast (msg) {
  try {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('adblocker-update-status', msg)
    })
  } catch (_) {}
}

// ── Network fetch via Electron's net module ───────────────────────────────────

function fetchText (url) {
  return new Promise((resolve, reject) => {
    try {
      const req = net.request(url)
      let   body = ''
      req.on('response', res => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        res.on('data',  chunk => { body += chunk.toString() })
        res.on('end',   ()    => resolve(body))
        res.on('error', reject)
      })
      req.on('error', reject)
      req.end()
    } catch (e) { reject(e) }
  })
}

// ── Load cached lists from disk into filter-engine (no network required) ──────

function loadFromCache () {
  const dir = getListDir()
  let total = 0
  for (const src of FILTER_SOURCES) {
    try {
      const text    = fs.readFileSync(path.join(dir, src.file), 'utf8')
      const domains = parseFilterList(text)
      for (const d of domains) filterEngine.addDomain(d)
      total += domains.length
    } catch (_) {}
  }
  if (total > 0) {
    console.log(`[FilterUpdater] Loaded ${total.toLocaleString()} domains from disk cache`)
  }
}

// ── Download, parse, and merge into filter-engine ────────────────────────────

async function update (force = false) {
  if (!force && isCacheFresh()) {
    console.log('[FilterUpdater] Cache is fresh — skipping network download')
    return
  }

  broadcast({ phase: 'start' })

  const dir = getListDir()
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }) } catch (_) {}
  }

  let totalAdded = 0

  for (const src of FILTER_SOURCES) {
    broadcast({ phase: 'downloading', name: src.name })
    try {
      const text    = await fetchText(src.url)
      const domains = parseFilterList(text)
      let   added   = 0
      for (const d of domains) {
        if (!filterEngine.domainSet.has(d)) {
          filterEngine.addDomain(d)
          added++
        }
      }
      totalAdded += added
      // Persist raw list for offline startup
      try {
        fs.writeFileSync(path.join(dir, src.file), text, 'utf8')
      } catch (_) {}
      console.log(`[FilterUpdater] ${src.name}: +${added.toLocaleString()} new ` +
                  `(${domains.length.toLocaleString()} parsed)`)
    } catch (e) {
      console.warn(`[FilterUpdater] ${src.name} failed: ${e.message}`)
      broadcast({ phase: 'error', name: src.name, error: e.message })
      // Fall back to cached list on error
      try {
        const cached  = fs.readFileSync(path.join(dir, src.file), 'utf8')
        const domains = parseFilterList(cached)
        for (const d of domains) filterEngine.addDomain(d)
        console.log(`[FilterUpdater] ${src.name}: loaded from cached copy`)
      } catch (_) {}
    }
  }

  writeMeta(filterEngine.domainSet.size)
  broadcast({ phase: 'done', domains: filterEngine.domainSet.size })
  console.log(`[FilterUpdater] Done — ${filterEngine.domainSet.size.toLocaleString()} total domains`)
}

// ── Public API ────────────────────────────────────────────────────────────────

let _started = false

function init () {
  if (_started) return
  _started = true

  // Immediately load cached lists (fast — no network, just file reads)
  loadFromCache()

  // Background download if cache is stale — wait 5s for app to fully start
  setTimeout(() => update(false), 5000)

  // Auto-refresh every 24 hours
  setInterval(() => update(false), UPDATE_INTERVAL)
}

module.exports = { init, update, parseFilterList }
