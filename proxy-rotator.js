'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  PROXY-ROTATOR.JS  —  Multi-source proxy fetcher + concurrent tester
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https')
const http  = require('http')
const net   = require('net')

// ─── Proxy sources ────────────────────────────────────────────────────────────
// Each source has:
//   url       – where to fetch the raw ip:port list
//   type      – 'socks5' or 'http'
//   country   – true if this source supports country-filter query param
//   countryFn – function(cc) → URL with country filter applied

const SOURCES = [
  // ── proxyscrape v3 (try v3 first, v2 domain has DNS issues) ─────────────────
  {
    type: 'socks5',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=getproxies&protocol=socks5&timeout=5000&country=all',
    countryFn: cc => `https://api.proxyscrape.com/v3/free-proxy-list/get?request=getproxies&protocol=socks5&timeout=5000&country=${cc}`,
  },
  {
    type: 'http',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=getproxies&protocol=http&timeout=5000&country=all',
    countryFn: cc => `https://api.proxyscrape.com/v3/free-proxy-list/get?request=getproxies&protocol=http&timeout=5000&country=${cc}`,
  },
  // ── proxyscrape v2 fallback ──────────────────────────────────────────────────
  {
    type: 'socks5',
    url: 'https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks5&timeout=10000&country=all',
    countryFn: cc => `https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks5&timeout=10000&country=${cc}`,
  },
  // ── GitHub raw lists (no country filter — filter client-side) ─────────────────
  { type: 'socks5', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt' },
  { type: 'socks5', url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt' },
  { type: 'socks5', url: 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt' },
  { type: 'socks5', url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt' },
  { type: 'socks5', url: 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt' },
  { type: 'socks5', url: 'https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt' },
  { type: 'http',   url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt' },
  { type: 'http',   url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt' },
  { type: 'http',   url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt' },
  // ── proxy-list.download ───────────────────────────────────────────────────────
  { type: 'http',   url: 'https://www.proxy-list.download/api/v1/get?type=https' },
  { type: 'socks5', url: 'https://www.proxy-list.download/api/v1/get?type=socks5' },
]

// ─── Fetch text: Node https → fallback to Electron net ───────────────────────
// Node https avoids session proxy; Electron net (fallback) uses Chromium stack.

function fetchTextNode(urlStr) {
  return new Promise((resolve, reject) => {
    const mod = urlStr.startsWith('https') ? https : http
    const req = mod.get(urlStr, { timeout: 18000 }, res => {
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

function fetchTextElectronNet(urlStr) {
  const { net } = require('electron')
  return new Promise((resolve, reject) => {
    let req
    const timer = setTimeout(() => {
      try { req?.abort() } catch (_) {}
      reject(new Error('Timeout'))
    }, 20000)
    try {
      req = net.request(urlStr)
      let raw = ''
      req.on('response', res => {
        res.on('data',  c => { raw += c.toString() })
        res.on('end',   () => { clearTimeout(timer); resolve(raw) })
        res.on('error', e => { clearTimeout(timer); reject(e) })
      })
      req.on('error', e => { clearTimeout(timer); reject(e) })
      req.end()
    } catch (e) { clearTimeout(timer); reject(e) }
  })
}

async function fetchText(urlStr) {
  try {
    return await fetchTextNode(urlStr)
  } catch (_) {
    return await fetchTextElectronNet(urlStr)  // Chromium networking as fallback
  }
}

// ─── Parse ip:port lines ──────────────────────────────────────────────────────

const IP_PORT_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}$/

function parseLines(text, type, countryHint) {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => IP_PORT_RE.test(l))
    .map(l => {
      const [ip, portStr] = l.split(':')
      return { ip, port: parseInt(portStr, 10), type: type || 'socks5', country: countryHint || 'ANY', speed: null, status: 'untested' }
    })
}

// ─── Fetch one source ─────────────────────────────────────────────────────────

async function fetchSource(src, countryCode) {
  // Only apply country filter to sources that explicitly support it (have countryFn)
  const url = (countryCode && src.countryFn) ? src.countryFn(countryCode.toUpperCase()) : src.url
  const label = url.slice(0, 65)
  try {
    const text = await fetchText(url)
    const list = parseLines(text, src.type, countryCode?.toUpperCase() || 'ANY')
    if (list.length) console.log(`[Rotator] ${label} → ${list.length} proxies`)
    return list
  } catch (e) {
    console.warn('[Rotator] Source failed:', label, e.message)
    return []
  }
}

// ─── Fetch all sources in parallel ───────────────────────────────────────────

async function fetchAll(country) {
  const cc = (country && country.toLowerCase() !== 'all') ? country : null

  const results = await Promise.allSettled(SOURCES.map(src => fetchSource(src, cc)))

  const combined = []
  const seen     = new Set()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const p of r.value) {
      const key = `${p.ip}:${p.port}`
      if (!seen.has(key)) { seen.add(key); combined.push(p) }
    }
  }

  console.log(`[Rotator] Total: ${combined.length} unique proxies from all sources`)
  return combined.slice(0, 300)
}

// ─── Test a SOCKS5 proxy ──────────────────────────────────────────────────────

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
      sock.write(Buffer.from([0x05, 0x01, 0x00]))
    })
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk])
      if (step === 0) {
        if (buf.length < 2) return
        if (buf[0] !== 0x05 || buf[1] !== 0x00) { done(new Error('auth rejected')); return }
        buf = buf.slice(2); step = 1
        const host = 'api.ipify.org'
        const hb   = Buffer.from(host)
        const req  = Buffer.alloc(7 + hb.length)
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
        if (/^HTTP\/1\.[01] 200/i.test(raw)) done(null, { ms: Date.now() - start })
        else done(new Error('CONNECT rejected'))
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
    const fn     = proxy.type === 'http' ? testHttpProxy : testSocks5
    const result = await fn(proxy)
    proxy.speed  = result.ms
    proxy.status = result.ms < 500 ? 'fast' : result.ms < 1500 ? 'ok' : 'slow'
  } catch {
    proxy.speed  = null
    proxy.status = 'dead'
  }
  return proxy
}

// ─── Batch test ───────────────────────────────────────────────────────────────

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

  await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, proxies.length) }, worker)
  )

  return results
    .filter(p => p.status === 'fast' || p.status === 'ok')
    .filter(p => (p.speed || 9999) <= speedLimit)
    .sort((a, b) => (a.speed || 9999) - (b.speed || 9999))
}

// ─── Get next working proxy ───────────────────────────────────────────────────

const PREFERRED = ['NL', 'DE', 'SE', 'CH', 'CA', 'US', 'FR', 'GB']

function getNextProxy(list, excludeIp, preferCountry) {
  const cc   = preferCountry?.toUpperCase()
  const good = p => (p.status === 'fast' || p.status === 'ok') && p.ip !== excludeIp

  if (cc && cc !== 'ALL' && cc !== 'ANY') {
    const m = list.find(p => good(p) && p.country === cc)
    if (m) return m
  }
  for (const pcc of PREFERRED) {
    const m = list.find(p => good(p) && p.country === pcc)
    if (m) return m
  }
  return list.find(good) || null
}

module.exports = { fetchAll, testOne, testBatch, getNextProxy }
