'use strict'

const api = window.electronAPI

// ── Constants ─────────────────────────────────────────────────────────────────

const CONCURRENCY   = 3
const MAX_RETRIES   = 3
const RETRY_DELAYS  = [4000, 8000, 16000]   // ms before each retry attempt

// ── State ─────────────────────────────────────────────────────────────────────

let queue        = []          // array of queueItem objects
let nextId       = 1
let downloading  = 0           // currently running count
const dlIdToItem = new Map()   // dlId → queueItem (for progress routing)
const seenUrls   = new Set()   // duplicate detection across detects

// queueItem fields:
//   id, url, platform, status, dlId, pct, speed, eta, filename,
//   retries, error, retryCountdown, isPlaylist

// ── DOM ───────────────────────────────────────────────────────────────────────

const $textarea  = document.getElementById('url-textarea')
const $quality   = document.getElementById('quality')
const $btnDetect = document.getElementById('btn-detect')
const $btnStart  = document.getElementById('btn-start')
const $btnClear  = document.getElementById('btn-clear')
const $btnCsv    = document.getElementById('btn-csv')
const $list      = document.getElementById('queue-list')
const $empty     = document.getElementById('queue-empty')
const $qlabel    = document.getElementById('q-label')
const $summary   = document.getElementById('hdr-summary')
const $sActive   = document.getElementById('s-active')
const $sQueued   = document.getElementById('s-queued')
const $sDone     = document.getElementById('s-done')
const $sFailed   = document.getElementById('s-failed')
const $sSkipped  = document.getElementById('s-skipped')

// ── URL helpers ───────────────────────────────────────────────────────────────

