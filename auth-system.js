'use strict'

const { BrowserWindow, ipcMain, app, safeStorage } = require('electron')
const path   = require('path')
const fs     = require('fs')
const crypto = require('crypto')

// ─── Paths ─────────────────────────────────────────────────────────────────────
const AUTH_DIR      = path.join(app.getPath('userData'), 'auth')
const SESSION_FILE  = path.join(AUTH_DIR, 'session.enc')
const DEVICE_FILE   = path.join(AUTH_DIR, 'device.json')
const ATTEMPTS_FILE = path.join(AUTH_DIR, 'attempts.json')
const HISTORY_FILE  = path.join(AUTH_DIR, 'history.json')

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true })

// ─── Device fingerprint (persistent UUID) ─────────────────────────────────────
function getDeviceId() {
  try {
    if (fs.existsSync(DEVICE_FILE)) {
      const d = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'))
      if (d.id) return d.id
    }
  } catch (_) {}
  const id = crypto.randomUUID()
  fs.writeFileSync(DEVICE_FILE, JSON.stringify({ id, created: Date.now() }), 'utf8')
  return id
}

// ─── Encrypted session storage ─────────────────────────────────────────────────
function saveSession(data) {
  try {
    const json = JSON.stringify(data)
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(SESSION_FILE, safeStorage.encryptString(json))
    } else {
      fs.writeFileSync(SESSION_FILE + '.plain', json, 'utf8')
    }
  } catch (e) { console.error('[Auth] save session:', e.message) }
}

function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE) && safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(SESSION_FILE)))
    }
    if (fs.existsSync(SESSION_FILE + '.plain')) {
      return JSON.parse(fs.readFileSync(SESSION_FILE + '.plain', 'utf8'))
    }
  } catch (_) {}
  return null
}

function clearSession() {
  [SESSION_FILE, SESSION_FILE + '.plain'].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch (_) {}
  })
}

// ─── Brute-force protection ────────────────────────────────────────────────────
// Locks account for 15 min after 5 failed attempts within 1 hour

function readAttempts() {
  try { if (fs.existsSync(ATTEMPTS_FILE)) return JSON.parse(fs.readFileSync(ATTEMPTS_FILE, 'utf8')) } catch (_) {}
  return {}
}
function writeAttempts(data) {
  try { fs.writeFileSync(ATTEMPTS_FILE, JSON.stringify(data), 'utf8') } catch (_) {}
}

function checkBruteForce(identifier) {
  const all = readAttempts()
  const r   = all[identifier]
  if (!r) return { locked: false, attempts: 0 }
  if (Date.now() - r.last > 60 * 60 * 1000) {
    delete all[identifier]; writeAttempts(all)
    return { locked: false, attempts: 0 }
  }
  if (r.count >= 5) {
    const elapsed = Date.now() - (r.lockedAt || r.last)
    const LOCK_MS = 15 * 60 * 1000
    if (elapsed < LOCK_MS) {
      return { locked: true, remaining: Math.ceil((LOCK_MS - elapsed) / 1000), attempts: r.count }
    }
    // Lock expired — reset
    delete all[identifier]; writeAttempts(all)
    return { locked: false, attempts: 0 }
  }
  return { locked: false, attempts: r.count }
}

function recordAttempt(identifier, success) {
  const all = readAttempts()
  if (success) { delete all[identifier] }
  else {
    if (!all[identifier]) all[identifier] = { count: 0, last: 0 }
    all[identifier].count++
    all[identifier].last = Date.now()
    if (all[identifier].count >= 5) all[identifier].lockedAt = Date.now()
  }
  writeAttempts(all)
}

// ─── Login history ─────────────────────────────────────────────────────────────
function addHistory(entry) {
  let hist = []
  try { if (fs.existsSync(HISTORY_FILE)) hist = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) } catch (_) {}
  hist.unshift({ ...entry, ts: Date.now() })
  hist = hist.slice(0, 50)
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(hist), 'utf8') } catch (_) {}
}

function getHistory(limit = 5) {
  try { if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, limit) } catch (_) {}
  return []
}

