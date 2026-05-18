'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  PROXY-ROTATOR.JS
//  Fetches free SOCKS5 and HTTP proxies from multiple sources,
//  tests them concurrently, and maintains a ranked working list.
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https')
const http  = require('http')
const net   = require('net')

// ─── Sources ──────────────────────────────────────────────────────────────────

const SOCKS5_SOURCES = [
  { url: 'https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks5&timeout=10000&country=all', type: 'socks5' },
  { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',                    type: 'socks5' },
]

const HTTP_SOURCES = [
  { url: 'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all',  type: 'http'   },
  { url: 'https://www.proxy-list.download/api/v1/get?type=https',                                       type: 'http'   },
  { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',                      type: 'http'   },
]

// Per-country SOCKS5 sources (proxyscrape supports country filter)
const COUNTRY_URL = (cc, type) =>
  `https://api.proxyscrape.com/v2/?request=getproxies&protocol=${type}&timeout=10000&country=${cc.toUpperCase()}`

// Preferred country order for auto-selection (harder to detect, geographically diverse)
const PREFERRED_COUNTRIES = ['NL', 'DE', 'SE', 'CH', 'CA', 'US', 'FR', 'GB']

// ─── Raw text fetch ───────────────────────────────────────────────────────────

function fetchText(urlStr) {
  return new Promise((resolve, reject) => {
    const mod    = urlStr.startsWith('https') ? https : http
    const req    = mod.get(urlStr, { timeout: 15000 }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return }
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end',  () => resolve(raw))
      res.on('error', reject)
    })
    req.on('error',   reject)
    req.on('timeout', function () { this.destroy(); reject(new Error('Timeout')) })
  })
}

// ─── Parse proxy list text → array of proxy objects ──────────────────────────

const IP_PORT_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}$/

function parseLines(text, type, country) {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => IP_PORT_RE.test(l))
    .map(l => {
      const [ip, portStr] = l.split(':')
      return { ip, port: parseInt(portStr, 10), type: type || 'socks5', country: country || 'ANY', speed: null, status: 'untested' }
    })
}

// ─── Fetch from one source ────────────────────────────────────────────────────

async function fetchSource(src, country) {
  const url = country ? COUNTRY_URL(country, src.type) : src.url
  try {
    const text = await fetchText(url)
    const list = parseLines(text, src.type, country?.toUpperCase() || 'ANY')
    console.log(`[Rotator] ${src.url.slice(0, 60)}… → ${list.length} proxies`)
    return list
  } catch (e) {
    console.warn('[Rotator] Source failed:', src.url.slice(0, 60), e.message)
    return []
  }
}

// ─── Fetch all sources (parallel) ────────────────────────────────────────────

async function fetchAll(country) {
  const cc = (country && country.toLowerCase() !== 'all') ? country : null
  const allSources = [...SOCKS5_SOURCES, ...HTTP_SOURCES]

  const results = await Promise.allSettled(
    allSources.map(src => fetchSource(src, cc))
  )

  const combined = []
  const seen     = new Set()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const p of r.value) {
      const key = `${p.ip}:${p.port}`
      if (!seen.has(key)) { seen.add(key); combined.push(p) }
    }
  }

  // If country specified and we got nothing, fall back to any country
  if (cc && combined.length < 5) {
    console.log('[Rotator] Country filter returned few results — adding global list')
    const fallback = await Promise.allSettled(SOCKS5_SOURCES.map(s => fetchSource(s, null)))
    for (const r of fallback) {
      if (r.status !== 'fulfilled') continue
      for (const p of r.value) {
        const key = `${p.ip}:${p.port}`
        if (!seen.has(key)) { seen.add(key); combined.push(p) }
      }
    }
  }

  console.log(`[Rotator] Total: ${combined.length} unique proxies`)
  return combined.slice(0, 200)  // cap to avoid memory bloat
}

// ─── Test a SOCKS5 proxy ──────────────────────────────────────────────────────
// Performs SOCKS5 handshake then CONNECT to api.ipify.org:443