function parseUrls(text) {
  return [...new Set(
    text.split('\n')
      .map(l => l.trim())
      .filter(l => /^https?:\/\//i.test(l))
  )]
}

function isPlaylistUrl(url) {
  return /youtube\.com\/playlist\?.*list=[\w-]+/.test(url) ||
         (/youtube\.com\/watch\?/.test(url) && /[?&]list=[\w-]+/.test(url))
}

function shortUrl(url) {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 35 ? u.pathname.slice(0, 35) + '…' : u.pathname
    return u.hostname.replace(/^www\./, '') + path
  } catch { return String(url).slice(0, 50) }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Queue item factory ────────────────────────────────────────────────────────

function makeItem(url) {
  return {
    id: nextId++, url,
    platform: null, status: 'detecting',
    dlId: null, pct: 0, speed: '', eta: '', filename: '',
    retries: 0, error: '', retryCountdown: 0,
    isPlaylist: isPlaylistUrl(url),
  }
}

// ── Detect phase ──────────────────────────────────────────────────────────────

async function detect() {
  const urls = parseUrls($textarea.value)
  if (!urls.length) return

  $btnDetect.disabled = true
  $btnDetect.textContent = 'Detecting…'

  for (const url of urls) {
    if (seenUrls.has(url)) {
      const dup = makeItem(url)
      dup.status = 'duplicate'
      queue.push(dup)
      render()
      continue
    }

    seenUrls.add(url)
    const item = makeItem(url)
    queue.push(item)
    render()

    if (item.isPlaylist) {
      try {
        const info = await api.dlPlaylistInfo(url)
        if (info.isPlaylist && info.urls && info.urls.length > 0) {
          // Replace placeholder with an "expanded" marker
          item.status   = 'duplicate'           // won't be downloaded directly
          item.platform = 'Playlist'
          item.error    = `Expanded: ${info.urls.length} video${info.urls.length !== 1 ? 's' : ''}`
          render()
          for (const vUrl of info.urls) {
            if (seenUrls.has(vUrl)) continue
            seenUrls.add(vUrl)
            const vItem = makeItem(vUrl)
            queue.push(vItem)
            render()
            await checkItem(vItem)
          }
          continue
        }
      } catch (err) {
        item.status = 'unsupported'
        item.error  = 'Playlist error: ' + (err.message || 'unknown')
        render()
        continue
      }
    }

    await checkItem(item)
  }

  $textarea.value = ''
  updateButtons()
  updateSummary()

  $btnDetect.disabled = false
  $btnDetect.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
         stroke-width="1.8" stroke-linecap="round">
      <circle cx="5" cy="5" r="3.5"/><line x1="8" y1="8" x2="11" y2="11"/>
    </svg> Detect URLs`
}

async function checkItem(item) {
  try {
    const { supported, platform } = await api.dlCheck(item.url)
    item.status   = supported ? 'queued'      : 'unsupported'
    item.platform = supported ? platform      : null
  } catch {
    item.status = 'unsupported'
  }
  render()
}

// ── Download queue ────────────────────────────────────────────────────────────

function startNext() {
  while (downloading < CONCURRENCY) {
    const next = queue.find(i => i.status === 'queued')
    if (!next) break
    startItem(next)
  }
}

async function startItem(item) {
  downloading++
  item.status = 'downloading'
  item.pct    = 0
  item.speed  = ''
  item.eta    = ''
  render()

  const quality = $quality.value
  const format  = quality === 'audio' ? 'audio' : (quality === 'webm' ? 'webm' : 'mp4')

  try {
    const { id } = await api.dlStart({ url: item.url, quality, format })
    item.dlId = id
    dlIdToItem.set(id, item)
  } catch (err) {
    downloading--
    scheduleRetry(item, err.message || 'Failed to start')
    startNext()
  }
}

function scheduleRetry(item, errMsg) {
  if (item.retries >= MAX_RETRIES) {
    item.status = 'failed'
    item.error  = errMsg
    render()
    return
  }

  const delay = RETRY_DELAYS[item.retries] || 16000
  item.retries++
  item.status          = 'retrying'
  item.error           = errMsg
  item.retryCountdown  = Math.ceil(delay / 1000)
  render()

  const tick = setInterval(() => {
    item.retryCountdown = Math.max(0, item.retryCountdown - 1)
    updateItemEl(item)
  }, 1000)

  setTimeout(() => {
    clearInterval(tick)
    item.status = 'queued'
    item.error  = ''
    render()
    startNext()
  }, delay)
}

// ── Progress from backend ─────────────────────────────────────────────────────

api.onDlUpdate(dl => {
  const item = dlIdToItem.get(dl.id)
  if (!item) return

  item.pct   = dl.pct   || 0
  item.speed = dl.speed || ''
  item.eta   = dl.eta   || ''
  if (dl.filename) item.filename = dl.filename

  if (dl.status === 'complete') {
    item.status = 'done'
    item.pct    = 100
    downloading = Math.max(0, downloading - 1)
    dlIdToItem.delete(dl.id)
    render()
    startNext()
  } else if (dl.status === 'error') {
    downloading = Math.max(0, downloading - 1)
    dlIdToItem.delete(dl.id)
    scheduleRetry(item, dl.error || 'Download failed')
    startNext()
  } else {
    updateItemEl(item)
  }
})

// ── Render ────────────────────────────────────────────────────────────────────

function iconFor(status) {
  return { detecting:'↻', queued:'·', downloading:'↓', done:'✓',
           failed:'✕', retrying:'↻', unsupported:'?', duplicate:'⊘' }[status] || '·'
}

function iconCls(status) {
  return { detecting:'ic-detecting', queued:'ic-queued', downloading:'ic-downloading',
           done:'ic-done', failed:'ic-failed', retrying:'ic-retrying',
           unsupported:'ic-unsupported', duplicate:'ic-duplicate' }[status] || 'ic-queued'
}

function platCls(platform) {
  if (!platform) return 'p-default'
  const p = platform.toLowerCase()
  if (p === 'youtube')   return 'p-youtube'
  if (p === 'tiktok')    return 'p-tiktok'
  if (p === 'instagram') return 'p-instagram'
  if (p === 'twitter')   return 'p-twitter'
  if (p === 'x')         return 'p-x'
  if (p === 'facebook')  return 'p-facebook'
  if (p === 'vimeo')     return 'p-vimeo'
  if (p === 'playlist')  return 'p-playlist'
  return 'p-default'
}

function buildStatusText(item) {
  const s = item.status
  if (s === 'detecting')    return { txt: 'Detecting…',          cls: '' }
  if (s === 'queued')       return { txt: 'Queued',              cls: '' }
  if (s === 'unsupported')  return { txt: 'Unsupported URL',     cls: 'cf' }
  if (s === 'duplicate')    return { txt: item.error || 'Duplicate — skipped', cls: '' }
  if (s === 'done')         return { txt: '✓ Complete',          cls: 'cd' }
  if (s === 'failed')       return { txt: '✕ ' + (item.error || 'Failed').slice(0, 90), cls: 'cf' }
  if (s === 'retrying')     return { txt: `↻ Retry ${item.retries}/${MAX_RETRIES} in ${item.retryCountdown}s — ${(item.error || '').slice(0, 60)}`, cls: 'cr' }
  if (s === 'downloading') {
    let t = (item.pct || 0).toFixed(0) + '%'
    if (item.speed) t += '   ' + item.speed
    if (item.eta)   t += '   ETA ' + item.eta
    return { txt: t, cls: '' }
  }
  return { txt: s, cls: '' }
}

function buildItemHtml(item) {
  const showBar  = ['downloading','done','retrying','failed'].includes(item.status)
  const pct      = Math.min(100, item.pct || 0)
  const barCls   = item.status === 'done' ? 'bd' : item.status === 'failed' ? 'bf' : item.status === 'retrying' ? 'br' : ''
  const dispName = item.filename || shortUrl(item.url)
  const platLbl  = item.platform || (item.isPlaylist ? 'Playlist' : '—')
  const { txt, cls } = buildStatusText(item)
  const canRemove = item.status !== 'downloading'

  return `<div class="qi s-${item.status}" data-qid="${item.id}">
    <div class="qi-r1">
      <div class="qi-icon ${iconCls(item.status)}">${iconFor(item.status)}</div>
      <span class="qi-plat ${platCls(item.platform || (item.isPlaylist ? 'playlist' : null))}">${esc(platLbl)}</span>
      <div class="qi-name">
        <div class="qi-filename" title="${esc(item.url)}">${esc(dispName)}</div>
        ${item.filename ? `<div class="qi-url">${esc(shortUrl(item.url))}</div>` : ''}
      </div>
      ${canRemove ? `<button class="qi-rm" data-act="rm" data-qid="${item.id}" title="Remove">✕</button>` : ''}
    </div>
    ${showBar ? `<div class="qi-bar-bg"><div class="qi-bar ${barCls}" style="width:${pct.toFixed(1)}%"></div></div>` : ''}
    <div class="qi-r3 ${cls}">${esc(txt)}</div>
  </div>`
}

function updateItemEl(item) {
  const el = $list.querySelector(`[data-qid="${item.id}"]`)
  if (!el) return
  const tmp = document.createElement('div')
  tmp.innerHTML = buildItemHtml(item)
  el.replaceWith(tmp.firstElementChild)
}

function render() {
  // Stats
  let active = 0, queued = 0, done = 0, failed = 0, skipped = 0
  for (const i of queue) {
    if (i.status === 'downloading')                       active++
    else if (i.status === 'queued'||i.status==='retrying') queued++
    else if (i.status === 'done')                          done++
    else if (i.status === 'failed')                        failed++
    else if (i.status === 'duplicate'||i.status==='unsupported') skipped++
  }
  $sActive.textContent  = active
  $sQueued.textContent  = queued
  $sDone.textContent    = done
  $sFailed.textContent  = failed
  $sSkipped.textContent = skipped

  $qlabel.textContent = `Queue (${queue.length} URL${queue.length !== 1 ? 's' : ''})`

  if (queue.length === 0) {
    $list.innerHTML = ''
    $list.appendChild($empty)
    $empty.style.display = 'flex'
  } else {
    $empty.style.display = 'none'
    $list.innerHTML = queue.map(buildItemHtml).join('')
  }

  updateButtons()
  updateSummary()
}

function updateButtons() {
  const hasQueued = queue.some(i => i.status === 'queued')
  $btnStart.disabled = !hasQueued
  $btnCsv.disabled   = queue.length === 0
}

function updateSummary() {
  const ready = queue.filter(i => ['queued','downloading','done'].includes(i.status)).length
  const bad   = queue.filter(i => i.status === 'unsupported').length
  const dup   = queue.filter(i => i.status === 'duplicate').length
  const parts = []
  if (ready) parts.push(`${ready} ready`)
  if (bad)   parts.push(`${bad} unsupported`)
  if (dup)   parts.push(`${dup} duplicate`)
  $summary.textContent = parts.join(' · ')
}

// ── Event listeners ───────────────────────────────────────────────────────────

$btnDetect.addEventListener('click', detect)

$textarea.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) detect()
})

$btnStart.addEventListener('click', () => startNext())

$btnClear.addEventListener('click', () => {
  for (const item of queue) {
    if (item.dlId !== null) api.dlCancel(item.dlId).catch(() => {})
  }
  queue = []
  seenUrls.clear()
  dlIdToItem.clear()
  downloading = 0
  $summary.textContent = ''
  render()
})

$btnCsv.addEventListener('click', async () => {
  if (!queue.length) return
  const hdr  = ['URL', 'Platform', 'Filename', 'Status', 'Error']
  const rows = queue.map(i => [
    i.url, i.platform || '', i.filename || '', i.status, i.error || '',
  ])
  const csv = [hdr, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  await api.dlSaveCsv(csv)
})

// Event delegation for queue item buttons
$list.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]')
  if (!btn) return
  const qid = parseInt(btn.dataset.qid, 10)
  if (btn.dataset.act === 'rm') {
    const item = queue.find(i => i.id === qid)
    if (!item) return
    if (item.dlId !== null) api.dlCancel(item.dlId).catch(() => {})
    if (item.status === 'downloading') downloading = Math.max(0, downloading - 1)
    seenUrls.delete(item.url)
    queue = queue.filter(i => i.id !== qid)
    render()
    startNext()
  }
})

// ── Init ──────────────────────────────────────────────────────────────────────

render()