// ─── Auth window factory ───────────────────────────────────────────────────────
function openAuthWin(file, opts = {}) {
  const win = new BrowserWindow({
    width:     opts.width  || 520,
    height:    opts.height || 720,
    title:     opts.title  || 'MyBrowser',
    backgroundColor: '#080812',
    show:      false,
    resizable: false,
    center:    true,
    frame:     false,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  win.setMenu(null)
  win.loadFile(file)
  win.once('ready-to-show', () => {
    win.setOpacity(0); win.show()
    let o = 0
    const t = setInterval(() => { o = Math.min(1, o + 0.1); win.setOpacity(o); if (o >= 1) clearInterval(t) }, 14)
  })
  return win
}

// ─── Google OAuth window ───────────────────────────────────────────────────────
function openGoogleOAuth(mainWin, supabaseUrl) {
  const owin = new BrowserWindow({
    width: 480, height: 640, title: 'Sign in with Google',
    backgroundColor: '#fff', center: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  owin.setMenu(null)
  owin.loadURL(`${supabaseUrl}/auth/v1/authorize?provider=google`)

  const checkUrl = (url) => {
    if (!url) return
    if (url.includes('access_token=') || url.includes('#access_token=')) {
      const hash  = url.includes('#') ? url.split('#')[1] : url.split('?')[1] || ''
      const params = new URLSearchParams(hash)
      const session = {
        access_token:  params.get('access_token'),
        refresh_token: params.get('refresh_token'),
        expires_in:    parseInt(params.get('expires_in') || '3600'),
        token_type:    'bearer',
      }
      if (session.access_token) {
        saveSession(session)
        if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('auth-state-changed', { loggedIn: true })
      }
      owin.close()
    }
  }

  owin.webContents.on('did-navigate',         (_, url) => checkUrl(url))
  owin.webContents.on('did-navigate-in-page', (_, url) => checkUrl(url))
}

// ─── Module init (called from main.js) ────────────────────────────────────────
function init(mainWin) {
  const deviceId = getDeviceId()

  let loginWin = null, registerWin = null, otpWin = null

  // Open windows
  ipcMain.handle('auth-open-login', () => {
    if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return }
    loginWin = openAuthWin('login.html', { title: 'Sign In — MyBrowser' })
    loginWin.on('closed', () => { loginWin = null })
  })

  ipcMain.handle('auth-open-register', () => {
    if (registerWin && !registerWin.isDestroyed()) { registerWin.focus(); return }
    registerWin = openAuthWin('register.html', { title: 'Create Account — MyBrowser', height: 780 })
    registerWin.on('closed', () => { registerWin = null })
  })

  ipcMain.handle('auth-open-otp', (_, data) => {
    if (otpWin && !otpWin.isDestroyed()) { otpWin.focus(); return }
    otpWin = openAuthWin('otp-verify.html', { title: 'Verify Account — MyBrowser', height: 560 })
    otpWin.webContents.once('did-finish-load', () => otpWin.webContents.send('otp-init', data))
    otpWin.on('closed', () => { otpWin = null })
  })

  // Window controls for frameless auth windows
  ipcMain.on('auth-win-close', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) win.close()
  })
  ipcMain.on('auth-win-minimize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) win.minimize()
  })

  // Session management
  ipcMain.handle('auth-save-session', (_, session) => {
    saveSession(session)
    ;[loginWin, registerWin, otpWin].forEach(w => { try { if (w && !w.isDestroyed()) w.close() } catch (_) {} })
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('auth-state-changed', { loggedIn: true })
  })
  ipcMain.handle('auth-get-session',  () => loadSession())
  ipcMain.handle('auth-logout', () => {
    clearSession()
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('auth-state-changed', { loggedIn: false })
  })

  // Brute force
  ipcMain.handle('auth-check-brute',   (_, id)            => checkBruteForce(id))
  ipcMain.handle('auth-record-attempt',(_, { id, ok })    => recordAttempt(id, ok))

  // Login history
  ipcMain.handle('auth-add-history',   (_, e)             => addHistory({ ...e, deviceId }))
  ipcMain.handle('auth-get-history',   ()                 => getHistory(5))

  // Device ID
  ipcMain.handle('auth-get-device-id', ()                 => deviceId)

  // Google OAuth
  ipcMain.handle('auth-google-login',  (_, supabaseUrl)   => openGoogleOAuth(mainWin, supabaseUrl))
}

module.exports = { init }
