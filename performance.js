'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  PERFORMANCE.JS  —  Main-process performance engine
//  Measures RAM (all Electron processes), CPU (main process), and tracks
//  page-load times reported by the renderer.
//  Sends 'perf-update' to renderer every 2 seconds.
// ─────────────────────────────────────────────────────────────────────────────

const { app, ipcMain } = require('electron')

// ─── State ────────────────────────────────────────────────────────────────────

let mainWin      = null
let prevCpu      = process.cpuUsage()
let prevCpuTime  = Date.now()
let lastLoadMs   = 0
let pollTimer    = null

// ─── Thresholds ───────────────────────────────────────────────────────────────

const RAM_WARN   = 300   // MB — yellow
const RAM_CRIT   = 450   // MB — red
const CPU_WARN   = 50    // % — yellow
const CPU_CRIT   = 80    // % — red
const LOAD_WARN  = 2000  // ms — yellow
const LOAD_CRIT  = 5000  // ms — red

// ─── Helpers ──────────────────────────────────────────────────────────────────

function colorFor(val, warn, crit) {
  if (val >= crit) return 'red'
  if (val >= warn) return 'yellow'
  return 'green'
}

function fmtRam(mb) {
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb.toFixed(0) + ' MB'
}

function getTotalRamMb() {
  try {
    const metrics = app.getAppMetrics()
    const total   = metrics.reduce((sum, m) => sum + (m.memory?.privateBytes ?? 0), 0)
    return total / (1024 * 1024)
  } catch {
    return process.memoryUsage().rss / (1024 * 1024)
  }
}

function getCpuPercent() {
  const now     = Date.now()
  const elapsed = (now - prevCpuTime) * 1000   // µs
  const cpu     = process.cpuUsage(prevCpu)
  prevCpu       = process.cpuUsage()
  prevCpuTime   = now
  if (elapsed <= 0) return 0
  return Math.min(100, (cpu.user + cpu.system) / elapsed * 100)
}

// ─── Poll & push ──────────────────────────────────────────────────────────────

function sendMetrics() {
  if (!mainWin || mainWin.isDestroyed()) return

  const ramMb  = getTotalRamMb()
  const cpuPct = getCpuPercent()

  mainWin.webContents.send('perf-update', {
    ram:       fmtRam(ramMb),
    cpu:       cpuPct.toFixed(1) + '%',
    load:      lastLoadMs > 0 ? (lastLoadMs / 1000).toFixed(2) + 's' : '—',
    ramColor:  colorFor(ramMb,  RAM_WARN,  RAM_CRIT),
    cpuColor:  colorFor(cpuPct, CPU_WARN,  CPU_CRIT),
    loadColor: colorFor(lastLoadMs, LOAD_WARN, LOAD_CRIT),
  })
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

function setupIpc() {
  // Renderer sends load time when a tab finishes loading
  ipcMain.on('perf-page-load', (_, ms) => {
    if (typeof ms === 'number' && ms > 0) lastLoadMs = ms
  })

  // Renderer can request a snapshot on demand
  ipcMain.handle('perf-get', () => {
    const ramMb  = getTotalRamMb()
    const cpuPct = getCpuPercent()
    return {
      ram: fmtRam(ramMb), cpu: cpuPct.toFixed(1) + '%',
      load: lastLoadMs > 0 ? (lastLoadMs / 1000).toFixed(2) + 's' : '—',
      ramColor:  colorFor(ramMb,  RAM_WARN, RAM_CRIT),
      cpuColor:  colorFor(cpuPct, CPU_WARN, CPU_CRIT),
      loadColor: colorFor(lastLoadMs, LOAD_WARN, LOAD_CRIT),
    }
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

function init(win) {
  mainWin = win
  setupIpc()

  // Warm up CPU baseline
  prevCpu     = process.cpuUsage()
  prevCpuTime = Date.now()

  // Poll every 2 seconds
  pollTimer = setInterval(sendMetrics, 2000)
  app.on('before-quit', () => { if (pollTimer) clearInterval(pollTimer) })

  console.log('[Perf] Monitor started')
}

module.exports = { init }
