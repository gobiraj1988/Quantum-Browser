'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  PROXY.JS  —  Main proxy/VPN controller
//  Key change from v1: uses socks5h (remote DNS) instead of socks5.
//  socks5h = proxy server resolves hostnames — no local DNS leak.
// ─────────────────────────────────────────────────────────────────────────────

const { session, BrowserWindow, ipcMain, net: electronNet } = require('electron')
const path  = require('path')
const https = require('https')  // Node https — bypasses session proxy, for real-IP checks

const dnsProtection     = require('./dns-protection')
const webrtcBlocker     = require('./webrtc-blocker')
const proxyRotator      = require('./proxy-rotator')
const fingerprintSpoofer = require('./fingerprint-spoofer')

// ─── State ────────────────────────────────────────────────────────────────────

let mainWin  = null
let proxyWin = null

const state = {
  enabled:      false,
  currentProxy: null,
  proxyList:    [],
  realIp:       null,
  proxyIp:      null,
  autoSwitch:   false,
  // new VPN protection status fields
  dnsServer:    null,
  webrtcBlocked: false,
  fpSpoofed:    false,
  country:      null,
}

let autoTimer = null

// ─── Legacy fetchProxyList (kept for backward compat with proxy-manager UI) ───
// Delegates to proxy-rotator.js

async function fetchProxyList(country) {
  const list = await proxyRotator.fetchAll(country)
  return list
}

// ─── Test a single proxy ──────────────────────────────────────────────────────

async function testProxy(proxy) {
  return proxyRotator.testOne(proxy)
}

// ─── Verify via Electron net (same networking path as webviews) ───────────────
// IMPORTANT: must pass session explicitly — without it electronNet uses the
// system proxy, not the Electron session proxy we set with setProxy().

function verifyViaElectronNet() {
  return new Promise((resolve, reject) => {
    const req   = electronNet.request({
      url:     'https://api.ipify.org?format=json',
      session: session.defaultSession,   // ← critical: use session with our proxy
    })
    let raw     = ''
    const timer = setTimeout(() => { try { req.abort() } catch (_) {}; reject(new Error('Timeout')) }, 12000)
    req.on('response', res => {
      res.on('data', c => { raw += c.toString() })
      res.on('end', () => {
        clearTimeout(timer)
        try   { resolve(JSON.parse(raw).ip) }
        catch { reject(new Error('Bad response')) }
      })
      res.on('error', err => { clearTimeout(timer); reject(err) })
    })
    req.on('error', err => { clearTimeout(timer); reject(err) })
    req.end()
  })
}

// ─── Real IP via Node https (never uses session proxy) ────────────────────────

function getRealIp() {
  return new Promise((resolve, reject) => {
    https.get('https://api.ipify.org?format=json', { timeout: 8000 }, res => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => {
        try { resolve(JSON.parse(raw).ip) }
        catch { reject(new Error('Bad response')) }
      })
    }).on('error', reject)
      .on('timeout', function () { this.destroy(); reject(new Error('Timeout')) })
  })
}

// ─── Apply / clear session proxy ─────────────────────────────────────────────
// CRITICAL: socks5h routes DNS through the proxy server.
// Without 'h', Chromium resolves DNS locally first (DNS leak).

async function applyProxy(proxy) {
  const rule = dnsProtection.buildProxyRule(proxy)
  await session.defaultSession.setProxy({
    proxyRules:       rule,
    proxyBypassRules: '<local>',
  })
  console.log('[Proxy] Session proxy rule:', rule)
}

async function clearProxy() {
  await session.defaultSession.setProxy({ proxyRules: 'direct://' })
}

// ─── Connect ──────────────────────────────────────────────────────────────────

async function connect(proxy) {
  await applyProxy(proxy)

  state.enabled      = true
  state.currentProxy = { ...proxy }
  state.proxyIp      = null

  const countryCode = proxy.country && proxy.country !== 'ANY' ? proxy.country : 'US'
  state.country     = countryCode

  // ── DNS protection ─────────────────────────────────────────────────────────
  const { data: countryData, doh } = dnsProtection.enable(countryCode)
  state.dnsServer = doh

  // ── WebRTC block ───────────────────────────────────────────────────────────
  webrtcBlocker.enable()
  state.webrtcBlocked = true

  // ── Fingerprint spoof ──────────────────────────────────────────────────────
  fingerprintSpoofer.enable(countryData)
  state.fpSpoofed = true

  push()
  console.log('[Proxy] Connected →', proxy.ip + ':' + proxy.port, '(' + countryCode + ')')

  // ── Verify the session actually routes through the proxy ───────────────────
  // socks5h = proxy resolves DNS (no leak). Some proxies reject hostname
  // resolution; if verification shows real IP, fall back to plain socks5.
  let verifiedIp = null

  try {
    const ip = await verifyViaElectronNet()
    if (ip && ip !== state.realIp) {
      verifiedIp = ip
      console.log('[Proxy] Verified ✓ socks5h — proxy IP:', ip)
    } else {
      // socks5h not routing — retry with socks5 (local DNS, less ideal but works)
      console.log('[Proxy] socks5h not routing — retrying with socks5...')
      await session.defaultSession.setProxy({
        proxyRules:       `socks5=${proxy.ip}:${proxy.port}`,
        proxyBypassRules: '<local>',
      })
      try {
        const ip2 = await verifyViaElectronNet()
        if (ip2 && ip2 !== state.realIp) {
          verifiedIp = ip2
          console.log('[Proxy] Verified ✓ socks5 fallback — proxy IP:', ip2)
        } else {
          console.warn('[Proxy] Proxy not routing traffic — both socks5h and socks5 returned real IP')
        }
      } catch (e2) {
        console.warn('[Proxy] socks5 fallback verification failed:', e2.message)
      }
    }
  } catch (err) {
    console.warn('[Proxy] Verification failed:', err.message)
  }

  state.proxyIp = verifiedIp
  startAutoTimer()
  push()
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

async function disconnect() {
  await clearProxy()
  dnsProtection.disable()
  webrtcBlocker.disable()
  fingerprintSpoofer.disable()

  state.enabled       = false
  state.currentProxy  = null
  state.proxyIp       = null
  state.dnsServer     = null
  state.webrtcBlocked = false
  state.fpSpoofed     = false
  state.country       = null

  stopAutoTimer()
  console.log('[Proxy] Disconnected — all protections removed')
  push()
}

// ─── Auto-switch ──────────────────────────────────────────────────────────────

function startAutoTimer() {
  stopAutoTimer()
  if (!state.autoSwitch) return
  autoTimer = setInterval(async () => {
    if (!state.enabled || !state.currentProxy) return
    try {
      const r = await testProxy(state.currentProxy)
      if ((r.speed || 9999) > 5000) doAutoSwitch()
    } catch { doAutoSwitch() }
  }, 30000)
}

function stopAutoTimer() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null }
}

