'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  DNS-CACHE.JS  —  DNS prefetching and fastest-server auto-selection.
//  Prefetching primes the OS resolver cache so clicking links has zero DNS
//  latency.  At startup we race Cloudflare vs Google and keep the winner.
// ─────────────────────────────────────────────────────────────────────────────

const dns     = require('dns')
const { ipcMain, session } = require('electron')

// ─── In-memory prefetch cache ────────────────────────────────────────────────

const prefetched    = new Map()    // hostname -> expiry (ms timestamp)
const DNS_TTL_MS    = 60 * 60 * 1000   // 1 hour
const MAX_CACHE     = 5000

const CANDIDATE_SERVERS = [
  { name: 'Cloudflare', ip: '1.1.1.1', doh: 'https://cloudflare-dns.com/dns-query' },
  { name: 'Google',     ip: '8.8.8.8', doh: 'https://dns.google/dns-query'         },
]

// Trusted domains — already fast, skip prefetch for their own hostname
const SKIP_PREFETCH = new Set([
  'google.com', 'www.google.com', 'youtube.com', 'www.youtube.com',
  'localhost', '127.0.0.1',
])

// ─── Fastest DNS selection ────────────────────────────────────────────────────

function testServer(server) {
  return new Promise(resolve => {
    const resolver = new dns.Resolver()
    resolver.setServers([server.ip])
    const start = Date.now()
    resolver.resolve4('example.com', err => {
      resolve({ server, ms: err ? 99999 : Date.now() - start })
    })
    setTimeout(() => resolve({ server, ms: 99999 }), 2000)   // 2s timeout
  })
}

async function pickFastestDns() {
  try {
    const results = await Promise.all(CANDIDATE_SERVERS.map(testServer))
    results.sort((a, b) => a.ms - b.ms)
    const winner = results[0].server

    console.log(`[DNS] Fastest: ${winner.name} (${results[0].ms}ms) vs ${results[1]?.server.name} (${results[1]?.ms}ms)`)

    // Set DNS-over-HTTPS if Electron supports it
    const ses = session.defaultSession
    if (typeof ses.setDnsoverHttpsMode === 'function') {
      ses.setDnsoverHttpsMode('secure', { server: winner.doh })
      console.log(`[DNS] DoH → ${winner.doh}`)
    }
  } catch (e) {
    console.log('[DNS] Speed test failed:', e.message)
  }
}

// ─── Prefetch ─────────────────────────────────────────────────────────────────

function isExpired(ts) {
  return Date.now() > ts
}

function prefetch(hostnames) {
  if (!Array.isArray(hostnames)) return

  for (const host of hostnames) {
    if (!host || typeof host !== 'string') continue
    if (SKIP_PREFETCH.has(host)) continue

    const existing = prefetched.get(host)
    if (existing && !isExpired(existing)) continue   // still fresh

    // Evict oldest entry on overflow
    if (prefetched.size >= MAX_CACHE) {
      const oldest = prefetched.keys().next().value
      prefetched.delete(oldest)
    }

    prefetched.set(host, Date.now() + DNS_TTL_MS)

    // Fire-and-forget: primes the OS resolver cache
    dns.lookup(host, { family: 4 }, () => {})
  }
}

// Parallel prefetch with concurrency limit
function prefetchBatch(hostnames, concurrency = 8) {
  if (!hostnames?.length) return

  const unique = [...new Set(hostnames)].filter(h => {
    const ts = prefetched.get(h)
    return !ts || isExpired(ts)
  })

  if (!unique.length) return

  let i = 0
  function next() {
    if (i >= unique.length) return
    const host = unique[i++]
    prefetched.set(host, Date.now() + DNS_TTL_MS)
    dns.lookup(host, { family: 4 }, () => next())
  }

  for (let j = 0; j < Math.min(concurrency, unique.length); j++) next()
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

function setupIpc() {
  // Renderer sends an array of hostnames it found on the current page
  ipcMain.on('dns-prefetch', (_, hostnames) => {
    prefetchBatch(hostnames)
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

function init() {
  setupIpc()

  // Test DNS speed after a short delay so it doesn't compete with startup I/O
  setTimeout(pickFastestDns, 3000)

  console.log('[DNS] Cache/prefetch ready')
}

module.exports = { init, prefetch, prefetchBatch }
