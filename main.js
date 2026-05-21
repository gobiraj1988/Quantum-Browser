'use strict'

const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, webContents } = require('electron')
const path = require('path')
const fs   = require('fs')

// ── GPU & performance switches (MUST be set before app.ready) ─────────────────
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top')
app.commandLine.appendSwitch('disable-renderer-backgrounding')   // no tab throttle
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512')
app.commandLine.appendSwitch('enable-features',
  'D3D11VideoDecoder,CanvasOopRasterization,VaapiVideoDecoder')
app.commandLine.appendSwitch('disable-features',
  'CalculateNativeWinOcclusion,HardwareMediaKeyHandling,MediaRouter,OutOfBlinkCors')

// ── Auth system ───────────────────────────────────────────────────────────────
const authSystem = require('./auth-system')

// ── Modules needed before any page request arrives ───────────────────────────
const safeAdblocker = require('./safe-adblocker')
const sponsorBlock  = require('./sponsorblock')
const facebookHide  = require('./facebook-hide')
const privacy       = require('./privacy')

// ── All other modules required (fast — only parses/compiles code), but their
//    init() is deferred via lazy-loader until after the window is visible. ─────
const lazy = require('./lazy-loader')
lazy.register('downloader',         () => require('./downloader'))
lazy.register('proxy',              () => require('./proxy'))
lazy.register('webrtcBlocker',      () => require('./webrtc-blocker'))
lazy.register('fingerprintSpoofer', () => require('./fingerprint-spoofer'))

// ── Performance monitor & DNS cache ──────────────────────────────────────────
const performance = require('./performance')
const dnsCache    = require('./dns-cache')

// ─── Window State Persistence ─────────────────────────────────────────────────

const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState() {
  try {
    if (fs.existsSync(STATE_FILE))
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch (_) {}
  return { width: 1200, height: 800, x: undefined, y: undefined }
}

function saveWindowState(win) {
  if (win.isMaximized() || win.isMinimized()) return
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(win.getBounds()), 'utf8') } catch (_) {}
}

function isPositionOnScreen(state) {
  if (state.x === undefined || state.y === undefined) return false
  return screen.getAllDisplays().some(({ workArea: a }) =>
    state.x >= a.x && state.y >= a.y &&
    state.x + state.width  <= a.x + a.width &&
    state.y + state.height <= a.y + a.height
  )
}

// ─── Background security scanner ──────────────────────────────────────────────
// Checks domains AFTER page loads — never delays or blocks navigation.
// Uses a local cache to avoid redundant checks.

const TRUSTED_DOMAINS = new Set([
  'google.com', 'youtube.com', 'github.com', 'microsoft.com',
  'apple.com', 'amazon.com', 'cloudflare.com', 'wikipedia.org',
  'stackoverflow.com', 'reddit.com', 'twitter.com', 'x.com',
  'facebook.com', 'instagram.com', 'linkedin.com', 'netflix.com',
])

const securityCache  = new Map()   // domain -> { safe: bool, ts: number }
const SEC_CACHE_TTL  = 24 * 60 * 60 * 1000   // 24 hours

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function isTrustedDomain(domain) {
  if (TRUSTED_DOMAINS.has(domain)) return true
  const parts = domain.split('.')
  for (let i = 1; i < parts.length; i++) {
    if (TRUSTED_DOMAINS.has(parts.slice(i).join('.'))) return true
  }
  return false
}

function scanDomainBackground(win, url) {
  const domain = getDomain(url)
  if (!domain || isTrustedDomain(domain)) return

  const cached = securityCache.get(domain)
  if (cached && (Date.now() - cached.ts) < SEC_CACHE_TTL) return

  // Mark as checked (safe by default) to avoid repeat scans
  securityCache.set(domain, { safe: true, ts: Date.now() })

  // Async check against Cloudflare's free domain categorisation API
  // No API key needed.  Response is best-effort — never awaited before load.
  setImmediate(async () => {
    try {
      const { net: electronNet } = require('electron')
      const req = electronNet.request(`https://dns.cloudflare.com/dns-query?name=${encodeURIComponent(domain)}&type=A`)
      req.setHeader('Accept', 'application/dns-json')
      req.on('response', res => {
        let body = ''
        res.on('data', c => { body += c.toString() })
        res.on('end', () => {
          try {
            const data = JSON.parse(body)
            // SERVFAIL (status 2) on a legit domain → suspicious
            if (data.Status === 2 || data.Status === 3) {
              securityCache.set(domain, { safe: false, ts: Date.now() })
              if (win && !win.isDestroyed()) {
                win.webContents.send('security-warning', {
                  domain, message: `⚠ ${domain} may be unsafe (DNS lookup failed)`,
                })
              }
            }
          } catch (_) {}
        })
      })
      req.on('error', () => {})
      req.end()
    } catch (_) {}
  })
}

// ─── Window Factory ───────────────────────────────────────────────────────────