async function doAutoSwitch() {
  const next = proxyRotator.getNextProxy(
    state.proxyList,
    state.currentProxy?.ip,
    state.currentProxy?.country
  )
  if (!next) { console.warn('[Proxy] Auto-switch: no backup proxy available'); return }
  console.log('[Proxy] Auto-switching to', next.ip + ':' + next.port)
  await connect(next)
}

// ─── Push state to all windows ────────────────────────────────────────────────

function buildPayload() {
  return {
    enabled:      state.enabled,
    currentProxy: state.currentProxy,
    realIp:       state.realIp,
    proxyIp:      state.proxyIp,
    autoSwitch:   state.autoSwitch,
    proxyList:    state.proxyList,
    // VPN protection status
    dnsServer:    state.dnsServer,
    webrtcBlocked: state.webrtcBlocked,
    fpSpoofed:    state.fpSpoofed,
    country:      state.country,
  }
}

function push() {
  const payload = buildPayload()
  if (mainWin  && !mainWin.isDestroyed())  mainWin.webContents.send('proxy-state',  payload)
  if (proxyWin && !proxyWin.isDestroyed()) proxyWin.webContents.send('proxy-state', payload)
}

// ─── Open proxy manager window ────────────────────────────────────────────────

function openProxyManager() {
  if (proxyWin && !proxyWin.isDestroyed()) { proxyWin.focus(); return }
  proxyWin = new BrowserWindow({
    width: 860, height: 660, minWidth: 680, minHeight: 500,
    title: 'Proxy Manager', backgroundColor: '#202124', show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  })
  proxyWin.loadFile('proxy-manager.html')
  proxyWin.setMenuBarVisibility(false)
  proxyWin.once('ready-to-show', () => { proxyWin.show(); push() })
  proxyWin.on('closed', () => { proxyWin = null })
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

function init(win) {
  mainWin = win
  console.log('[Proxy] Ready (socks5h DNS-leak fix active)')

  getRealIp()
    .then(ip => { state.realIp = ip; push(); console.log('[Proxy] Real IP:', ip) })
    .catch(err => console.warn('[Proxy] Real IP lookup failed:', err.message))

  ipcMain.handle('proxy-get-state', () => buildPayload())

  ipcMain.handle('proxy-fetch-list', async (_, country) => {
    console.log('[Proxy] Fetching proxies for:', country || 'any')
    try {
      const list      = await fetchProxyList(country)
      state.proxyList = list
      push()
      return { ok: true, count: list.length }
    } catch (err) {
      console.error('[Proxy] Fetch failed:', err.message)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('proxy-test-one', async (_, proxy) => {
    try {
      const updated = await testProxy(proxy)
      const item    = state.proxyList.find(p => p.ip === proxy.ip && p.port === proxy.port)
      if (item) { item.speed = updated.speed; item.status = updated.status }
      push()
      return { ok: true, ms: updated.speed }
    } catch (err) {
      const item = state.proxyList.find(p => p.ip === proxy.ip && p.port === proxy.port)
      if (item) { item.speed = null; item.status = 'dead' }
      push()
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('proxy-connect', async (_, proxy) => {
    try   { await connect(proxy); return { ok: true, proxyIp: state.proxyIp } }
    catch (err) { console.error('[Proxy] Connect error:', err.message); return { ok: false, error: err.message } }
  })

  ipcMain.handle('proxy-disconnect', async () => {
    try   { await disconnect(); return { ok: true } }
    catch (err) { return { ok: false, error: err.message } }
  })

  ipcMain.handle('proxy-get-real-ip', async () => {
    try { state.realIp = await getRealIp(); push(); return { ok: true, ip: state.realIp } }
    catch (err) { return { ok: false, error: err.message } }
  })

  ipcMain.handle('proxy-get-proxy-ip', async () => {
    try {
      const ip = state.enabled ? await verifyViaElectronNet() : null
      state.proxyIp = ip; push()
      return { ok: true, ip }
    } catch (err) { return { ok: false, error: err.message } }
  })

  ipcMain.handle('proxy-toggle-autoswitch', (_, val) => {
    state.autoSwitch = !!val
    if (state.autoSwitch && state.enabled) startAutoTimer()
    else stopAutoTimer()
    push()
    return { ok: true }
  })

  ipcMain.handle('open-proxy-manager', () => openProxyManager())
}

module.exports = { init, openProxyManager }
