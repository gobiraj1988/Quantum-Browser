'use strict'

const { ipcMain, Notification, shell, BrowserWindow, app } = require('electron')
const path  = require('path')
const os    = require('os')
const fs    = require('fs')
const ytdlp = require('yt-dlp-exec')

// ─── Supported platforms ──────────────────────────────────────────────────────

const VIDEO_PATTERNS = [
  { re: /youtube\.com\/watch\?.*v=[\w-]+/,                platform: 'YouTube'    },
  { re: /youtu\.be\/[\w-]+/,                              platform: 'YouTube'    },
  { re: /youtube\.com\/shorts\/[\w-]+/,                   platform: 'YouTube'    },
  { re: /tiktok\.com\/@[\w.]+\/video\/\d+/,               platform: 'TikTok'     },
  { re: /vm\.tiktok\.com\/[\w-]+/,                        platform: 'TikTok'     },
  { re: /tiktok\.com\/t\/[\w-]+/,                         platform: 'TikTok'     },
  { re: /instagram\.com\/(p|reel|reels|tv)\/[\w-]+/,     platform: 'Instagram'  },
  { re: /vimeo\.com\/\d+/,                                platform: 'Vimeo'      },
  { re: /twitter\.com\/\w+\/status\/\d+/,                 platform: 'Twitter'    },
  { re: /x\.com\/\w+\/status\/\d+/,                      platform: 'X'          },
  { re: /facebook\.com\/.*\/videos\/\d+/,                 platform: 'Facebook'   },
  { re: /facebook\.com\/watch/,                           platform: 'Facebook'   },
  { re: /facebook\.com\/reel\/\d+/,                       platform: 'Facebook'   },
  { re: /facebook\.com\/share\/(v|r|reel)\//,             platform: 'Facebook'   },
  { re: /fb\.watch\/[\w-]+/,                              platform: 'Facebook'   },
  { re: /dailymotion\.com\/video\/[\w]+/,                 platform: 'Dailymotion'},
  { re: /twitch\.tv\/videos\/\d+/,                        platform: 'Twitch'     },
  { re: /reddit\.com\/r\/\w+\/comments\/[\w]+/,           platform: 'Reddit'     },
]

function detectVideo(url) {
  for (const { re, platform } of VIDEO_PATTERNS) {
    if (re.test(url)) return { supported: true, platform }
  }
  return { supported: false, platform: null }
}

// ─── Format strings ───────────────────────────────────────────────────────────

const FORMAT_STRINGS = {
  '4k':    'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160][ext=mp4]/best[height<=2160]/best',
  '1080p': 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]/best',
  '720p':  'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best',
  '480p':  'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[height<=480]/best',
  '360p':  'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best[height<=360]/best',
  'webm':  'bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best',
  'audio': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function buildOptions(quality, format, resume, withCookies, url) {
  const dlPath = path.join(os.homedir(), 'Downloads', '%(title)s.%(ext)s')
  const base   = {
    noPlaylist: true,
    noCheckCertificates: true,
    newline: true,
    output: dlPath,
    userAgent: UA,
    geoBypass: true,
  }
  if (withCookies) base.cookiesFromBrowser = 'edge'
  if (resume) base.continue = true

  // TikTok needs app_name to bypass anti-bot
  if (url && /tiktok\.com/i.test(url)) {
    base.extractorArgs = 'tiktok:app_name=trill'
  }

  if (format === 'audio') return { ...base, extractAudio: true, audioFormat: 'mp3', audioQuality: 0 }

  const fmtStr = FORMAT_STRINGS[quality] || FORMAT_STRINGS['720p']
  const opts   = { ...base, format: fmtStr }
  opts.mergeOutputFormat = format === 'webm' ? 'webm' : 'mp4'
  return opts
}

// ─── State ────────────────────────────────────────────────────────────────────

const active  = new Map()    // id → dl object (kept until user dismisses)
let nextId    = 1
let history   = []
let histFile  = null
let mainWin   = null
let mgrWin    = null
let bulkWin   = null

function getHistFile() {
  if (!histFile) histFile = path.join(app.getPath('userData'), 'dl-history.json')
  return histFile
}
function loadHistory()  { try { return JSON.parse(fs.readFileSync(getHistFile(), 'utf8')) } catch { return [] } }
function saveHistory()  { try { fs.writeFileSync(getHistFile(), JSON.stringify(history.slice(0, 100)), 'utf8') } catch (_) {} }

// ─── Broadcast to all open windows ───────────────────────────────────────────

function push(channel, data) {
  if (mainWin  && !mainWin.isDestroyed())  mainWin.webContents.send(channel, data)
  if (mgrWin   && !mgrWin.isDestroyed())   mgrWin.webContents.send(channel, data)
  if (bulkWin  && !bulkWin.isDestroyed())  bulkWin.webContents.send(channel, data)
}

function pub(dl) {
  const { proc, ...rest } = dl
  return rest
}

// ─── Progress line parsing ────────────────────────────────────────────────────

// Example line: [download]  45.2% of   56.78MiB at    2.50MiB/s ETA 00:12
const FULL_RE  = /\[download\]\s+([\d.]+)%\s+of\s+~?([\S]+)\s+at\s+([\S]+)\s+ETA\s+([\S]+)/
const PCT_RE   = /\[download\]\s+([\d.]+)%/
const FN_RE    = /\[download\] Destination:\s*(.+)/
const MERGE_RE = /\[Merger\] Merging formats into "(.+)"/

// ─── Download runner ──────────────────────────────────────────────────────────

function runDownload(dl, resume, attempt = 1) {
  const withCookies = (attempt === 1)   // first try with Edge cookies, second try without
  let proc
  try {
    proc = ytdlp.exec(dl.url, buildOptions(dl.quality, dl.format, resume, withCookies, dl.url))
  } catch (err) {
    dl.status = 'error'
    dl.error  = err.message || 'Could not start yt-dlp.'
    push('dl-update', pub(dl))
    return
  }

  dl.proc   = proc
  dl.status = 'downloading'
  push('dl-update', pub(dl))

  if (!resume && attempt === 1) {
    try { new Notification({ title: 'Download started', body: (dl.filename || dl.url).slice(0, 80) }).show() } catch (_) {}
  }

  if (proc.stdout) {
    proc.stdout.on('data', chunk => {
      for (const line of chunk.toString().split('\n')) {
        const fm = FULL_RE.exec(line)
        if (fm) {
          dl.pct       = parseFloat(fm[1])
          dl.totalSize = fm[2]
          dl.speed     = fm[3]
          dl.eta       = fm[4] === 'Unknown' ? '' : fm[4]
          push('dl-update', pub(dl))
          continue
        }
        const pm = PCT_RE.exec(line)
        if (pm) { dl.pct = parseFloat(pm[1]); push('dl-update', pub(dl)); continue }

        const fnM = FN_RE.exec(line)
        if (fnM) {
          dl.filePath = fnM[1].trim()
          dl.filename = path.basename(dl.filePath)
          push('dl-update', pub(dl))
          continue
        }
        const mgM = MERGE_RE.exec(line)
        if (mgM) {
          dl.filePath = mgM[1].trim()
          dl.filename = path.basename(dl.filePath)
          push('dl-update', pub(dl))
        }
      }
    })
  }

  proc
    .then(() => {
      dl.proc    = null
      dl.status  = 'complete'
      dl.pct     = 100
      dl.speed   = ''
      dl.eta     = ''
      dl.endTime = Date.now()
      push('dl-update', pub(dl))
      history.unshift(pub(dl))
      saveHistory()
      push('dl-history-update', history)
      try { new Notification({ title: 'Download complete', body: dl.filename || 'Saved to Downloads.' }).show() } catch (_) {}
    })
    .catch(err => {
      dl.proc = null
      if (dl.status === 'paused' || dl.status === 'cancelled') { push('dl-update', pub(dl)); return }

      const stderr = err.stderr || ''

      // If Edge cookies caused the failure, retry without cookies
      if (withCookies && /cookies|browser|keyring|decrypt|sqlite/i.test(stderr)) {
        dl.status = 'downloading'
        dl.pct    = 0
        dl.speed  = ''
        dl.eta    = ''
        push('dl-update', pub(dl))
        runDownload(dl, resume, 2)
        return
      }

      dl.status  = 'error'
      let errMsg = stderr.split('\n').filter(l => l.includes('ERROR')).pop()
                   || err.message || 'Download failed.'
      if (/login|sign.?in|log.?in|authenticat/i.test(errMsg)) {
        errMsg += ' — Log in to this site on Microsoft Edge, then retry.'
      }
      dl.error   = errMsg
      dl.endTime = Date.now()
      push('dl-update', pub(dl))
    })
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

function init(win) {
  mainWin = win
  history = loadHistory()

  ipcMain.handle('dl-check', (_, url) => detectVideo(url))

  ipcMain.handle('dl-start', (_, { url, quality, format }) => {
    const id = nextId++
    const dl = {
      id, url, quality, format,
      filename: '', filePath: '',
      pct: 0, speed: '', eta: '', totalSize: '',
      status: 'starting',
      startTime: Date.now(), endTime: null,
      error: '', proc: null,
    }
    active.set(id, dl)
    setImmediate(() => runDownload(dl, false))
    return { id }
  })

  ipcMain.handle('dl-pause', (_, id) => {
    const dl = active.get(id)
    if (!dl || dl.status !== 'downloading') return
    dl.status = 'paused'
    dl.speed  = ''
    dl.eta    = ''
    if (dl.proc) dl.proc.kill()
    push('dl-update', pub(dl))
  })

  ipcMain.handle('dl-resume', (_, id) => {
    const dl = active.get(id)
    if (!dl || dl.status !== 'paused') return
    runDownload(dl, true)
  })

  ipcMain.handle('dl-cancel', (_, id) => {
    const dl = active.get(id)
    if (!dl) return
    dl.status = 'cancelled'
    if (dl.proc) dl.proc.kill()
    dl.proc = null
    push('dl-update', pub(dl))
    active.delete(id)
  })

  ipcMain.handle('dl-open-file', (_, filePath) => {
    shell.openPath(filePath && fs.existsSync(filePath) ? filePath : path.join(os.homedir(), 'Downloads'))
  })

  ipcMain.handle('dl-open-folder', (_, filePath) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath)
    else shell.openPath(path.join(os.homedir(), 'Downloads'))
  })

  ipcMain.handle('dl-get-all', () => ({
    active:  [...active.values()].map(pub),
    history,
  }))

  ipcMain.handle('dl-clear-history', () => {
    history = []
    saveHistory()
    push('dl-history-update', [])
  })

  ipcMain.handle('dl-remove-history', (_, idx) => {
    history.splice(idx, 1)
    saveHistory()
    push('dl-history-update', history)
  })

  ipcMain.handle('open-download-manager', () => openManager())
  ipcMain.handle('open-bulk-downloader', () => openBulkDownloader())

  ipcMain.handle('dl-playlist-info', async (_, url) => {
    try {
      const info = await ytdlp(url, {
        flatPlaylist: true, dumpSingleJson: true,
        noCheckCertificates: true, playlistEnd: 50, userAgent: UA,
      })
      if (info.entries && info.entries.length > 0) {
        return {
          isPlaylist: true,
          title: info.title || info.playlist_title || 'Playlist',
          count: info.entries.length,
          urls: info.entries
            .map(e => e.url || e.webpage_url ||
                      (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null))
            .filter(Boolean),
        }
      }
      return { isPlaylist: false, title: info.title || '', count: 1, urls: [url] }
    } catch (err) {
      return { isPlaylist: false, error: err.message, urls: [url] }
    }
  })

  ipcMain.handle('dl-save-csv', async (_, csv) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fp = path.join(os.homedir(), 'Downloads', `downloads-${ts}.csv`)
    try {
      fs.writeFileSync(fp, '﻿' + csv, 'utf8')
      shell.openPath(fp)
      return { ok: true, filePath: fp }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  console.log('[Downloader] Ready')
}

function openBulkDownloader() {
  if (bulkWin && !bulkWin.isDestroyed()) { bulkWin.focus(); return }
  bulkWin = new BrowserWindow({
    width: 920, height: 700, minWidth: 700, minHeight: 500,
    title: 'Bulk Downloader', backgroundColor: '#202124', show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js') },
  })
  bulkWin.loadFile('bulk-downloader.html')
  bulkWin.setMenuBarVisibility(false)
  bulkWin.once('ready-to-show', () => bulkWin.show())
  bulkWin.on('closed', () => { bulkWin = null })
}

function openManager() {
  if (mgrWin && !mgrWin.isDestroyed()) { mgrWin.focus(); return }

  mgrWin = new BrowserWindow({
    width: 800, height: 600, minWidth: 620, minHeight: 440,
    title:           'Download Manager',
    backgroundColor: '#202124',
    show:            false,
    webPreferences:  {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  mgrWin.loadFile('download-manager.html')
  mgrWin.setMenuBarVisibility(false)
  mgrWin.once('ready-to-show', () => mgrWin.show())
  mgrWin.on('closed', () => { mgrWin = null })
}

module.exports = { init, openManager, openBulkDownloader }