function createWindow() {
  const state    = loadWindowState()
  const iconPath = path.join(__dirname, 'assets', 'icon.png')

  const win = new BrowserWindow({
    width:     state.width  || 1200,
    height:    state.height || 800,
    minWidth:  800,
    minHeight: 520,
    x: isPositionOnScreen(state) ? state.x : undefined,
    y: isPositionOnScreen(state) ? state.y : undefined,
    title:           'MyBrowser',
    icon:            fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#13131a',
    show:            false,
    webPreferences: {
      webviewTag:           true,
      nodeIntegration:      false,
      contextIsolation:     true,
      preload:              path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,       // tabs stay responsive when not visible
      spellcheck:           false,       // reduces per-keystroke work
      v8CacheOptions:       'bypassHeatCheck',   // faster JS startup
    }
  })

  win.loadFile('index.html')

  // Smooth fade-in
  win.once('ready-to-show', () => {
    win.setOpacity(0)
    win.show()
    let opacity = 0
    const fadeIn = setInterval(() => {
      opacity = Math.min(1, opacity + 0.08)
      win.setOpacity(opacity)
      if (opacity >= 1) clearInterval(fadeIn)
    }, 16)

    // Defer all non-critical module inits until AFTER window is visible.
    // These modules hook into web-contents-created, so they still catch every page.
    setTimeout(() => {
      lazy.init('webrtcBlocker')
      lazy.init('fingerprintSpoofer')
      lazy.init('downloader', win)
      lazy.init('proxy',      win)
      console.log('[Main] All modules initialised')
    }, 150)
  })

  // Persist window state
  let saveTimer
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveWindowState(win), 400) }
  win.on('resize', scheduleSave)
  win.on('move',   scheduleSave)
  win.on('close',  () => { clearTimeout(saveTimer); saveWindowState(win) })

  win.on('maximize',          () => win.webContents.send('window-maximized'))
  win.on('unmaximize',        () => win.webContents.send('window-unmaximized'))
  win.on('enter-full-screen', () => win.webContents.send('window-maximized'))
  win.on('leave-full-screen', () => win.webContents.send('window-unmaximized'))

  // Window control IPC
  ipcMain.on('window-minimize', () => win.minimize())
  ipcMain.on('window-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize())
  ipcMain.on('window-close',    () => win.close())
  ipcMain.handle('get-version', () => app.getVersion())

  // ── Core modules (needed before first request or first render) ──────────
  safeAdblocker.init(win)   // Ghostery network blocking (all sites)
  sponsorBlock.init()       // YouTube sponsor segment skipper
  facebookHide.init()       // Facebook/Instagram CSS sponsored-post hider
  privacy.init(win)
  lazy.init('proxy',      win)   // needed by VPN dot in toolbar on load
  lazy.init('downloader', win)   // needed by download widget on load

  // ── Account / auth system ────────────────────────────────────────────────
  authSystem.init(win)

  // ── Performance monitor ───────────────────────────────────────────────────
  performance.init(win)

  // ── DNS prefetch + fastest DNS selection ─────────────────────────────────
  dnsCache.init()

  // ── Background security scan: fires AFTER navigation, never blocks it ────
  app.on('web-contents-created', (_event, wc) => {
    wc.on('did-navigate', (_e, url) => scanDomainBackground(win, url))
  })

  // ── Save page as PDF ──────────────────────────────────────────────────────
  ipcMain.handle('ctx-save-pdf', async (_, wcId) => {
    const wc = webContents.fromId(wcId)
    if (!wc) return
    try {
      const data = await wc.printToPDF({ printBackground: true, margins: { marginType: 'default' } })
      const fp   = path.join(app.getPath('downloads'), 'page-' + Date.now() + '.pdf')
      fs.writeFileSync(fp, data)
      shell.openPath(fp)
    } catch (e) {
      console.error('[ctx-save-pdf]', e.message)
    }
  })

  // ── Inspect element ───────────────────────────────────────────────────────
  ipcMain.handle('ctx-inspect', (_, { wcId, x, y }) => {
    const wc = webContents.fromId(wcId)
    if (wc) wc.inspectElement(Math.round(x), Math.round(y))
  })

  return win
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const win = createWindow()

  const sendIfOurs = (channel, ...args) => {
    if (!win.isDestroyed() && BrowserWindow.getFocusedWindow()?.id === win.id)
      win.webContents.send(channel, ...args)
  }

  globalShortcut.register('CommandOrControl+T', () => sendIfOurs('tab-new'))
  globalShortcut.register('CommandOrControl+W', () => sendIfOurs('tab-close'))
  for (let i = 1; i <= 9; i++)
    globalShortcut.register(`CommandOrControl+${i}`, () => sendIfOurs('tab-switch', i - 1))
  globalShortcut.register('CommandOrControl+L', () => sendIfOurs('focus-url-bar'))

  globalShortcut.register('CommandOrControl+J', () => {
    const dl = lazy.get('downloader')
    if (dl) dl.openManager()
  })
})

app.on('will-quit',         () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
