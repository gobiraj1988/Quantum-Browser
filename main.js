const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron')
const path      = require('path')
const fs        = require('fs')
const adblocker = require('./adblocker')   // ← ad blocker module

// ─── Window State Persistence ─────────────────────────────────────────────────

const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    }
  } catch (_) {}
  return { width: 1200, height: 800, x: undefined, y: undefined }
}

function saveWindowState(win) {
  if (win.isMaximized() || win.isMinimized()) return
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(win.getBounds()), 'utf8')
  } catch (_) {}
}

function isPositionOnScreen(state) {
  if (state.x === undefined || state.y === undefined) return false
  return screen.getAllDisplays().some(({ workArea: a }) =>
    state.x >= a.x &&
    state.y >= a.y &&
    state.x + state.width  <= a.x + a.width &&
    state.y + state.height <= a.y + a.height
  )
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
      webviewTag:       true,
      nodeIntegration:  false,
      contextIsolation: true,
      preload:          path.join(__dirname, 'preload.js')
    }
  })

  win.loadFile('index.html')

  // Smooth fade-in on startup
  win.once('ready-to-show', () => {
    win.setOpacity(0)
    win.show()
    let opacity = 0
    const fadeIn = setInterval(() => {
      opacity = Math.min(1, opacity + 0.08)
      win.setOpacity(opacity)
      if (opacity >= 1) clearInterval(fadeIn)
    }, 16)
  })

  // Persist window position / size
  let saveTimer
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveWindowState(win), 400)
  }
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

  // ── Initialise ad blocker ──────────────────────────────────────────────────
  adblocker.init(win)

  // ── Settings window ────────────────────────────────────────────────────────
  ipcMain.handle('open-settings', () => {
    const existing = BrowserWindow.getAllWindows().find(w =>
      !w.isDestroyed() && w.getTitle() === 'Ad Blocker Settings'
    )
    if (existing) { existing.focus(); return }

    const sw = new BrowserWindow({
      width:  720,
      height: 560,
      parent: win,
      title:  'Ad Blocker Settings',
      backgroundColor: '#202124',
      show: false,
      webPreferences: {
        nodeIntegration:  false,
        contextIsolation: true,
        preload:          path.join(__dirname, 'preload.js')
      }
    })
    sw.loadFile('adblocker-settings.html')
    sw.setMenuBarVisibility(false)
    sw.once('ready-to-show', () => sw.show())
  })

  return win
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const win = createWindow()

  // Only fire shortcuts when our window is focused (not when other apps are in front)
  const sendIfOurs = (channel, ...args) => {
    if (!win.isDestroyed() && BrowserWindow.getFocusedWindow()?.id === win.id) {
      win.webContents.send(channel, ...args)
    }
  }

  // Tab shortcuts
  globalShortcut.register('CommandOrControl+T', () => sendIfOurs('tab-new'))
  globalShortcut.register('CommandOrControl+W', () => sendIfOurs('tab-close'))

  // Ctrl+1–9: switch tab by index
  for (let i = 1; i <= 9; i++) {
    globalShortcut.register(`CommandOrControl+${i}`, () => sendIfOurs('tab-switch', i - 1))
  }

  // URL bar focus
  globalShortcut.register('CommandOrControl+L', () => sendIfOurs('focus-url-bar'))
})

app.on('will-quit',         () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