function testSocks5(proxy) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const sock  = new net.Socket()
    let settled = false
    let step    = 0
    let buf     = Buffer.alloc(0)

    function done(err, result) {
      if (settled) return; settled = true; sock.destroy()
      if (err) reject(err); else resolve(result)
    }

    sock.setTimeout(6000)
    sock.connect(proxy.port, proxy.ip, () => {
      sock.write(Buffer.from([0x05, 0x01, 0x00]))  // SOCKS5, 1 auth method, no-auth
    })

    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk])
      if (step === 0) {
        if (buf.length < 2) return
        if (buf[0] !== 0x05 || buf[1] !== 0x00) { done(new Error('auth rejected')); return }
        buf = buf.slice(2); step = 1
        const host    = 'api.ipify.org'
        const hb      = Buffer.from(host)
        const req     = Buffer.alloc(7 + hb.length)
        req[0]=0x05; req[1]=0x01; req[2]=0x00; req[3]=0x03; req[4]=hb.length
        hb.copy(req, 5)
        req.writeUInt16BE(443, 5 + hb.length)
        sock.write(req)
        return
      }
      if (step === 1) {
        if (buf.length < 10) return
        if (buf[1] !== 0x00) { done(new Error('CONNECT failed code=' + buf[1])); return }
        done(null, { ms: Date.now() - start })
      }
    })
    sock.on('timeout', () => done(new Error('timeout')))
    sock.on('error',   e  => done(e))
    sock.on('close',   () => { if (!settled) done(new Error('closed')) })
  })
}

// ─── Test an HTTP CONNECT proxy ───────────────────────────────────────────────

function testHttpProxy(proxy) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const sock  = new net.Socket()
    let settled = false
    let raw     = ''

    function done(err, result) {
      if (settled) return; settled = true; sock.destroy()
      if (err) reject(err); else resolve(result)
    }

    sock.setTimeout(6000)
    sock.connect(proxy.port, proxy.ip, () => {
      sock.write('CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\n\r\n')
    })
    sock.on('data', chunk => {
      raw += chunk.toString()
      if (raw.includes('\r\n\r\n') || raw.length > 512) {
        if (/^HTTP\/1\.[01] 200/i.test(raw)) {
          done(null, { ms: Date.now() - start })
        } else {
          done(new Error('CONNECT rejected'))
        }
      }
    })
    sock.on('timeout', () => done(new Error('timeout')))
    sock.on('error',   e  => done(e))
    sock.on('close',   () => { if (!settled) done(new Error('closed')) })
  })
}

// ─── Test one proxy ───────────────────────────────────────────────────────────

async function testOne(proxy) {
  try {
    const result = proxy.type === 'http' ? await testHttpProxy(proxy) : await testSocks5(proxy)
    proxy.speed  = result.ms
    proxy.status = result.ms < 500 ? 'fast' : result.ms < 1500 ? 'ok' : 'slow'
    return proxy
  } catch (e) {
    proxy.speed  = null
    proxy.status = 'dead'
    return proxy
  }
}

// ─── Batch test with concurrency cap ─────────────────────────────────────────

async function testBatch(proxies, concurrency = 30, speedLimit = 1500) {
  const queue   = [...proxies]
  const results = []

  async function worker() {
    while (queue.length) {
      const p = queue.shift()
      if (!p) break
      await testOne(p)
      results.push(p)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, proxies.length) }, worker)
  await Promise.allSettled(workers)

  return results
    .filter(p => p.status === 'fast' || p.status === 'ok')
    .filter(p => (p.speed || 9999) <= speedLimit)
    .sort((a, b) => (a.speed || 9999) - (b.speed || 9999))
}

// ─── Get next working proxy for a country ────────────────────────────────────
// Tries preferred countries in order if exact match not found

function getNextProxy(list, excludeIp, preferCountry) {
  const cc = preferCountry?.toUpperCase()

  // Try exact country match first
  if (cc && cc !== 'ALL' && cc !== 'ANY') {
    const match = list.find(p =>
      p.country === cc &&
      (p.status === 'fast' || p.status === 'ok') &&
      p.ip !== excludeIp
    )
    if (match) return match
  }

  // Try preferred countries
  for (const pcc of PREFERRED_COUNTRIES) {
    if (pcc === cc) continue
    const match = list.find(p =>
      p.country === pcc &&
      (p.status === 'fast' || p.status === 'ok') &&
      p.ip !== excludeIp
    )
    if (match) return match
  }

  // Any fast/ok proxy
  return list.find(p =>
    (p.status === 'fast' || p.status === 'ok') && p.ip !== excludeIp
  ) || null
}

module.exports = { fetchAll, testOne, testBatch, getNextProxy }
